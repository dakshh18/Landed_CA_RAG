import { Router } from "express";
import { pingDb } from "../db/pool";
import { env } from "../config/env";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const dbOk = await pingDb();
  res.json({
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "up" : "down",
    model: env.CHAT_MODEL,
    embeddingModel: env.EMBEDDING_MODEL,
  });
});
