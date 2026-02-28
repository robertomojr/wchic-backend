/**
 * podioSyncService.ts
 *
 * Tarefa #10 — Envio automático para Podio
 * Tarefa #11 — Sincronização bidirecional de status
 */

import { upsertLeadToPodio, type WorkspaceKey, type CanonicalLead } from "./podioService.js";
import { query } from "../db/pool.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Mapeamentos de workspace
// ---------------------------------------------------------------------------
const APP_ID_TO_WORKSPACE: Record<string, WorkspaceKey> = {
  "10094649": "franqueadora",
  "10777978": "campinas",
  "13683578": "litoral_norte",
  "12876626": "rio_bh",
};

const WORKSPACE_TO_AREA_LABEL: Record<WorkspaceKey, string | null> = {
  franqueadora: null,
  campinas: "Franquia Campinas",
  litoral_norte: "Franquia Litoral Norte",
  rio_bh: "Franquia Rio de Janeiro e BH",
};

const ESTADO_ABBR_TO_FULL: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas",
  BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

// ---------------------------------------------------------------------------
// Mapeamento bidirecional de status
// ---------------------------------------------------------------------------

/**
 * Status do Podio → status canônico WChic (lead_status_enum)
 * Agrupa os vários status das franquias em valores canônicos do banco.
 */
const PODIO_STATUS_TO_WCHIC: Record<string, string> = {
  // Franqueadora
  "Novo": "new",
  "Encaminhado": "routed",
  "Incompleto": "incomplete",
  "Erro Técnico": "error",
  "Abandonado": "abandoned",
  "Fechado": "closed",
  "Não teve interesse": "abandoned",

  // Franquias (status-da-prospeccao)
  "Orçamento Enviado": "quoted",
  "Sem Resposta": "no_response",
  "Encerrado - Sem Resposta": "no_response",
  "Recusado - Preço": "rejected",
  "Recusado - Acesso": "rejected",
  "Recusado": "rejected",
  "Recusado pela Franquia": "rejected",
  "Recusado - sem motivo declarado": "rejected",
  "Recusado - sem motivo": "rejected",
  "Recusa da Franquia": "rejected",
  "Recusado - Banheiro Químico": "rejected",
  "Evento Cancelado": "cancelled",
  "E-mail de Apresentação": "contacted",
  "Repassado para Outro Franquiado": "routed",
  "Realizado": "closed",
};

/**
 * Status canônico WChic → campo e valor no Podio por workspace
 * Determina qual campo atualizar em cada app.
 */
const WCHIC_TO_PODIO_STATUS: Record<WorkspaceKey, {
  field: string;
  valueMap: Record<string, string>;
}> = {
  franqueadora: {
    field: "status",
    valueMap: {
      new: "Novo",
      routed: "Encaminhado",
      incomplete: "Incompleto",
      error: "Erro Técnico",
      abandoned: "Abandonado",
      closed: "Encaminhado", // usa status-2 para fechado — ver abaixo
      quoted: "Encaminhado",
      no_response: "Abandonado",
      rejected: "Abandonado",
      cancelled: "Abandonado",
      contacted: "Encaminhado",
    },
  },
  campinas: {
    field: "status-da-prospeccao",
    valueMap: {
      new: "Encaminhado",
      routed: "Encaminhado",
      quoted: "Orçamento Enviado",
      no_response: "Sem Resposta",
      rejected: "Recusado",
      cancelled: "Evento Cancelado",
      closed: "Fechado",
      contacted: "E-mail de Apresentação",
      abandoned: "Sem Resposta",
      incomplete: "Sem Resposta",
      error: "Sem Resposta",
    },
  },
  litoral_norte: {
    field: "status-da-prospeccao",
    valueMap: {
      new: "Encaminhado",
      routed: "Encaminhado",
      quoted: "Orçamento Enviado",
      no_response: "Sem Resposta",
      rejected: "Recusado",
      cancelled: "Evento Cancelado",
      closed: "Fechado",
      contacted: "E-mail de Apresentação",
      abandoned: "Encerrado - Sem Resposta",
      incomplete: "Sem Resposta",
      error: "Sem Resposta",
    },
  },
  rio_bh: {
    field: "status-da-prospeccao",
    valueMap: {
      new: "Encaminhado",
      routed: "Encaminhado",
      quoted: "Orçamento Enviado",
      no_response: "Sem Resposta",
      rejected: "Recusado",
      cancelled: "Evento Cancelado",
      closed: "Realizado",
      contacted: "E-mail de Apresentação",
      abandoned: "Sem Resposta",
      incomplete: "Sem Resposta",
      error: "Sem Resposta",
    },
  },
};

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type PodioSyncResult =
  | { ok: true; action: "synced"; results: any[] }
  | { ok: false; reason: "not_routed" | "unknown_workspace" | "podio_disabled"; detail?: string };

// ---------------------------------------------------------------------------
// syncLeadToPodio — Tarefa #10 (intake → Podio)
// ---------------------------------------------------------------------------
export async function syncLeadToPodio(leadId: string): Promise<PodioSyncResult> {
  if (!process.env.PODIO_CLIENT_ID || !process.env.PODIO_CLIENT_SECRET) {
    logger.warn("Podio não configurado — sync ignorado", { leadId });
    return { ok: false, reason: "podio_disabled" };
  }

  const result = await query(
    `SELECT l.id, l.external_id, l.phone_e164, l.franchise_id, l.status,
            le.cidade, le.estado, le.ibge_code, le.event_start_date, le.event_end_date,
            le.perfil_evento_universal, le.pessoas_estimadas, le.decisor,
            f.franchise_name, f.podio_app_id
     FROM leads l
     LEFT JOIN lead_events le ON le.lead_id = l.id
     LEFT JOIN franchises f ON f.id = l.franchise_id
     WHERE l.id = $1`,
    [leadId]
  );

  const row = result.rows[0];
  if (!row) throw new Error(`Lead não encontrado: ${leadId}`);

  if (!row.franchise_id) {
    logger.info("Lead não roteado — Podio sync ignorado", { leadId });
    return { ok: false, reason: "not_routed" };
  }

  const workspaceKey = row.podio_app_id ? APP_ID_TO_WORKSPACE[String(row.podio_app_id)] : null;
  if (!workspaceKey) {
    logger.warn("workspace desconhecido", { leadId, podio_app_id: row.podio_app_id });
    return { ok: false, reason: "unknown_workspace", detail: `podio_app_id=${row.podio_app_id}` };
  }

  const canonical = buildCanonical(row, workspaceKey);
  logger.info("Iniciando Podio sync (dual-write)", { leadId, external_id: row.external_id, workspaceKey });

  const syncResults: any[] = [];

  // --- Franqueadora ---
  try {
    const r = await upsertLeadToPodio("franqueadora", canonical);
    syncResults.push({ workspace: "franqueadora", ...r });
    // Salva item_id no banco
    if (r.itemId) await saveItemId(leadId, "franqueadora", r.itemId);
    logger.info("Podio sync OK: franqueadora", { leadId });
  } catch (err: any) {
    logger.error("Podio sync ERRO: franqueadora", { leadId, detail: JSON.stringify(err?.response?.data ?? err?.message) });
    throw err;
  }

  // --- Franquia específica ---
  if (workspaceKey !== "franqueadora") {
    try {
      const r = await upsertLeadToPodio(workspaceKey, canonical);
      syncResults.push({ workspace: workspaceKey, ...r });
      if (r.itemId) await saveItemId(leadId, workspaceKey, r.itemId);
      logger.info(`Podio sync OK: ${workspaceKey}`, { leadId });
    } catch (err: any) {
      logger.error(`Podio sync ERRO: ${workspaceKey}`, { leadId, detail: JSON.stringify(err?.response?.data ?? err?.message) });
      throw err;
    }
  }

  logger.info("Podio sync concluído", { leadId, syncResults });
  return { ok: true, action: "synced", results: syncResults };
}

// ---------------------------------------------------------------------------
// updateLeadStatusInPodio — Tarefa #11 (WChic → Podio)
// Chamado quando o status muda no banco WChic.
// ---------------------------------------------------------------------------
export async function updateLeadStatusInPodio(leadId: string, newStatus: string): Promise<void> {
  if (!process.env.PODIO_CLIENT_ID || !process.env.PODIO_CLIENT_SECRET) return;

  const result = await query(
    `SELECT l.podio_item_id_franqueadora, l.podio_item_id_franchise,
            f.podio_app_id
     FROM leads l
     LEFT JOIN franchises f ON f.id = l.franchise_id
     WHERE l.id = $1`,
    [leadId]
  );

  const row = result.rows[0];
  if (!row) return;

  const workspaceKey = row.podio_app_id ? APP_ID_TO_WORKSPACE[String(row.podio_app_id)] : null;

  // Atualiza Franqueadora
  if (row.podio_item_id_franqueadora) {
    await updatePodioItemStatus("franqueadora", row.podio_item_id_franqueadora, newStatus);
  }

  // Atualiza franquia específica
  if (workspaceKey && workspaceKey !== "franqueadora" && row.podio_item_id_franchise) {
    await updatePodioItemStatus(workspaceKey, row.podio_item_id_franchise, newStatus);
  }
}

async function updatePodioItemStatus(
  workspaceKey: WorkspaceKey,
  itemId: number,
  wchicStatus: string
): Promise<void> {
  const { appToken, appId } = getWorkspaceCredentials(workspaceKey);
  if (!appToken) {
    logger.warn(`App token ausente para ${workspaceKey} — status update ignorado`);
    return;
  }

  const mapping = WCHIC_TO_PODIO_STATUS[workspaceKey];
  const podioValue = mapping.valueMap[wchicStatus];
  if (!podioValue) {
    logger.warn(`Status "${wchicStatus}" não mapeado para ${workspaceKey}`);
    return;
  }

  try {
    const { default: axios } = await import("axios");
    const clientId = process.env.PODIO_CLIENT_ID!;
    const clientSecret = process.env.PODIO_CLIENT_SECRET!;

    const tokenResp = await axios.post(
      "https://api.podio.com/oauth/token",
      new URLSearchParams({ grant_type: "app", client_id: clientId, client_secret: clientSecret, app_id: appId, app_token: appToken }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const accessToken = tokenResp.data.access_token;

    await axios.put(
      `https://api.podio.com/item/${itemId}`,
      { fields: { [mapping.field]: podioValue } },
      { headers: { Authorization: `OAuth2 ${accessToken}` } }
    );

    logger.info(`Status Podio atualizado: ${workspaceKey} item ${itemId} → ${podioValue}`);
  } catch (err: any) {
    logger.error(`Erro ao atualizar status no Podio: ${workspaceKey}`, {
      itemId, detail: JSON.stringify(err?.response?.data ?? err?.message),
    });
  }
}

// ---------------------------------------------------------------------------
// processIncomingPodioHook — Tarefa #11 (Podio → WChic)
// Chamado pelo webhook /webhook/podio quando Podio notifica mudança de item.
// ---------------------------------------------------------------------------
export async function processIncomingPodioHook(hookData: any): Promise<void> {
  const itemId = hookData?.item_id ?? hookData?.data?.item_id;
  const appId = hookData?.app_id ?? hookData?.data?.app_id;
  const type = hookData?.type;

  if (type === "hook.verify") return; // verificação inicial — tratada na rota

  if (!itemId || type !== "item.update") {
    logger.info("Podio hook ignorado", { type, itemId });
    return;
  }

  // Acha o lead pelo item_id
  const result = await query(
    `SELECT id, status FROM leads
     WHERE podio_item_id_franqueadora = $1 OR podio_item_id_franchise = $1`,
    [itemId]
  );

  const lead = result.rows[0];
  if (!lead) {
    logger.warn("Podio hook: item_id não encontrado em nenhum lead", { itemId });
    return;
  }

  // Busca o status atual do item no Podio
  const workspaceKey = appId ? APP_ID_TO_WORKSPACE[String(appId)] : null;
  if (!workspaceKey) {
    logger.warn("Podio hook: app_id desconhecido", { appId });
    return;
  }

  const podioStatus = await fetchPodioItemStatus(workspaceKey, itemId);
  if (!podioStatus) return;

  const wchicStatus = PODIO_STATUS_TO_WCHIC[podioStatus];
  if (!wchicStatus) {
    logger.warn(`Podio hook: status "${podioStatus}" sem mapeamento WChic`, { itemId });
    return;
  }

  if (wchicStatus === lead.status) {
    logger.info("Podio hook: status já atualizado, ignorando", { itemId, status: wchicStatus });
    return;
  }

  await query(
    `UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2`,
    [wchicStatus, lead.id]
  );

  logger.info("Status atualizado via Podio hook", {
    lead_id: lead.id, itemId, podioStatus, wchicStatus,
  });
}

async function fetchPodioItemStatus(workspaceKey: WorkspaceKey, itemId: number): Promise<string | null> {
  try {
    const { appToken, appId } = getWorkspaceCredentials(workspaceKey);
    if (!appToken) return null;

    const { default: axios } = await import("axios");
    const tokenResp = await axios.post(
      "https://api.podio.com/oauth/token",
      new URLSearchParams({
        grant_type: "app",
        client_id: process.env.PODIO_CLIENT_ID!,
        client_secret: process.env.PODIO_CLIENT_SECRET!,
        app_id: appId,
        app_token: appToken,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const accessToken = tokenResp.data.access_token;

    const itemResp = await axios.get(`https://api.podio.com/item/${itemId}`, {
      headers: { Authorization: `OAuth2 ${accessToken}` },
    });

    const mapping = WCHIC_TO_PODIO_STATUS[workspaceKey];
    const fields = itemResp.data?.fields ?? [];
    const statusField = fields.find((f: any) => f.external_id === mapping.field);
    const statusLabel = statusField?.values?.[0]?.value?.text ?? statusField?.values?.[0]?.value;

    return typeof statusLabel === "string" ? statusLabel : null;
  } catch (err: any) {
    logger.error("Erro ao buscar status no Podio", { workspaceKey, itemId, err: err?.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function saveItemId(leadId: string, workspace: WorkspaceKey, itemId: number): Promise<void> {
  const col = workspace === "franqueadora" ? "podio_item_id_franqueadora" : "podio_item_id_franchise";
  await query(`UPDATE leads SET ${col} = $1, updated_at = NOW() WHERE id = $2`, [itemId, leadId]);
}

function getWorkspaceCredentials(workspace: WorkspaceKey): { appId: string; appToken: string } {
  const map: Record<WorkspaceKey, { appId: string; appToken: string }> = {
    franqueadora: {
      appId: process.env.PODIO_FRANQUEADORA_APP_ID ?? "10094649",
      appToken: process.env.PODIO_FRANQUEADORA_APP_TOKEN ?? "",
    },
    campinas: {
      appId: process.env.PODIO_CAMPINAS_APP_ID ?? "10777978",
      appToken: process.env.PODIO_CAMPINAS_APP_TOKEN ?? "",
    },
    litoral_norte: {
      appId: process.env.PODIO_LITORAL_NORTE_APP_ID ?? "13683578",
      appToken: process.env.PODIO_LITORAL_NORTE_APP_TOKEN ?? "",
    },
    rio_bh: {
      appId: process.env.PODIO_RIO_BH_APP_ID ?? "12876626",
      appToken: process.env.PODIO_RIO_BH_APP_TOKEN ?? "",
    },
  };
  return map[workspace];
}

function toDateStr(value: any): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildCanonical(row: any, workspaceKey: WorkspaceKey): CanonicalLead {
  const today = new Date().toISOString().split("T")[0] + " 00:00:00";
  const estadoFull = row.estado
    ? (ESTADO_ABBR_TO_FULL[String(row.estado).toUpperCase()] ?? row.estado)
    : null;

  const fields: Record<string, any> = {
    title: buildTitle(row),
    "id-externo": row.external_id,
    telefone: row.phone_e164 ?? "",
    status: "Novo",
    interesse: "Evento",
    "data-do-contato": { start: today },
  };

  const areaLabel = WORKSPACE_TO_AREA_LABEL[workspaceKey];
  if (areaLabel) {
    fields["area-da-franquia"] = areaLabel;
    fields["encaminhado"] = areaLabel;
  }

  if (row.cidade) {
    fields["cidade"] = row.cidade;
    fields["cidade-do-evento"] = row.cidade;
  }
  if (estadoFull) {
    fields["estado"] = estadoFull;
  }
  if (row.ibge_code) {
    fields["codigo-ibge-2"] = row.ibge_code;
    fields["codigo-ibge"] = row.ibge_code;
  }
  if (row.event_start_date) {
    const dt = toDateStr(row.event_start_date);
    fields["data-do-evento"] = { start: `${dt} 00:00:00` };
    fields["data-do-1o-contato"] = { start: today };
    fields["data-central-de-vendas-48h7-dias"] = { start: today };
  }
  if (row.perfil_evento_universal) {
    fields["perfil-do-evento-2"] = row.perfil_evento_universal;
    fields["4-perfil-do-evento-7-dias"] = row.perfil_evento_universal;
  }
  if (row.pessoas_estimadas) {
    fields["publico-do-evento-qtde-pessoas"] = String(row.pessoas_estimadas);
  }
  if (typeof row.decisor === "boolean") {
    fields["decisor"] = row.decisor ? "Sim" : "Não";
  }
  fields["origem-2"] = "Outros";
  fields["origem-do-contrato"] = "Site";

  return { external_id: row.external_id, fields };
}

function buildTitle(row: any): string {
  const phone = row.phone_e164 ?? "sem-telefone";
  const cidade = row.cidade ? ` — ${row.cidade}` : "";
  const data = row.event_start_date ? ` (${toDateStr(row.event_start_date)})` : "";
  return `Lead WA ${phone}${cidade}${data}`;
}

