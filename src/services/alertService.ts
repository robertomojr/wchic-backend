/**
 * alertService.ts
 *
 * Tarefa #12 — Logs e alertas de erro
 *
 * Envia alertas em tempo real via:
 * - WhatsApp (Meta Cloud API — número já configurado)
 * - E-mail (Gmail SMTP via nodemailer)
 *
 * Uso:
 *   import { alert } from "./alertService.js";
 *   alert("podio_sync_error", "Podio sync falhou", { lead_id, error });
 *
 * Nunca lança exceção — falha silenciosamente para não cascatear erros.
 */

import axios from "axios";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Tipos de alerta
// ---------------------------------------------------------------------------
export type AlertType =
  | "podio_sync_error"
  | "lead_not_routed"
  | "whatsapp_webhook_error"
  | "database_error"
  | "generic_error";

const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  podio_sync_error:       "🔴 Podio Sync Falhou",
  lead_not_routed:        "🟡 Lead Sem Roteamento",
  whatsapp_webhook_error: "🔴 Erro no Webhook WhatsApp",
  database_error:         "🔴 Erro de Banco de Dados",
  generic_error:          "🔴 Erro no Sistema",
};

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------
export async function alert(
  type: AlertType,
  message: string,
  details?: Record<string, any>
): Promise<void> {
  const label = ALERT_TYPE_LABEL[type];
  const timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const detailStr = details ? formatDetails(details) : "";

  const whatsappText =
    `*[WChic Alert]*\n` +
    `${label}\n` +
    `📅 ${timestamp}\n` +
    `📝 ${message}` +
    (detailStr ? `\n\n${detailStr}` : "");

  const emailHtml =
    `<h2 style="color:#c0392b">${label}</h2>` +
    `<p><strong>Data/Hora:</strong> ${timestamp}</p>` +
    `<p><strong>Mensagem:</strong> ${message}</p>` +
    (details ? `<pre style="background:#f4f4f4;padding:12px;border-radius:4px">${JSON.stringify(details, null, 2)}</pre>` : "");

  // Dispara ambos em paralelo, sem bloquear
  await Promise.allSettled([
    sendWhatsAppAlert(whatsappText),
    sendEmailAlert(`[WChic] ${label}`, emailHtml),
  ]);
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------
async function sendWhatsAppAlert(text: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_OPS_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const alertTo = process.env.ALERT_WHATSAPP_TO;

  if (!phoneNumberId || !accessToken || !alertTo) {
    logger.warn("WhatsApp alert ignorado: variáveis não configuradas");
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: alertTo.replace(/\D/g, ""),
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    logger.info("WhatsApp alert enviado", { to: alertTo });
  } catch (err: any) {
    logger.error("Falha ao enviar WhatsApp alert", {
      error: err?.response?.data ?? err?.message,
    });
  }
}

// ---------------------------------------------------------------------------
// E-mail (Gmail SMTP via nodemailer — importação dinâmica)
// ---------------------------------------------------------------------------
async function sendEmailAlert(subject: string, html: string): Promise<void> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const alertEmail = process.env.ALERT_EMAIL_TO;

  if (!smtpUser || !smtpPass || !alertEmail) {
    logger.warn("E-mail alert ignorado: SMTP não configurado");
    return;
  }

  try {
    // Importação dinâmica para não quebrar o build caso nodemailer não esteja instalado
    const nodemailer = await import("nodemailer");

    const transporter = nodemailer.default.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: `"WChic Sistema" <${smtpUser}>`,
      to: alertEmail,
      subject,
      html,
    });

    logger.info("E-mail alert enviado", { to: alertEmail, subject });
  } catch (err: any) {
    logger.error("Falha ao enviar e-mail alert", { error: err?.message });
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function formatDetails(details: Record<string, any>): string {
  return Object.entries(details)
    .map(([k, v]) => `• *${k}:* ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("\n");
}
