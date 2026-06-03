// Shared types — mirror what the backend returns.

export interface DocumentRow {
  id: number;
  title: string;
  source_url: string | null;
  lang: string;
  file_name: string;
  fetched_at: string | null;   // ISO date (YYYY-MM-DD)
  chunk_count: number;
}

export interface DocumentsResponse {
  documents: DocumentRow[];
}

export interface HealthResponse {
  status: "ok" | "degraded";
  db: "up" | "down";
  model: string;
  embeddingModel: string;
}

// Chat types.

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  // assistant-only fields, populated as the stream lands
  refused?: boolean;
  refuseReason?: string;
  citations?: Citation[];   // ordered by id; populated by citation events
  latencyMs?: number;
}

export interface Citation {
  id: number;
  title: string;
  url: string | null;
  page: number | null;
  fetchedAt: string | null;
  passage: string;
  source: "corpus" | "web";
}

// State machine for the in-flight turn. The UI maps each state to a visible
// affordance: spinner, tool pill, streaming cursor, refuse banner, etc.
export type StreamStatus =
  | "idle"
  | "submitting"
  | "tool_running"
  | "streaming"
  | "done"
  | "refused"
  | "error";

export interface ToolEvent {
  name: "retrieve_docs" | "web_search" | string;
  status: "running" | "done";
  query?: string;
}
