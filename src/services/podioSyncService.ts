/**
 * podioSyncService.ts
 *
 * Tarefa #10 — Envio automático para Podio
 */

import { upsertLeadToPodio, type WorkspaceKey, type CanonicalLead } from "./podioService.js";
import { query } from "../db/pool.js";
import { logger } from "../utils/logger.js";

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

// Abreviações de estado → nome completo (para campos category no Podio)
const ESTADO_ABBR_TO_FULL: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas",
  BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

export type PodioSyncResult =
  | { ok: true; action: "synced"; results: any[] }
  | { ok: false; reason: "not_routed" | "unknown_workspace" | "podio_disabled"; detail?: string };

export async function syncLeadToPodio(leadId: string): Promise<PodioSyncResult> {
  if (!process.env.PODIO_CLIENT_ID || !process.env.PODIO_CLIENT_SECRET) {
    logger.warn("Podio não configurado — sync ignorado", { leadId });
    return { ok: false, reason: "podio_disabled" };
  }

  const result = await query(
    `
    SELECT
      l.id, l.external_id, l.phone_e164, l.source, l.franchise_id, l.status,
      le.cidade, le.estado, le.ibge_code, le.event_start_date, le.event_end_date,
      le.perfil_evento_universal, le.pessoas_estimadas, le.decisor,
      f.franchise_name, f.podio_app_id
    FROM leads l
    LEFT JOIN lead_events le ON le.lead_id = l.id
    LEFT JOIN franchises f ON f.id = l.franchise_id
    WHERE l.id = $1
    `,
    [leadId]
  );

  const row = result.rows[0];
  if (!row) throw new Error(`Lead não encontrado: ${leadId}`);

  if (!row.franchise_id) {
    logger.info("Lead não roteado — Podio sync ignorado", { leadId });
    return { ok: false, reason: "not_routed" };
  }

  const workspaceKey = row.podio_app_id
    ? APP_ID_TO_WORKSPACE[String(row.podio_app_id)]
    : null;

  if (!workspaceKey) {
    logger.warn("workspace desconhecido para franquia", {
      leadId, franchise_id: row.franchise_id, podio_app_id: row.podio_app_id,
    });
    return { ok: false, reason: "unknown_workspace", detail: `podio_app_id=${row.podio_app_id}` };
  }

  const canonical = buildCanonical(row, workspaceKey);

  logger.info("Iniciando Podio sync (dual-write)", {
    leadId, external_id: row.external_id, workspaceKey,
  });

  const syncResults: any[] = [];

  try {
    const franqueadoraResult = await upsertLeadToPodio("franqueadora", canonical);
    syncResults.push({ workspace: "franqueadora", ...franqueadoraResult });
    logger.info("Podio sync OK: franqueadora", { leadId });
  } catch (err: any) {
    const detail = err?.response?.data ?? err?.message;
    logger.error("Podio sync ERRO: franqueadora", { leadId, detail: JSON.stringify(detail) });
    throw err;
  }

  if (workspaceKey !== "franqueadora") {
    try {
      const franchiseResult = await upsertLeadToPodio(workspaceKey, canonical);
      syncResults.push({ workspace: workspaceKey, ...franchiseResult });
      logger.info(`Podio sync OK: ${workspaceKey}`, { leadId });
    } catch (err: any) {
      const detail = err?.response?.data ?? err?.message;
      logger.error(`Podio sync ERRO: ${workspaceKey}`, { leadId, detail: JSON.stringify(detail) });
      throw err;
    }
  }

  logger.info("Podio sync concluído", { leadId, syncResults });
  return { ok: true, action: "synced", results: syncResults };
}

function buildCanonical(row: any, workspaceKey: WorkspaceKey): CanonicalLead {
  const today = new Date().toISOString().split("T")[0] + " 00:00:00";

  // Normaliza estado: "SP" → "São Paulo"
  const estadoFull = row.estado
    ? (ESTADO_ABBR_TO_FULL[String(row.estado).toUpperCase()] ?? row.estado)
    : null;

  const fields: Record<string, any> = {
    title: buildTitle(row),
    "id-externo": row.external_id,
    telefone: row.phone_e164 ?? "",

    // Campo "contato" (type: contact) — usado em campinas e outras franquias
    // Podio aceita array de objetos {type, value}
    contato: row.phone_e164
      ? [{ type: "phone", value: row.phone_e164 }]
      : undefined,

    status: "Novo",
    interesse: "Evento",
    "data-do-contato": { start: today },
  };

  // Remove undefined
  if (!fields["contato"]) delete fields["contato"];

  const areaLabel = WORKSPACE_TO_AREA_LABEL[workspaceKey];
  if (areaLabel) {
    fields["area-da-franquia"] = areaLabel;
    fields["encaminhado"] = areaLabel; // campinas usa "encaminhado" para roteamento
  }

  if (row.cidade) {
    fields["cidade"] = row.cidade;
    fields["cidade-do-evento"] = row.cidade;
  }

  if (estadoFull) {
    fields["estado"] = estadoFull; // text em franqueadora, category em campinas (nome completo)
    fields["categoria"] = estadoFull; // não usado em campinas para estado — podioService ignora se não mapear
  }

  if (row.ibge_code) {
    fields["codigo-ibge-2"] = row.ibge_code; // franqueadora
    fields["codigo-ibge"] = row.ibge_code;   // campinas
  }

  if (row.event_start_date) {
    const dt = String(row.event_start_date).split("T")[0];
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

  // Origem do contato
  fields["origem-2"] = "Outros"; // WhatsApp não está nas opções de campinas — usa "Outros"
  fields["origem-do-contrato"] = "Site"; // franqueadora — opção mais próxima disponível

  return { external_id: row.external_id, fields };
}

function buildTitle(row: any): string {
  const phone = row.phone_e164 ?? "sem-telefone";
  const cidade = row.cidade ? ` — ${row.cidade}` : "";
  const data = row.event_start_date
    ? ` (${String(row.event_start_date).split("T")[0]})`
    : "";
  return `Lead WA ${phone}${cidade}${data}`;
}

