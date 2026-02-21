import type { ReactNode } from "react";

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "unordered_list"; items: string[] }
  | { type: "ordered_list"; items: string[] }
  | { type: "code_block"; language?: string; code: string }
  | { type: "blockquote"; lines: string[] };

const inlineTokenPattern =
  /(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(__(.+?)__)|(\*([^*\n]+)\*)|(_([^_\n]+)_)/g;

export function isMarkdownBlockStart(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^```/.test(trimmed) ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed)
  );
}

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    const codeFence = trimmed.match(/^```([\w-]+)?\s*$/);
    if (codeFence) {
      const language = codeFence[1]?.trim() || undefined;
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length) {
        const next = lines[index] ?? "";
        if (next.trim().startsWith("```")) {
          index += 1;
          break;
        }
        codeLines.push(next);
        index += 1;
      }
      blocks.push({ type: "code_block", language, code: codeLines.join("\n") });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const next = (lines[index] ?? "").trim();
        if (!/^>\s?/.test(next)) {
          break;
        }
        quoteLines.push(next.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const next = (lines[index] ?? "").trim();
        if (!/^[-*]\s+/.test(next)) {
          break;
        }
        items.push(next.replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "unordered_list", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const next = (lines[index] ?? "").trim();
        if (!/^\d+\.\s+/.test(next)) {
          break;
        }
        items.push(next.replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ordered_list", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const nextRaw = lines[index] ?? "";
      const nextTrimmed = nextRaw.trim();

      if (nextTrimmed.length === 0 || isMarkdownBlockStart(nextRaw)) {
        break;
      }

      paragraphLines.push(nextRaw);
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraphLines });
  }

  return blocks;
}

export function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(inlineTokenPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex));
    }

    if (match[2]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${tokenIndex}`}
          className="rounded bg-[var(--surface-overlay)] px-1 py-0.5 font-mono text-[12px] text-ink-100"
        >
          {match[2]}
        </code>
      );
    } else if (match[4] && match[5]) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${tokenIndex}`}
          href={match[5]}
          target="_blank"
          rel="noreferrer"
          className="text-ember-300 underline underline-offset-2 hover:text-ember-200"
        >
          {renderInlineMarkdown(match[4], `${keyPrefix}-link-text-${tokenIndex}`)}
        </a>
      );
    } else if (match[7] || match[9]) {
      const value = match[7] ?? match[9] ?? "";
      nodes.push(
        <strong key={`${keyPrefix}-strong-${tokenIndex}`} className="font-semibold text-ink-100">
          {renderInlineMarkdown(value, `${keyPrefix}-strong-text-${tokenIndex}`)}
        </strong>
      );
    } else if (match[11] || match[13]) {
      const value = match[11] ?? match[13] ?? "";
      nodes.push(
        <em key={`${keyPrefix}-em-${tokenIndex}`} className="italic">
          {renderInlineMarkdown(value, `${keyPrefix}-em-text-${tokenIndex}`)}
        </em>
      );
    }

    cursor = matchIndex + match[0].length;
    tokenIndex += 1;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

export function renderInlineMarkdownWithLineBreaks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];

  lines.forEach((line, index) => {
    nodes.push(...renderInlineMarkdown(line, `${keyPrefix}-line-${index}`));
    if (index < lines.length - 1) {
      nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    }
  });

  return nodes;
}
