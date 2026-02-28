/**
 * podioSyncService.ts
 *
 * Tarefa #10 — Envio automático para Podio
 *
 * Responsabilidades:
 * - Buscar lead + evento + franquia do banco após roteamento
 * - Construir payload canônico a partir dos dados do banco
 * - Fazer dual-write: Franqueadora (sempre) + workspace da franquia roteada
 *
 * Chamado de:
 * - leadsIntake.ts (quando ibge_code é enviado no intake)
 * - webhooks.ts (futuro: quando IA preencher ibge_code)
 * - POST /leads/:id/sync-podio (sync manual)
 */

import { upsertLeadToPodio, type WorkspaceKey, type CanonicalLead } from "./podioService.js";
import { query } from "../db/pool.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Mapeamento podio_app_id (da tabela franchises) → WorkspaceKey
// Baseado nos arquivos podio.workspace.*.json
// ---------------------------------------------------------------------------
const APP_ID_TO_WORKSPACE: Record<string, WorkspaceKey> = {
  "10094649": "franqueadora",
  "10777978": "campinas",
  "13683578": "litoral_norte",
  "12876626": "rio_bh",
};

// ---------------------------------------------------------------------------
// Mapeamento WorkspaceKey → label do campo "area-da-franquia" na Franqueadora
// ---------------------------------------------------------------------------
const WORKSPACE_TO_AREA_LABEL: Record<WorkspaceKey, string | null> = {
  franqueadora: null, // não preenche área quando a franquia É a franqueadora
  campinas: "Franquia Campinas",
  litoral_norte: "Franquia Litoral Norte",
  rio_bh: "Franquia Rio de Janeiro e BH",
};

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------
export type PodioSyncResult =
  | { ok: true; action: "synced"; results: any[] }
  | { ok: false; reason: "not_routed" | "unknown_workspace" | "podio_disabled"; detail?: string };

// ---------------------------------------------------------------------------
// syncLeadToPodio — função principal exportada
// ---------------------------------------------------------------------------
export async function syncLeadToPodio(leadId: string): Promise<PodioSyncResult> {
  // Verifica se Podio está configurado
  if (!process.env.PODIO_CLIENT_ID || !process.env.PODIO_CLIENT_SECRET) {
    logger.warn("Podio não configurado (PODIO_CLIENT_ID/SECRET ausentes) — sync ignorado", { leadId });
    return { ok: false, reason: "podio_disabled" };
  }

  // 1) Busca lead + evento + franquia em uma query
  const result = await query(
    `
    SELECT
      l.id,
      l.external_id,
      l.phone_e164,
      l.source,
      l.franchise_id,
      l.status,
      le.cidade,
      le.estado,
      le.ibge_code,
      le.event_start_date,
      le.event_end_date,
      le.perfil_evento_universal,
      le.pessoas_estimadas,
      le.decisor,
      f.franchise_name,
      f.podio_app_id
    FROM leads l
    LEFT JOIN lead_events le ON le.lead_id = l.id
    LEFT JOIN franchises f ON f.id = l.franchise_id
    WHERE l.id = $1
    `,
    [leadId]
  );

  const row = result.rows[0];
  if (!row) throw new Error(`Lead não encontrado: ${leadId}`);

  // 2) Se ainda não foi roteado, sair silenciosamente
  if (!row.franchise_id) {
    logger.info("Lead ainda não roteado — Podio sync ignorado", { leadId });
    return { ok: false, reason: "not_routed" };
  }

  // 3) Resolve WorkspaceKey a partir do podio_app_id da franquia
  const workspaceKey = row.podio_app_id
    ? APP_ID_TO_WORKSPACE[String(row.podio_app_id)]
    : null;

  if (!workspaceKey) {
    logger.warn("podio_app_id desconhecido ou não configurado para a franquia", {
      leadId,
      franchise_id: row.franchise_id,
      podio_app_id: row.podio_app_id,
    });
    return {
      ok: false,
      reason: "unknown_workspace",
      detail: `franchise_id=${row.franchise_id}, podio_app_id=${row.podio_app_id}`,
    };
  }

  // 4) Constrói payload canônico
  const canonical = buildCanonical(row, workspaceKey);

  logger.info("Iniciando Podio sync (dual-write)", {
    leadId,
    external_id: row.external_id,
    workspaceKey,
  });

  // 5) Dual-write: sempre envia para Franqueadora
  const syncResults: any[] = [];

  const franqueadoraResult = await upsertLeadToPodio("franqueadora", canonical);
  syncResults.push({ workspace: "franqueadora", ...franqueadoraResult });

  // 6) Envia para workspace da franquia (se for diferente da franqueadora)
  if (workspaceKey !== "franqueadora") {
    const franchiseResult = await upsertLeadToPodio(workspaceKey, canonical);
    syncResults.push({ workspace: workspaceKey, ...franchiseResult });
  }

  logger.info("Podio sync concluído", { leadId, syncResults });
  return { ok: true, action: "synced", results: syncResults };
}

// ---------------------------------------------------------------------------
// buildCanonical — monta o CanonicalLead a partir da linha do banco
// ---------------------------------------------------------------------------
function buildCanonical(row: any, workspaceKey: WorkspaceKey): CanonicalLead {
  const today = new Date().toISOString().split("T")[0] + " 00:00:00";

  const fields: Record<string, any> = {
    // --- Campos obrigatórios / principais ---
    title: buildTitle(row), // "title" é o external_id padrão do campo Nome
    "id-externo": row.external_id,
    telefone: row.phone_e164 ?? "",

    // --- Status e interesse ---
    status: "Novo",
    interesse: "Evento",

    // --- Data do contato ---
    "data-do-contato": { start: today },
  };

  // --- Área da franquia (category na Franqueadora) ---
  const areaLabel = WORKSPACE_TO_AREA_LABEL[workspaceKey];
  if (areaLabel) {
    fields["area-da-franquia"] = areaLabel;
  }

  // --- Localização ---
  if (row.cidade) {
    fields["cidade"] = row.cidade;
    fields["cidade-do-evento"] = row.cidade; // campinas usa esse external_id
  }
  if (row.estado) {
    fields["estado"] = row.estado; // text em franqueadora, category em campinas (mesmo external_id "estado")
    fields["categoria"] = row.estado; // campinas usa "categoria" para estado/status
  }
  if (row.ibge_code) {
    fields["codigo-ibge-2"] = row.ibge_code; // franqueadora
    fields["codigo-ibge"] = row.ibge_code; // campinas
  }

  // --- Datas ---
  if (row.event_start_date) {
    const dt = String(row.event_start_date).split("T")[0];
    fields["data-do-evento"] = { start: `${dt} 00:00:00` };
    fields["data-do-1o-contato"] = { start: today }; // campinas: "Data da Solicitação"
  }

  // --- Perfil / características do evento ---
  if (row.perfil_evento_universal) {
    fields["perfil-do-evento-2"] = row.perfil_evento_universal; // category franqueadora
    fields["4-perfil-do-evento-7-dias"] = row.perfil_evento_universal; // category campinas
  }
  if (row.pessoas_estimadas) {
    fields["publico-do-evento-qtde-pessoas"] = String(row.pessoas_estimadas); // text franqueadora
  }
  if (typeof row.decisor === "boolean") {
    fields["decisor"] = row.decisor ? "Sim" : "Não"; // category franqueadora
  }

  return { external_id: row.external_id, fields };
}

// ---------------------------------------------------------------------------
// buildTitle — nome amigável para o item no Podio
// ---------------------------------------------------------------------------
function buildTitle(row: any): string {
  const phone = row.phone_e164 ?? "sem-telefone";
  const cidade = row.cidade ? ` — ${row.cidade}` : "";
  const data = row.event_start_date
    ? ` (${String(row.event_start_date).split("T")[0]})`
    : "";
  return `Lead WA ${phone}${cidade}${data}`;
}
