/**
 * Linear adapter primitives:
 *   - verifyLinearSignature: HMAC-SHA256 over raw body
 *   - postLinearComment: GraphQL commentCreate mutation
 *   - fetchLinearIssueContext: pull issue title/desc/project for prompt threading
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLinearSignature(args: {
  webhookSecret: string;
  signatureHeader: string | null;
  rawBody: string;
}): boolean {
  const { webhookSecret, signatureHeader, rawBody } = args;
  if (!(webhookSecret && signatureHeader)) {
    return false;
  }
  const expected = createHmac("sha256", webhookSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const LINEAR_GQL = "https://api.linear.app/graphql";

interface LinearGqlResp<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export interface LinearIssueContext {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  teamKey: string;
  teamName: string | null;
  projectName: string | null;
}

export async function fetchLinearIssueContext(args: {
  apiKey: string;
  issueId: string;
  fetchImpl?: typeof fetch;
}): Promise<LinearIssueContext | null> {
  const f = args.fetchImpl ?? fetch;
  const query = `
    query Issue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        team { key name }
        project { name }
      }
    }
  `;
  const res = await f(LINEAR_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: args.apiKey,
    },
    body: JSON.stringify({ query, variables: { id: args.issueId } }),
  });
  const json = (await res.json()) as LinearGqlResp<{
    issue?: {
      id: string;
      identifier: string;
      title: string;
      description: string | null;
      team: { key: string; name: string | null } | null;
      project: { name: string | null } | null;
    };
  }>;
  if (!json.data?.issue) {
    return null;
  }
  const i = json.data.issue;
  return {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    description: i.description,
    teamKey: i.team?.key ?? "",
    teamName: i.team?.name ?? null,
    projectName: i.project?.name ?? null,
  };
}

export async function postLinearComment(args: {
  apiKey: string;
  issueId: string;
  body: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; commentId?: string; error?: string }> {
  const f = args.fetchImpl ?? fetch;
  const mutation = `
    mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id }
      }
    }
  `;
  const res = await f(LINEAR_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: args.apiKey,
    },
    body: JSON.stringify({
      query: mutation,
      variables: { input: { issueId: args.issueId, body: args.body } },
    }),
  });
  const json = (await res.json()) as LinearGqlResp<{
    commentCreate?: { success: boolean; comment?: { id: string } };
  }>;
  if (json.errors && json.errors.length > 0) {
    return { ok: false, error: json.errors.map((e) => e.message).join("; ") };
  }
  if (!json.data?.commentCreate?.success) {
    return { ok: false, error: "commentCreate.success=false" };
  }
  return { ok: true, commentId: json.data.commentCreate.comment?.id };
}

export interface ProjectMeta {
  business: string;
  visibility: "personal" | "work";
  protectMode: boolean;
  protectReason?: string;
  slackChannel?: string;
}

export async function loadProjectsByLinearTeam(
  projectsYamlPath = "/home/shaun/.tars-state/knowledge/projects.yaml"
): Promise<Map<string, ProjectMeta>> {
  try {
    const fs = await import("node:fs/promises");
    const yaml = await import("yaml");
    const raw = await fs.readFile(projectsYamlPath, "utf8");
    // biome-ignore lint/suspicious/noExplicitAny: yaml shape varies
    const parsed = yaml.parse(raw) as Record<string, any>;
    const m = new Map<string, ProjectMeta>();
    for (const [, val] of Object.entries(parsed ?? {})) {
      if (!val || typeof val !== "object") {
        continue;
      }
      const linearTeam = val.linear_team as string | undefined;
      if (!linearTeam) {
        continue;
      }
      m.set(linearTeam, {
        business: val.business as string,
        visibility: val.visibility === "personal" ? "personal" : "work",
        protectMode: Boolean(val.protect_mode),
        protectReason: val.protect_reason as string | undefined,
        slackChannel: val.slack as string | undefined,
      });
    }
    return m;
  } catch {
    return new Map();
  }
}
