// `GET /api/documents` — corpus listing for the UI sidebar so users can see
// exactly what the assistant was trained on (transparency = trust).
import { Router } from "express";
import { pool } from "../db/pool";

export const documentsRouter = Router();

interface DocRow {
  id: number;
  title: string;
  source_url: string | null;
  lang: string;
  file_name: string;
  fetched_at: Date | null;
  chunk_count: number;
}

documentsRouter.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query<DocRow>(
      `SELECT d.id, d.title, d.source_url, d.lang, d.file_name, d.fetched_at,
              COUNT(c.id)::int AS chunk_count
       FROM documents d
       LEFT JOIN chunks c ON c.document_id = d.id
       GROUP BY d.id
       ORDER BY d.title ASC`
    );
    res.json({
      documents: result.rows.map((r) => ({
        ...r,
        fetched_at: r.fetched_at ? new Date(r.fetched_at).toISOString().slice(0, 10) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});
