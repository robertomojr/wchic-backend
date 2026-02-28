import type { Request, Response } from "express";
import {
  findOrCreateLead,
  insertLeadMessage,
  upsertLeadEvent,
} from "../db/repositories.js";
import { syncLeadToPodio } from "../services/podioSyncService.js";
import { logger } from "../utils/logger.js";

/**
 * POST /gateway/intake
 * Lead-first gateway
 * Roteamento é feito no Supabase via trigger (lead_events.ibge_code).
 */
export async function leadsIntake(req: Request, res: Response) {
  const {
    telefone,
    cidade,
    estado,
    ibge_code,
    mensagem,
    event_start_date,
    event_end_date,
    perfil_evento_universal,
    pessoas_estimadas,
    decisor,
  } = req.body ?? {};

  if (!telefone) {
    return res.status(400).json({ ok: false, error: "Envie telefone" });
  }

  /**
   * 1) normaliza telefone (simples)
   */
  const digits = String(telefone).replace(/\D/g, "");
  const phoneE164 = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;

  /**
   * 2) gera external_id (imutável)
   * wchic:wa:+55XXXXXXXXXXX:YYYY-MM-DD (quando start_date existir)
   */
  const datePart = event_start_date ? `:${String(event_start_date)}` : "";
  const externalId = `wchic:wa:${phoneE164}${datePart}`;

  /**
   * 3) find or create lead
   */
  const lead = await findOrCreateLead({
    externalId,
    phoneE164,
    source: "whatsapp",
  });

  /**
   * 4) salva mensagem inicial (se houver)
   */
  if (mensagem) {
    await insertLeadMessage({
      leadId: lead.id,
      role: "user",
      content: String(mensagem),
      stage: "intake",
    });
  }

  /**
   * 5) salva/atualiza lead_event (1 por lead)
   * IMPORTANTE: trigger do Supabase roteia quando ibge_code entra/atualiza.
   */
  await upsertLeadEvent({
    leadId: lead.id,
    cidade: cidade ? String(cidade) : null,
    estado: estado ? String(estado) : null,
    ibgeCode: ibge_code ? String(ibge_code) : null,
    eventStartDate: event_start_date ? String(event_start_date) : null,
    eventEndDate: event_end_date ? String(event_end_date) : null,
    perfilEventoUniversal: perfil_evento_universal
      ? String(perfil_evento_universal)
      : null,
    pessoasEstimadas: pessoas_estimadas ? String(pessoas_estimadas) : null,
    decisor: typeof decisor === "boolean" ? decisor : null,
  });

  /**
   * 6) Tenta sincronizar com Podio (não-bloqueante)
   * Só faz efeito se ibge_code foi enviado (trigger já rodou e definiu franchise_id).
   * Erros do Podio não impedem a resposta ao cliente.
   */
  if (ibge_code) {
    syncLeadToPodio(lead.id).catch((err) => {
      logger.error("Podio sync falhou (intake)", {
        lead_id: lead.id,
        error: String(err?.message ?? err),
      });
    });
  }

  return res.json({
    ok: true,
    lead_id: lead.id,
    external_id: lead.external_id,
  });
}
