import type { Request, Response } from "express";
import { getFranchiseByCityState, upsertLead, findOrCreateConversation, setConversationFranchise } from "../db/repositories.js";

export async function leadsIntake(req: Request, res: Response) {
  const { nome, telefone, cidade, estado, payload } = req.body ?? {};

  if (!telefone || !cidade || !estado) {
    return res.status(400).json({
      ok: false,
      error: "Envie telefone, cidade e estado (nome é opcional)",
    });
  }

  // 1) resolve franquia
  const franchise = await getFranchiseByCityState(String(cidade), String(estado));

  // 2) cria/acha conversa (canal fixo por enquanto)
  const convo = await findOrCreateConversation("intake", String(telefone));

  // 3) amarra franquia na conversa
  await setConversationFranchise(convo.id, franchise?.id ?? null);

  // 4) salva/atualiza lead
  const leadId = await upsertLead(convo.id, {
    nome: nome ?? null,
    telefone: telefone ?? null,
    cidade: cidade ?? null,
    estado: estado ?? null,
    ...(payload && typeof payload === "object" ? payload : {}),
  });

  return res.json({
    ok: true,
    conversation_id: convo.id,
    lead_id: leadId,
    routed_to: franchise
      ? { franchise_id: franchise.id, workspace_key: franchise.workspace_key, podio_app_id: franchise.podio_app_id }
      : null,
  });
}
