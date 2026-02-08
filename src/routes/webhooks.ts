import { Router } from "express";

export const webhookRouter = Router();

/**
 * Webhook temporariamente desativado
 * (refactor para lead-first em andamento)
 */
webhookRouter.post("/", (_req, res) => {
  res.status(200).json({ ok: true });
});

