"use client";

// Textarea + send button. Enter submits, Shift+Enter inserts a newline. The
// `value` is controlled by the parent so suggestion chips can prefill it.
import { ArrowUp } from "lucide-react";
import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { cn } from "@/lib/cn";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export interface ComposerHandle {
  focus: () => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { value, onChange, onSubmit, disabled, placeholder },
  ref
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus() }));

  // Auto-grow the textarea up to ~6 lines. Keeps the input compact when empty.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-landed-border bg-white p-2.5 shadow-card transition",
          "focus-within:border-landed-navy-light"
        )}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          disabled={disabled}
          placeholder={placeholder ?? "Ask about your move to Canada…"}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-landed-ink placeholder:text-landed-muted focus:outline-none disabled:opacity-60"
        />
        <button
          aria-label="Send"
          onClick={onSubmit}
          disabled={!canSend}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition",
            canSend
              ? "bg-landed-red text-white hover:bg-landed-red-hover"
              : "bg-landed-border text-landed-muted"
          )}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
      <p className="mx-1 mt-2 text-center text-[11px] text-landed-muted">
        Landed can make mistakes. Verify critical dates and amounts on canada.ca.
      </p>
    </div>
  );
});
