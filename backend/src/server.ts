// Express bootstrap. Phase 1 routes only — chat/SSE land in Phase 2.
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { documentsRouter } from "./routes/documents";
import { chatRouter } from "./routes/chat";

const app = express();

// Behind Caddy (reverse proxy) in production. Trust the first proxy hop so
// req.ip and express-rate-limit read the real client IP from X-Forwarded-For
// instead of the proxy's address.
app.set("trust proxy", 1);

// --- Security & basics ------------------------------------------------------
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "256kb" }));

// Light global rate limit; the per-route limit on /api/chat lands in Phase 2.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Routes -----------------------------------------------------------------
app.use("/api/health", healthRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/chat", chatRouter);

// --- 404 + error handlers ---------------------------------------------------
app.use((_req, res) => res.status(404).json({ error: "not_found" }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // body-parser surfaces JSON failures with type === 'entity.parse.failed'.
  // Those are client errors (bad input), not server crashes — return 400.
  if (err?.type === "entity.parse.failed") {
    console.warn("Bad JSON body:", err.message);
    res.status(400).json({ error: "invalid_json", message: err.message });
    return;
  }
  console.error("Unhandled error:", err);
  const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
  res.status(status).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  console.log(`Landed API listening on http://localhost:${env.PORT}`);
});
