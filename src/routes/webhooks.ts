import { Router, Request, Response } from "express";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import {
  verifyWebhookSignature,
  parseIncomingMessages,
} from "../services/whatsappService.js";
import {
  findOrCreateLead,
  insertLeadMessage,
  upsertLeadEvent,
} from "../db/repositories.js";
import { processWithAI } from "../services/aiService.js";
import { alert } from "../services/alertService.js";

export const webhookRouter = Router();

/* ------------------------------------------------------------------ */
/*  GET /webhook/whatsapp — Verificação do Webhook (Meta Challenge)   */
/* ------------------------------------------------------------------ */
webhookRouter.get("/whatsapp", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"] as string | undefined;
  const token = req.query["hub.verify_token"] as string | undefined;
  const challenge = req.query["hub.challenge"] as string | undefined;

  if (
    mode === "subscribe" &&
    token === config.whatsapp.verifyTokenClients
  ) {
    logger.info("Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  logger.warn("Webhook verification failed", { mode, token });
  return res.status(403).send("Forbidden");
});

/* ------------------------------------------------------------------ */
/*  POST /webhook/whatsapp — Recebe mensagens reais do WhatsApp       */
/* ------------------------------------------------------------------ */
webhookRouter.post("/whatsapp", async (req: Request, res: Response) => {
  // 1) Responde 200 IMEDIATAMENTE (Meta exige < 5s)
  res.status(200).send("EVENT_RECEIVED");

  try {
    // 2) Valida assinatura (se APP_SECRET configurado)
    const rawBody = (req as any).rawBody;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;

    if (config.whatsapp.appSecret && !verifyWebhookSignature(rawBody, signature)) {
      logger.warn("WhatsApp webhook: invalid signature — ignoring");
      return;
    }

    // 3) Parseia mensagens
    const messages = parseIncomingMessages(req.body);

    if (messages.length === 0) {
      // Pode ser status update, read receipt, etc. — ignorar silenciosamente
      return;
    }

    // 4) Processa cada mensagem
    for (const msg of messages) {
      await processIncomingMessage(msg);
    }
  } catch (err) {
    logger.error("WhatsApp webhook processing error", { error: String(err) });
    alert("whatsapp_webhook_error", "Erro ao processar mensagem do WhatsApp", {
      error: String(err),
    }).catch(() => {});
  }
});

/* ------------------------------------------------------------------ */
/*  Processamento de cada mensagem recebida                           */
/* ------------------------------------------------------------------ */
type IncomingMsg = {
  from: string;
  id: string;
  timestamp: string;
  text?: string;
  type: string;
};

async function processIncomingMessage(msg: IncomingMsg) {
  // Ignora mensagens que não são texto (imagem, áudio, etc.) por enquanto
  if (msg.type !== "text" || !msg.text) {
    logger.info("Non-text message received, skipping", {
      type: msg.type,
      from: msg.from,
    });
    return;
  }

  // O número vem no formato "5511999999999" (sem +)
  const phoneE164 = msg.from.startsWith("+") ? msg.from : `+${msg.from}`;

  // external_id SEM data (será completado quando o lead informar a data do evento)
  const externalId = `wchic:wa:${phoneE164}`;

  logger.info("Processing WhatsApp message", {
    from: phoneE164,
    text: msg.text.substring(0, 100),
  });

  // 1) Find or create lead
  const lead = await findOrCreateLead({
    externalId,
    phoneE164,
    source: "whatsapp",
  });

  // 2) Salva a mensagem
  await insertLeadMessage({
    leadId: lead.id,
    role: "user",
    content: msg.text,
    stage: "qualification",
  });

  // 3) Upsert evento vazio (cria o registro para roteamento futuro)
  await upsertLeadEvent({
    leadId: lead.id,
  });

  logger.info("Lead processed from WhatsApp", {
    lead_id: lead.id,
    external_id: lead.external_id,
  });

  // 4) Chama IA para qualificar e responder (não-bloqueante)
  processWithAI(lead.id, phoneE164).catch((err) => {
    logger.error("IA: erro não tratado", { lead_id: lead.id, error: err?.message });
  });
}

