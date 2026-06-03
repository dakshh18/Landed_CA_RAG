"use client";

// Left rail: brand mark + "new chat" + corpus list. Intentionally minimal —
// no fake nav destinations; the corpus IS the surface that matters.
import { Plus, Leaf } from "lucide-react";
import { CorpusList } from "@/components/sidebar/CorpusList";

interface Props {
  onNewChat: () => void;
}

export function Sidebar({ onNewChat }: Props) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-landed-border bg-white">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-landed-red text-white shadow-card">
          <Leaf className="h-4 w-4" />
        </div>
        <div>
          <div className="text-base font-semibold leading-none text-landed-navy">
            Landed
          </div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-landed-muted">
            Immigration assistant
          </div>
        </div>
      </div>

      {/* New chat */}
      <div className="px-4 pb-4">
        <button
          onClick={onNewChat}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-landed-red px-3 py-2 text-sm font-medium text-white shadow-card transition hover:bg-landed-red-hover"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>

      {/* Corpus list (scrolls if it overflows) */}
      <div className="flex-1 overflow-y-auto border-t border-landed-border px-4 py-4">
        <CorpusList />
      </div>

      {/* Footer note — not a destination, just orientation */}
      <div className="border-t border-landed-border px-5 py-3 text-[10px] text-landed-muted">
        Snapshot dates show when each document was last fetched. Rules change — verify on canada.ca.
      </div>
    </aside>
  );
}
