"use client";

// Inline [n] marker rendered as a small red badge. Clicking opens the
// SourcePanel for that citation. The badge sits slightly above the baseline
// so it reads as a citation, not a bullet.
import { cn } from "@/lib/cn";

interface Props {
  id: number;
  onClick: () => void;
  active?: boolean;
}

export function CitationChip({ id, onClick, active }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open source ${id}`}
      className={cn(
        "mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-[1px] items-center justify-center rounded-full px-1 align-middle text-[10px] font-semibold leading-none text-white shadow-sm transition",
        active
          ? "bg-landed-navy ring-2 ring-landed-navy-light ring-offset-1"
          : "bg-landed-red hover:bg-landed-red-hover"
      )}
    >
      {id}
    </button>
  );
}
