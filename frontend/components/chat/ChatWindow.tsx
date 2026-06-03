"use client";

// =============================================================================
// ChatWindow — message list + autoscroll + tool-activity pill.
// =============================================================================
// Autoscroll behaviour: keep the latest token visible UNLESS the user has
// scrolled up to read earlier content (then we politely stop pinning to the
// bottom until they scroll back). This is the small detail that makes a chat
// UI feel like it was built by someone who actually uses chat apps.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, StreamStatus, ToolEvent } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";
import { ToolActivity } from "./ToolActivity";

interface Props {
  messages: ChatMessage[];
  status: StreamStatus;
  currentTool: ToolEvent | null;
  activeCitationId: number | null;
  onSelectCitation: (id: number, msgIndex: number) => void;
}

export function ChatWindow({
  messages,
  status,
  currentTool,
  activeCitationId,
  onSelectCitation,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  // Track whether the user is near the bottom. If they scroll up, we stop
  // forcing scroll on every new token so they can read older content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setPinnedToBottom(nearBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on new tokens / messages, but only while pinned.
  useEffect(() => {
    if (!pinnedToBottom) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, currentTool, pinnedToBottom]);

  const lastIdx = messages.length - 1;
  const isStreamingTurn =
    status === "submitting" ||
    status === "tool_running" ||
    status === "streaming";

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            isStreaming={isStreamingTurn && i === lastIdx}
            activeCitationId={activeCitationId}
            onSelectCitation={(id) => onSelectCitation(id, i)}
          />
        ))}
        <ToolActivity tool={currentTool} />
        <div ref={endRef} />
      </div>
    </div>
  );
}
