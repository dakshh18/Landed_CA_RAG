"use client";

interface Props {
  label: string;
  onClick: () => void;
}

export function SuggestionChip({ label, onClick }: Props) {
  return (
    <button onClick={onClick} className="chip">
      {label}
    </button>
  );
}
