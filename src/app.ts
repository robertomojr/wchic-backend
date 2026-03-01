import express from "express";
import { apiRateLimit } from "./utils/rateLimit.js";
import { logger } from "./utils/logger.js";

// Rotas
import { webhookRouter } from "./routes/webhooks.js";
import { podioWebhookRouter } from "./routes/podioWebhook.js";
import { authRouter } from "./routes/auth.js";
import { leadsIntake } from "./routes/leadsIntake.js";
import { leadsRouter } from "./routes/leads.js";
import { dashboardRouter } from "./routes/dashboard.js";

export const app = express();

app.set("trust proxy", 1); 

/**
 * CORS — permite o dashboard SPA acessar a API
 * DEVE ficar antes de tudo (body parser, rate limit) para que
 * respostas de erro também incluam os headers de CORS.
 */
app.use((req, res, next) => {
  const allowed = process.env.DASHBOARD_URL ?? "*";
  res.header("Access-Control-Allow-Origin", allowed);
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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
  // Responde imediatamente, alerta vai em background
  res.json({ ok: true, message: "Alerta disparado em background — verifique WhatsApp e e-mail em alguns segundos" });

  const { alert } = await import("./services/alertService.js");
  alert("generic_error", "Teste de alerta WChic — sistema funcionando!", {
    origem: "health/alert-test",
    timestamp: new Date().toISOString(),
  }).catch((err) => console.error("Erro no alert-test:", err?.message));
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
 * Dashboard (Tarefa #14)
 */
app.use("/dash", dashboardRouter);

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