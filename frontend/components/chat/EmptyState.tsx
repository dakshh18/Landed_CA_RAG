"use client";

// First-run welcome. The suggestion chips are NOT decoration — they prefill
// the composer and submit, getting the user from "looking at a chatbot" to
// "watching it work" in one click. That's the demo moment.
import { Leaf } from "lucide-react";
import { SuggestionChip } from "./SuggestionChip";

const SUGGESTIONS = [
  "How does Express Entry work?",
  "Can I work on a study permit?",
  "What proof of funds do I need?",
];

interface Props {
  onPickSuggestion: (text: string) => void;
}

export function EmptyState({ onPickSuggestion }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-6 pb-6 pt-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-landed-red text-white shadow-card">
        <Leaf className="h-7 w-7" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-landed-navy">
        How can I help you today?
      </h1>
      <p className="mt-3 max-w-md text-sm text-landed-muted">
        Immigration questions, answered from official IRCC documents — with
        citations to the exact source page.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <SuggestionChip key={s} label={s} onClick={() => onPickSuggestion(s)} />
        ))}
      </div>
    </div>
  );
}
