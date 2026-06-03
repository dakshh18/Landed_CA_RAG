"use client";

// =============================================================================
// AssistantContent — markdown + inline citation chips.
// =============================================================================
// The model outputs Markdown with bracketed citation markers like:
//   "Express Entry uses the Comprehensive Ranking System [1][3]."
//
// react-markdown handles the Markdown bit. We then walk the rendered React
// tree and, anywhere we hit a text node containing `[n]`, splice in a
// CitationChip component for each match. This keeps Markdown parsing
// untouched and gives us interactive chips.
// =============================================================================

import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CitationChip } from "./CitationChip";
import type { Citation } from "@/lib/types";

interface Props {
  text: string;
  citations: Citation[];
  activeCitationId: number | null;
  onSelectCitation: (id: number) => void;
}

export function AssistantContent({
  text,
  citations,
  activeCitationId,
  onSelectCitation,
}: Props) {
  const citationMap = new Map(citations.map((c) => [c.id, c]));

  // Walk rendered children; replace `[n]` text fragments with chips.
  const inject = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === "string" || typeof node === "number") {
      const parts = String(node).split(/(\[\d+\])/g);
      if (parts.length === 1) return node;
      return parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (m) {
          const id = Number(m[1]);
          if (citationMap.has(id)) {
            return (
              <CitationChip
                key={`cite-${i}-${id}`}
                id={id}
                active={activeCitationId === id}
                onClick={() => onSelectCitation(id)}
              />
            );
          }
        }
        return <React.Fragment key={`t-${i}`}>{part}</React.Fragment>;
      });
    }
    if (Array.isArray(node)) {
      return node.map((n, i) => (
        <React.Fragment key={`arr-${i}`}>{inject(n)}</React.Fragment>
      ));
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
      const childProps = node.props as { children?: React.ReactNode };
      return React.cloneElement(node, {}, inject(childProps.children));
    }
    return node;
  };

  // Override Markdown elements so we can inject citation chips into their text.
  const components: Components = {
    p: ({ children }) => (
      <p className="mb-2 last:mb-0 leading-relaxed">{inject(children)}</p>
    ),
    ul: ({ children }) => (
      <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{inject(children)}</li>,
    strong: ({ children }) => (
      <strong className="font-semibold text-landed-navy">{inject(children)}</strong>
    ),
    em: ({ children }) => <em className="italic">{inject(children)}</em>,
    h1: ({ children }) => (
      <h1 className="mb-2 text-base font-semibold text-landed-navy">{inject(children)}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 text-base font-semibold text-landed-navy">{inject(children)}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-2 text-sm font-semibold text-landed-navy">{inject(children)}</h3>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-landed-navy-light underline underline-offset-2 hover:text-landed-navy"
      >
        {children}
      </a>
    ),
    code: ({ children }) => (
      <code className="rounded bg-landed-bg px-1 py-0.5 font-mono text-[12px] text-landed-navy">
        {children}
      </code>
    ),
  };

  return (
    <div className="text-[14px] text-landed-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
