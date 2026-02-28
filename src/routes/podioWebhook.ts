/**
 * POST /webhook/podio — Recebe notificações do Podio
 *
 * Tarefa #11 — Sincronização bidirecional de status
 *
 * Dois tipos de eventos chegam aqui:
 * 1. hook.verify  → Podio pede confirmação ao registrar o webhook
 * 2. item.update  → Podio avisa que um item foi atualizado
 */

import { Router, Request, Response } from "express";
import { processIncomingPodioHook } from "../services/podioSyncService.js";
import { logger } from "../utils/logger.js";

export const podioWebhookRouter = Router();

podioWebhookRouter.post("/podio", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const type = body.type;

  logger.info("Podio webhook recebido", { type, item_id: body.item_id ?? body.data?.item_id });

  // 1) Verificação de hook — Podio exige resposta imediata com hook_id
  if (type === "hook.verify") {
    const hookId = body.hook_id ?? body.data?.hook_id;
    if (!hookId) {
      logger.warn("hook.verify sem hook_id");
      return res.status(400).send("missing hook_id");
    }

    try {
      // Confirma o webhook chamando a API do Podio
      const { default: axios } = await import("axios");
      await axios.post(
        `https://api.podio.com/hook/${hookId}/verify/validate`,
        { code: body.code ?? body.data?.code },
        {
          headers: {
            "Content-Type": "application/json",
            // Usa autenticação básica com client credentials para esta chamada pública
          },
        }
      );
      logger.info("Podio hook verificado com sucesso", { hookId });
    } catch (err: any) {
      logger.error("Erro ao verificar Podio hook", { hookId, err: err?.message });
    }

    return res.status(200).send("OK");
  }

  // 2) Responde 200 imediatamente (Podio exige resposta rápida)
  res.status(200).send("OK");

  // 3) Processa o evento de forma assíncrona
  processIncomingPodioHook(body).catch((err) => {
    logger.error("Erro ao processar Podio hook", { type, error: String(err?.message ?? err) });
  });
});
