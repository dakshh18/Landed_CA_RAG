// =============================================================================
// HYBRID RETRIEVAL — the heart of a serious RAG system.
// =============================================================================
// Two complementary search techniques, fused into one ranked list:
//
//  1) VECTOR / SEMANTIC SEARCH
//     We embed the user's query and find chunks whose embedding is geometrically
//     closest. `embedding <=> $vec` in pgvector returns *cosine distance* — so
//     smaller = more similar. The HNSW index makes this fast.
//     Strength: handles paraphrases ("how do they rank me?" ≈ "ranking criteria").
//     Weakness: misses exact strings the embedding compresses away — form
//     numbers like "IMM 5257", dollar amounts, year mentions.
//
//  2) FULL-TEXT (KEYWORD) SEARCH
//     Postgres tsvector + ts_rank. Strength is exactly what vector misses:
//     exact terms, numbers, acronyms.
//
//  3) RECIPROCAL RANK FUSION (RRF)
//     Cheap, robust fusion algorithm. For each chunk that appears in either
//     ranked list, score = Σ 1/(k + rank). Constant k=60 is the canonical
//     value from the original RRF paper. Documents that show up high in *both*
//     rankings win — that's the whole point of "hybrid".
//
// Return what the agent (and citation UI) need: content, doc title/url/page,
// fetched_at (for the "as of" disclaimer), and the RRF score.
// =============================================================================

import { pool } from "../db/pool";
import { embedBatch, toPgVector } from "../ingestion/embed";

export interface RetrievedChunk {
  chunk_id: number;
  document_id: number;
  document_title: string;
  source_url: string | null;
  page: number | null;
  fetched_at: string | null; // ISO date
  content: string;
  score: number;             // RRF score; higher = more relevant
}

interface CandidateRow {
  chunk_id: number;
  document_id: number;
  document_title: string;
  source_url: string | null;
  page: number | null;
  fetched_at: Date | null;
  content: string;
}

const ARM_LIMIT = 20;   // pull top-20 from each arm before fusing
const RRF_K = 60;        // standard RRF constant

export type RetrievalMode = "hybrid" | "vector";

/**
 * Hybrid retrieval. Returns up to `k` chunks ordered by RRF score (desc).
 *
 * `mode` lets the eval harness compare vector-only vs hybrid. Default is
 * `hybrid` because that's what the production agent uses.
 */
export async function retrieveDocs(
  query: string,
  k = 8,
  mode: RetrievalMode = "hybrid"
): Promise<RetrievedChunk[]> {
  if (!query.trim()) return [];

  // -- Arm 1: vector ---------------------------------------------------------
  const [queryEmbedding] = await embedBatch([query]);
  const vecRes = await pool.query<CandidateRow>(
    `SELECT
       c.id AS chunk_id,
       c.document_id,
       d.title AS document_title,
       d.source_url,
       c.page,
       d.fetched_at,
       c.content
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [toPgVector(queryEmbedding!), ARM_LIMIT]
  );

  // -- Arm 2: full-text (skipped in vector-only mode for the eval A/B) -------
  // plainto_tsquery is forgiving: turns any user input into a safe tsquery.
  const ftsRes =
    mode === "vector"
      ? { rows: [] as CandidateRow[] }
      : await pool.query<CandidateRow>(
          `SELECT
             c.id AS chunk_id,
             c.document_id,
             d.title AS document_title,
             d.source_url,
             c.page,
             d.fetched_at,
             c.content
           FROM chunks c
           JOIN documents d ON d.id = c.document_id
           WHERE c.tsv @@ plainto_tsquery('english', $1)
           ORDER BY ts_rank(c.tsv, plainto_tsquery('english', $1)) DESC
           LIMIT $2`,
          [query, ARM_LIMIT]
        );

  // -- Fuse with RRF ---------------------------------------------------------
  const fused = new Map<number, RetrievedChunk>();

  const addArm = (rows: CandidateRow[]) => {
    rows.forEach((row, idx) => {
      const rank = idx + 1;             // 1-indexed
      const contrib = 1 / (RRF_K + rank);
      const existing = fused.get(row.chunk_id);
      if (existing) {
        existing.score += contrib;
      } else {
        fused.set(row.chunk_id, {
          chunk_id: row.chunk_id,
          document_id: row.document_id,
          document_title: row.document_title,
          source_url: row.source_url,
          page: row.page,
          fetched_at: row.fetched_at ? new Date(row.fetched_at).toISOString().slice(0, 10) : null,
          content: row.content,
          score: contrib,
        });
      }
    });
  };

  addArm(vecRes.rows);
  addArm(ftsRes.rows);

  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
