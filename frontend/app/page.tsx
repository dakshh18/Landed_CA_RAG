"use client";

// Top-level page state lives here:
//   - useChatStream owns messages + stream state
//   - we own composer draft, language, and which citation is open
import { useRef, useState } from "react";
import { DisclaimerBanner } from "@/components/layout/DisclaimerBanner";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { SourcePanel } from "@/components/chat/SourcePanel";
import { useChatStream } from "@/hooks/useChatStream";

export default function HomePage() {
  const [draft, setDraft] = useState("");
  const composerRef = useRef<ComposerHandle>(null);

  const { messages, status, currentTool, errorMessage, send, reset } =
    useChatStream();

  // SourcePanel state: which citation, on which message
  const [selected, setSelected] = useState<{
    msgIndex: number;
    citationId: number;
  } | null>(null);

  const selectedCitation =
    selected != null
      ? messages[selected.msgIndex]?.citations?.find(
          (c) => c.id === selected.citationId
        ) ?? null
      : null;

  const handleSend = (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text) return;
    setDraft("");
    setSelected(null); // close any open source panel on new turn
    send(text);
    setTimeout(() => composerRef.current?.focus(), 0);
  };

  const handleNewChat = () => {
    reset();
    setDraft("");
    setSelected(null);
    setTimeout(() => composerRef.current?.focus(), 0);
  };

  const hasMessages = messages.length > 0;
  const isInFlight =
    status === "submitting" ||
    status === "tool_running" ||
    status === "streaming";

  return (
    <div className="flex h-screen flex-col">
      <DisclaimerBanner />

      <div className="flex min-h-0 flex-1">
        <Sidebar onNewChat={handleNewChat} />

        <main className="flex min-w-0 flex-1 flex-col">
          {/* Conversation area + slide-out source panel */}
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Scrollable messages */}
              <div className="min-h-0 flex-1">
                {hasMessages ? (
                  <ChatWindow
                    messages={messages}
                    status={status}
                    currentTool={currentTool}
                    activeCitationId={selected?.citationId ?? null}
                    onSelectCitation={(citationId, msgIndex) =>
                      setSelected({ citationId, msgIndex })
                    }
                  />
                ) : (
                  <div className="h-full overflow-y-auto">
                    <EmptyState onPickSuggestion={(t) => handleSend(t)} />
                  </div>
                )}
              </div>

              {/* Error banner (rare; the server emits 'error' or fetch fails) */}
              {status === "error" && errorMessage && (
                <div className="mx-auto w-full max-w-3xl px-4">
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    Couldn't reach the assistant: {errorMessage}
                  </div>
                </div>
              )}

              {/* Composer pinned to the bottom */}
              <Composer
                ref={composerRef}
                value={draft}
                onChange={setDraft}
                onSubmit={() => handleSend()}
                disabled={isInFlight}
                placeholder={
                  isInFlight
                    ? "Working on the previous question…"
                    : "Ask about your move to Canada…"
                }
              />
            </div>

            <SourcePanel
              citation={selectedCitation}
              onClose={() => setSelected(null)}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
