"use client";

// Three variants: user, assistant (with markdown + citations), refuse.
// The refuse variant is intentionally distinct — muted amber, no citation
// chips — so "I don't know from the docs" never reads like a confident answer.
import { AlertTriangle, Zap } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { AssistantContent } from "./AssistantContent";

interface Props {
  message: ChatMessage;
  isStreaming: boolean;
  activeCitationId: number | null;
  onSelectCitation: (id: number) => void;
}

export function MessageBubble({
  message,
  isStreaming,
  activeCitationId,
  onSelectCitation,
}: Props) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-landed-navy px-4 py-2.5 text-sm leading-relaxed text-white shadow-card">
          {message.content}
        </div>
      </div>
    );
  }

  // --- Assistant refuse variant ----------------------------------------------
  if (message.refused) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-card">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Not in my sources
          </div>
          <p className="leading-relaxed">
            {message.refuseReason ||
              "I couldn't find this in the official documents I have. Please verify on canada.ca."}
          </p>
        </div>
      </div>
    );
  }

  // --- Assistant normal answer -----------------------------------------------
  const isEmpty = !message.content && (!message.citations || message.citations.length === 0);
  const hasCitations = (message.citations?.length ?? 0) > 0;
  const isFinished = !isStreaming && message.latencyMs != null;
  const ungrounded = isFinished && !hasCitations && message.content.length > 0;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-landed-border bg-white px-4 py-3 shadow-card">
        {isEmpty ? (
          <span className="inline-block h-3 w-2 animate-pulse bg-landed-muted/60 align-middle" />
        ) : (
          <AssistantContent
            text={message.content}
            citations={message.citations ?? []}
            activeCitationId={activeCitationId}
            onSelectCitation={onSelectCitation}
          />
        )}

        {/* Streaming cursor at the end of in-progress answers */}
        {isStreaming && message.content.length > 0 && (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-landed-navy align-baseline" />
        )}

        {/* Footer: latency badge + ungrounded warning */}
        {(isFinished || ungrounded) && (
          <div className="mt-2.5 flex items-center gap-3 border-t border-landed-border/70 pt-2 text-[11px] text-landed-muted">
            {isFinished && message.latencyMs != null && (
              <span className="inline-flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {(message.latencyMs / 1000).toFixed(1)}s
              </span>
            )}
            {ungrounded && (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                No citations — verify before relying on this
              </span>
            )}
            {hasCitations && (
              <span className="text-landed-muted">
                {message.citations!.length} source{message.citations!.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
