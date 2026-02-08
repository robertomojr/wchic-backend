import express from "express";
import { apiRateLimit } from "./utils/rateLimit.js";
import { logger } from "./utils/logger.js";

import { webhookRouter } from "./routes/webhooks.js";
import { authRouter } from "./routes/auth.js";
import { conversationsRouter } from "./routes/conversations.js";
import { leadsRouter } from "./routes/leads.js";
import { franchisesRouter } from "./routes/franchises.js";
import { statsRouter } from "./routes/stats.js";

import { podioTest } from "./routes/podioTest.js";
import { podioExportApps } from "./routes/podioExportApps.js";
import { podioLeadTest } from "./routes/podioLeadTest.js";
import { routingResolve } from "./routes/routingResolve.js";
import { leadRouteTest } from "./routes/leadRouteTest.js";

export const app = express();

// JSON body + rawBody (para webhook do WhatsApp)
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString();
    },
  })
);

// Rate limit global
app.use(apiRateLimit);

// Home
app.get("/", (_req, res) => {
  res.status(200).send("WChic backend OK");
});

// Healthcheck
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Rotas de teste / debug
app.get("/podio/test", podioTest);
app.get("/podio/apps/export", podioExportApps);
app.get("/podio/lead/test", podioLeadTest);

// Roteamento (GET)
app.get("/routing/resolve", routingResolve);

// Simulação de lead (POST)
app.post("/leads/route-test", leadRouteTest);
app.post("/route-test", leadRouteTest);


// Rotas principais
app.use("/webhook", webhookRouter);
app.use("/auth", authRouter);
app.use("/conversations", conversationsRouter);
app.use("/leads", leadsRouter);
app.use("/franchises", franchisesRouter);
app.use("/stats", statsRouter);

// Handler global de erro (SEMPRE por último)
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

