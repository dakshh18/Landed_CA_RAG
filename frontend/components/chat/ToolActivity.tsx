"use client";

// "Searching IRCC documents…" / "Checking canada.ca…" pill. Animated dot makes
// it feel alive without spinning a generic loader. Driven by useChatStream's
// `currentTool` — disappears as soon as the first token arrives.
import { cn } from "@/lib/cn";
import type { ToolEvent } from "@/lib/types";

const LABELS: Record<string, string> = {
  retrieve_docs: "Searching IRCC documents…",
  web_search: "Checking canada.ca…",
};

interface Props {
  tool: ToolEvent | null;
}

export function ToolActivity({ tool }: Props) {
  if (!tool) return null;
  const label = LABELS[tool.name] ?? `${tool.name}…`;

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-landed-border bg-white px-3 py-1.5 text-xs text-landed-navy shadow-card"
        )}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-landed-red opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-landed-red" />
        </span>
        <span>{label}</span>
        {tool.query && (
          <span className="text-landed-muted">— "{tool.query}"</span>
        )}
      </div>
    </div>
  );
}
