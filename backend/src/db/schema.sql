-- Landed schema. Run once per database (or use `pnpm db:init`).
--
-- Why two indexes on `chunks`?
--  * HNSW on the `embedding` column  -> approximate nearest neighbour search,
--    great at "semantically similar" queries (the meaning, not the words).
--  * GIN on the `tsv` tsvector       -> classic Postgres full-text, great at
--    exact terms the embedding ignores (form numbers like IMM 5257, dollar
--    amounts, program names). Together they form the "hybrid" search.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id           SERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    source_url   TEXT,
    lang         TEXT DEFAULT 'en',
    file_name    TEXT NOT NULL UNIQUE,
    fetched_at   DATE,
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
    id           SERIAL PRIMARY KEY,
    document_id  INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    page         INTEGER,
    chunk_index  INTEGER,
    content      TEXT NOT NULL,
    embedding    vector(1536),
    tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chunks_tsv_gin
  ON chunks USING gin (tsv);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx
  ON chunks (document_id);
