"use client";

/**
 * A small markdown renderer.
 *
 * Why not react-markdown? The repo's pnpm policy (minimumReleaseAge) is
 * currently rejecting `pnpm install`, and we deliberately keep this
 * component dependency-free so a brief always renders even when the rest
 * of the package graph is in flux.
 *
 * Supported syntax (enough for brief.body_markdown):
 *   - Headings (# ## ### #### #####)
 *   - Paragraphs (blank-line separated)
 *   - Unordered lists ("- " or "* " prefix), nested up to 2 levels by leading-spaces
 *   - Ordered lists ("N. " prefix)
 *   - Bold (**...**), italic (*...* or _..._), inline code (`...`)
 *   - Links ([text](url))
 *   - Fenced code blocks (```)
 *   - Horizontal rules (--- on its own line)
 *
 * Everything else is rendered as plain text. The renderer escapes raw HTML
 * before applying transforms so a model that includes a stray `<script>`
 * tag in the brief cannot inject script execution.
 */

import { type ReactNode } from "react";

interface MdProps {
  text: string;
  className?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a single line's inline tokens. We operate on already-escaped text
 * and write back HTML strings (used inside dangerouslySetInnerHTML on a
 * controlled <span>). The set of tags we emit is intentionally tiny.
 */
function renderInline(escaped: string): string {
  let out = escaped;
  // Inline code first so its contents are not further transformed.
  out = out.replace(
    /`([^`]+)`/g,
    (_m, code) => `<code class="brief-code-inline">${code}</code>`,
  );
  // Links [text](url). Only allow http(s) and mailto schemes.
  out = out.replace(
    /\[([^\]]+)\]\(((?:https?|mailto):[^\s)]+)\)/g,
    (_m, text, url) =>
      `<a href="${url}" target="_blank" rel="noreferrer noopener" class="brief-link">${text}</a>`,
  );
  // Bold (**...**)
  out = out.replace(
    /\*\*([^*]+)\*\*/g,
    (_m, inner) => `<strong>${inner}</strong>`,
  );
  // Italic (*...* and _..._)
  out = out.replace(
    /(?<![*\w])\*([^*\n]+)\*(?!\*)/g,
    (_m, inner) => `<em>${inner}</em>`,
  );
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, (_m, inner) => `<em>${inner}</em>`);
  return out;
}

interface Block {
  type:
    | "heading"
    | "paragraph"
    | "ul"
    | "ol"
    | "code"
    | "rule"
    | "blockquote";
  level?: number;
  items?: Array<{ depth: number; text: string }>;
  text?: string;
  lang?: string;
}

function parseBlocks(raw: string): Block[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      // skip the closing fence
      if (i < lines.length) i++;
      blocks.push({ type: "code", text: buf.join("\n"), lang });
      continue;
    }

    // Blank line — skip
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,5})\s+(.*)$/);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }

    // Blockquote — collect consecutive `> ` lines
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", text: buf.join("\n") });
      continue;
    }

    // List (unordered or ordered) — collect contiguous list items.
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const isOrdered = /^\s*\d+\.\s+/.test(line);
      const items: Array<{ depth: number; text: string }> = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!m) break;
        const indent = m[1].length;
        items.push({
          depth: indent >= 4 ? 2 : indent >= 2 ? 1 : 0,
          text: m[3],
        });
        i++;
      }
      blocks.push({ type: isOrdered ? "ol" : "ul", items });
      continue;
    }

    // Paragraph — collect until blank/heading/list
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,5})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: buf.join(" ") });
  }
  return blocks;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const level = block.level ?? 2;
      const Tag = (
        ["h1", "h2", "h3", "h4", "h5"] as const
      )[Math.min(level - 1, 4)];
      return (
        <Tag
          key={key}
          className={`brief-h${level}`}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: contents pre-escaped
          dangerouslySetInnerHTML={{
            __html: renderInline(escapeHtml(block.text ?? "")),
          }}
        />
      );
    }
    case "paragraph": {
      return (
        <p
          key={key}
          className="brief-p"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: contents pre-escaped
          dangerouslySetInnerHTML={{
            __html: renderInline(escapeHtml(block.text ?? "")),
          }}
        />
      );
    }
    case "code": {
      return (
        <pre key={key} className="brief-pre" data-lang={block.lang ?? ""}>
          <code>{block.text}</code>
        </pre>
      );
    }
    case "rule":
      return <hr key={key} className="brief-hr" />;
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="brief-quote"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: contents pre-escaped
          dangerouslySetInnerHTML={{
            __html: renderInline(escapeHtml(block.text ?? "")),
          }}
        />
      );
    case "ul":
    case "ol": {
      const Tag = block.type === "ol" ? "ol" : "ul";
      // We only respect depth==0 vs depth>0 by emitting a nested list of
      // the same kind directly under the previous top-level <li>.
      const items = block.items ?? [];
      const nodes: ReactNode[] = [];
      let currentTopIdx = -1;
      const nested: Array<Array<{ text: string }>> = [];
      items.forEach((it) => {
        if (it.depth === 0) {
          currentTopIdx = nested.length;
          nested.push([]);
        } else if (currentTopIdx >= 0) {
          nested[currentTopIdx].push({ text: it.text });
        }
      });
      let topIdx = 0;
      items.forEach((it) => {
        if (it.depth !== 0) return;
        const subItems = nested[topIdx] ?? [];
        nodes.push(
          <li key={`${key}-${topIdx}`} className="brief-li">
            <span
              // biome-ignore lint/security/noDangerouslySetInnerHtml: contents pre-escaped
              dangerouslySetInnerHTML={{
                __html: renderInline(escapeHtml(it.text)),
              }}
            />
            {subItems.length > 0 && (
              <ul className="brief-li-nested">
                {subItems.map((s, j) => (
                  <li
                    key={`${key}-${topIdx}-${j}`}
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: contents pre-escaped
                    dangerouslySetInnerHTML={{
                      __html: renderInline(escapeHtml(s.text)),
                    }}
                  />
                ))}
              </ul>
            )}
          </li>,
        );
        topIdx++;
      });
      return (
        <Tag key={key} className="brief-list">
          {nodes}
        </Tag>
      );
    }
    default:
      return null;
  }
}

export function Markdown({ text, className }: MdProps): ReactNode {
  const blocks = parseBlocks(text);
  return (
    <div className={className ? `brief-md ${className}` : "brief-md"}>
      {blocks.map(renderBlock)}
    </div>
  );
}

export default Markdown;
