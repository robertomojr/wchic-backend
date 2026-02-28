import express from "express";
import { apiRateLimit } from "./utils/rateLimit.js";
import { logger } from "./utils/logger.js";

// Rotas
import { webhookRouter } from "./routes/webhooks.js";
import { podioWebhookRouter } from "./routes/podioWebhook.js";
import { authRouter } from "./routes/auth.js";
import { leadsIntake } from "./routes/leadsIntake.js";
import { leadsRouter } from "./routes/leads.js";

export const app = express();

app.set("trust proxy", 1); 

/**
 * JSON body + rawBody (necessário para WhatsApp Webhook)
 */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString();
    },
  })
);

/**
 * Rate limit global
 */
app.use(apiRateLimit);

/**
 * Health / Home
 */
app.get("/", (_req, res) => {
  res.status(200).send("WChic backend OK");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * GET /health/alert-test — Dispara alerta de teste (WhatsApp + e-mail)
 * Remover após validar Tarefa #12.
 */
app.get("/health/alert-test", async (_req, res) => {
  const { alert } = await import("./services/alertService.js");
  await alert("generic_error", "Teste de alerta WChic — sistema funcionando!", {
    origem: "health/alert-test",
    timestamp: new Date().toISOString(),
  });
  res.json({ ok: true, message: "Alerta disparado — verifique WhatsApp e e-mail" });
});

/**
 * Gateway lead-first (CANÔNICO)
 */
app.post("/gateway/intake", leadsIntake);

/**
 * Webhooks externos (WhatsApp, Podio)
 */
app.use("/webhook", webhookRouter);
app.use("/webhook", podioWebhookRouter);

/**
 * API autenticada
 */
app.use("/leads", leadsRouter);
app.use("/auth", authRouter);

/**
 * Handler global de erro (sempre por último)
 */
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error("Unhandled error", { error: String(err) });
    res.status(500).json({ error: "Internal server error" });
  }
);