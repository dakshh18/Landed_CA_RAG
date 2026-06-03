"use client";

// Slide-out panel on the right that shows the exact passage behind a [n]
// marker. This is what proves "grounded, not hallucinated" in a demo:
// click [1] in the answer → here's the actual canada.ca text and the link.
import { ExternalLink, X } from "lucide-react";
import type { Citation } from "@/lib/types";

interface Props {
  citation: Citation | null;
  onClose: () => void;
}

export function SourcePanel({ citation, onClose }: Props) {
  const open = citation !== null;

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-l border-landed-border bg-white transition-[width] duration-200 ease-out ${
        open ? "w-[380px]" : "w-0 overflow-hidden"
      }`}
      aria-hidden={!open}
    >
      {citation && (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-landed-border px-5 py-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-landed-muted">
                Source [{citation.id}]
              </div>
              <h2 className="mt-1 text-sm font-semibold leading-snug text-landed-navy">
                {citation.title}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-landed-muted">
                {citation.page != null && <span>Page {citation.page}</span>}
                {citation.fetchedAt && (
                  <>
                    {citation.page != null && <span aria-hidden>·</span>}
                    <span>As of {citation.fetchedAt}</span>
                  </>
                )}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                    citation.source === "corpus"
                      ? "bg-landed-bg text-landed-navy"
                      : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {citation.source === "corpus" ? "IRCC corpus" : "Live web"}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close source"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-landed-muted hover:bg-landed-bg hover:text-landed-navy"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Passage */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="rounded-lg border-l-[3px] border-landed-red bg-landed-bg/60 p-3 text-[13px] leading-relaxed text-landed-ink">
              {citation.passage}
            </div>
          </div>

          {/* Footer link */}
          {citation.url && (
            <div className="border-t border-landed-border px-5 py-4">
              <a
                href={citation.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-landed-border bg-white px-3 py-2 text-sm font-medium text-landed-navy transition hover:border-landed-navy-light hover:text-landed-navy-light"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View on canada.ca
              </a>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
