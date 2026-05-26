/**
 * Zod schemas for PR review workflow.
 *
 * The schemas double as JSON Schema exports for the worker's prompt assembly:
 * when the worker dispatches an LLM call, it embeds the JSON Schema in the
 * prompt and validates the response back through Zod here.
 */

import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "major", "minor", "nit"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  severity: SeveritySchema,
  category: z
    .enum([
      "bug",
      "security",
      "performance",
      "correctness",
      "style",
      "maintainability",
      "test-coverage",
      "documentation",
    ])
    .default("correctness"),
  message: z.string().min(1),
  suggestion: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const CodexReviewSchema = z.object({
  findings: z.array(FindingSchema).default([]),
  summary: z.string().default(""),
  rawModel: z.string().optional(),
});
export type CodexReview = z.infer<typeof CodexReviewSchema>;

export const ClaudeValidateSchema = z.object({
  agreement: z.enum(["agree", "partial", "disagree"]),
  validatedFindings: z.array(FindingSchema).default([]),
  newFindings: z.array(FindingSchema).default([]),
  rejectedFindings: z
    .array(
      z.object({
        finding: FindingSchema,
        reason: z.string(),
      })
    )
    .default([]),
  rationale: z.string().default(""),
});
export type ClaudeValidate = z.infer<typeof ClaudeValidateSchema>;

export const VerifyInContextSchema = z.object({
  contextNotes: z.string().default(""),
  finalFindings: z.array(FindingSchema).default([]),
  // Findings that were dropped because they conflict with project context
  droppedFindings: z
    .array(
      z.object({
        finding: FindingSchema,
        reason: z.string(),
      })
    )
    .default([]),
});
export type VerifyInContext = z.infer<typeof VerifyInContextSchema>;

export const FixProposeSchema = z.object({
  branch: z.string().optional(),
  patch: z.string().default(""), // unified diff
  rationale: z.string().default(""),
  commitMessage: z.string().default(""),
  filesTouched: z.array(z.string()).default([]),
});
export type FixPropose = z.infer<typeof FixProposeSchema>;

export const FixValidateSchema = z.object({
  approved: z.boolean(),
  rationale: z.string().default(""),
  // Hard blockers — even a force-yes policy must respect these
  hardBlockers: z.array(z.string()).default([]),
});
export type FixValidate = z.infer<typeof FixValidateSchema>;

// ---------- JSON Schema exports for worker prompt assembly ----------
// We derive a minimal hand-written JSON Schema (Zod->JSON Schema is loose
// across versions; for prompt embedding, a stable hand-written shape is fine).

export const CODEX_REVIEW_JSON_SCHEMA = {
  type: "object",
  required: ["findings", "summary"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "severity", "message"],
        properties: {
          file: { type: "string" },
          line: { type: "integer", minimum: 0 },
          endLine: { type: "integer", minimum: 0 },
          severity: {
            type: "string",
            enum: ["critical", "major", "minor", "nit"],
          },
          category: {
            type: "string",
            enum: [
              "bug",
              "security",
              "performance",
              "correctness",
              "style",
              "maintainability",
              "test-coverage",
              "documentation",
            ],
          },
          message: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
    summary: { type: "string" },
  },
} as const;

export const CLAUDE_VALIDATE_JSON_SCHEMA = {
  type: "object",
  required: ["agreement", "validatedFindings", "rationale"],
  properties: {
    agreement: { type: "string", enum: ["agree", "partial", "disagree"] },
    validatedFindings: {
      type: "array",
      items: CODEX_REVIEW_JSON_SCHEMA.properties.findings.items,
    },
    newFindings: {
      type: "array",
      items: CODEX_REVIEW_JSON_SCHEMA.properties.findings.items,
    },
    rejectedFindings: {
      type: "array",
      items: {
        type: "object",
        required: ["finding", "reason"],
        properties: {
          finding: CODEX_REVIEW_JSON_SCHEMA.properties.findings.items,
          reason: { type: "string" },
        },
      },
    },
    rationale: { type: "string" },
  },
} as const;

export const VERIFY_IN_CONTEXT_JSON_SCHEMA = {
  type: "object",
  required: ["contextNotes", "finalFindings"],
  properties: {
    contextNotes: { type: "string" },
    finalFindings: {
      type: "array",
      items: CODEX_REVIEW_JSON_SCHEMA.properties.findings.items,
    },
    droppedFindings: {
      type: "array",
      items: {
        type: "object",
        required: ["finding", "reason"],
        properties: {
          finding: CODEX_REVIEW_JSON_SCHEMA.properties.findings.items,
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export const FIX_PROPOSE_JSON_SCHEMA = {
  type: "object",
  required: ["patch", "rationale", "commitMessage"],
  properties: {
    branch: { type: "string" },
    patch: { type: "string" },
    rationale: { type: "string" },
    commitMessage: { type: "string" },
    filesTouched: { type: "array", items: { type: "string" } },
  },
} as const;

export const FIX_VALIDATE_JSON_SCHEMA = {
  type: "object",
  required: ["approved", "rationale"],
  properties: {
    approved: { type: "boolean" },
    rationale: { type: "string" },
    hardBlockers: { type: "array", items: { type: "string" } },
  },
} as const;
