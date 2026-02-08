import type { Request, Response } from "express";
import {
  findOrCreateLead,
  insertLeadMessage,
  updateLeadRouting,
  getFranchiseByCityState
} from "../db/repositories.js";

/**
 * POST /gateway/intake
 * Lead-first gateway
 */
export async function leadsIntake(req: Request, res: Response) {
  const {
    telefone,
    cidade,
    estado,
    mensagem,
    event_date
  } = req.body ?? {};

  if (!telefone || !cidade || !estado) {
    return res.status(400).json({
      ok: false,
      error: "Envie telefone, cidade e estado"
    });
  }

  /**
   * 1) normaliza telefone (simples, sem lib agora)
   */
  const phoneE164 = String(telefone).replace(/\D/g, "").startsWith("55")
    ? `+${String(telefone).replace(/\D/g, "")}`
    : `+55${String(telefone).replace(/\D/g, "")}`;

  /**
   * 2) gera external_id (lead_key)
   * wchic:wa:+55XXXXXXXXXXX:YYYY-MM-DD (se existir data)
   */
  const datePart = event_date ? `:${event_date}` : "";
  const externalId = `wchic:wa:${phoneE164}${datePart}`;

  /**
   * 3) find or create lead
   */
  const lead = await findOrCreateLead({
    externalId,
    phoneE164,
    source: "whatsapp"
  });

  /**
   * 4) salva mensagem inicial (se houver)
   */
  if (mensagem) {
    await insertLeadMessage({
      leadId: lead.id,
      role: "user",
      content: String(mensagem),
      stage: "intake"
    });
  }

  /**
   * 5) resolve roteamento
   */
  const franchise = await getFranchiseByCityState(
    String(cidade),
    String(estado)
  );


await updateLeadRouting({
  leadId: lead.id,
  franchiseId: franchise?.id ?? null
});


  return res.json({
    ok: true,
    lead_id: lead.id,
    external_id: lead.external_id,
    routed_to: franchise
      ? {
          franchise_id: franchise.id,
          workspace_key: franchise.workspace_key,
          podio_app_id: franchise.podio_app_id
        }
      : null
  });
}
