import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../db/pool.js";
import {
  getFranchiseByCityState,
  setConversationFranchise,
  updateLeadPodio,
  markLeadStatus,
  createJob,
} from "../db/repositories.js";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 🚧 Podio write via leadService (LEGACY) — desativado por padrão.
 * Motivo: agora usamos external_id + mapping por workspace + option_id (novo podioService).
 *
 * Quando formos ligar isso, vamos trocar esta parte para usar:
 *   upsertLeadToPodio("franqueadora", canonical)
 *   upsertLeadToPodio("<workspace franquia>", canonical)
 */
const PODIO_WRITE_ENABLED = process.env.PODIO_WRITE_ENABLED === "true";

// Mantemos esse cache/arquivo por enquanto (LEGACY), mas só é lido se PODIO_WRITE_ENABLED=true
let leadFieldMapCache: Record<string, string> | null = null;

async function getLeadFieldMap() {
  if (leadFieldMapCache) return leadFieldMapCache;
  const mapPath = path.resolve(__dirname, "../config/podioLeadFieldMap.json");
  const data = await fs.readFile(mapPath, "utf8");
  leadFieldMapCache = JSON.parse(data);
  return leadFieldMapCache;
}

export function extractLeadJson(content: string) {
  const marker = "LEAD_WCHIC_JSON:";
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  const jsonPart = content.slice(idx + marker.length).trim();
  try {
    return JSON.parse(jsonPart);
  } catch (error) {
    logger.warn("Failed parsing LEAD json", { error: String(error) });
    return null;
  }
}

export function normalizeLead(lead: any) {
  const normalized = {
    tipo_evento: lead.tipo_evento ?? null,
    cidade: lead.cidade ?? null,
    estado: lead.estado ?? null,
    data_inicio: lead.data_inicio ?? null,
    data_fim: lead.data_fim ?? null,
    duracao: lead.duracao ?? null,
    pessoas: lead.pessoas ? Number(lead.pessoas) : null,
    nome_contato: lead.nome_contato ?? null,
    email: lead.email ?? null,
  };

  return normalized;
}

export function validateLead(lead: ReturnType<typeof normalizeLead>) {
  const errors: string[] = [];
  if (!lead.cidade) errors.push("cidade");
  if (!lead.estado) errors.push("estado");
  if (!lead.nome_contato) errors.push("nome_contato");
  return errors;
}

/**
 * LEGACY: criava items no Podio via field_id fixo.
 * AGORA: fica DESLIGADO por padrão para não quebrar o servidor.
 * Quando ligarmos, vamos reescrever para usar o novo podioService (upsert por external_id).
 */
export async function createPodioItems(
  lead: ReturnType<typeof normalizeLead>,
  _franchiseAppId?: string | null
) {
  if (!PODIO_WRITE_ENABLED) {
    logger.info("Podio write skipped (PODIO_WRITE_ENABLED!=true)");
    return {
      podioItemIdFranquia: null,
      podioItemIdFranqueadora: null,
    };
  }

  // Se alguém ligar sem refatorar, falha com erro explícito (para não gerar lixo no Podio).
  throw new Error(
    "Podio write via leadService is disabled until migrated to new podioService (external_id + workspace mappings)."
  );

  // --- Código antigo (mantido aqui só como referência mental) ---
  // const fieldMap = await getLeadFieldMap();
  // const fields: Record<string, unknown> = {};
  // for (const [key, fieldId] of Object.entries(fieldMap)) {
  //   const value = (lead as any)[key];
  //   if (value === null || value === undefined || value === "") continue;
  //   fields[fieldId] = value;
  // }
  // ...
}

export async function scheduleLeadJobs(leadId: number) {
  const lead = await query("SELECT created_at, data_inicio, data_fim FROM leads WHERE id = $1", [
    leadId,
  ]);
  const row = lead.rows[0];
  if (!row) return;

  const createdAt = new Date(row.created_at);
  await createJob("SLA_24H", leadId, new Date(createdAt.getTime() + 24 * 60 * 60 * 1000));

  if (row.data_inicio) {
    const eventDate = new Date(row.data_inicio);
    await createJob("SLA_7D", leadId, new Date(eventDate.getTime() - 7 * 24 * 60 * 60 * 1000));
  }

  if (row.data_fim) {
    const endDate = new Date(row.data_fim);
    await createJob("POST_EVENTO", leadId, new Date(endDate.getTime() + 24 * 60 * 60 * 1000));
  }
}

export async function finalizeLead(
  conversationId: number,
  leadId: number,
  lead: ReturnType<typeof normalizeLead>
) {
  if (lead.cidade && lead.estado) {
    const franchise = await getFranchiseByCityState(lead.cidade, lead.estado);
    if (franchise) {
      await setConversationFranchise(conversationId, franchise.id);
    }

    // ⚠️ Por enquanto, NÃO escreve no Podio aqui (desligado por padrão).
    // A escrita no Podio será feita via novo fluxo (external_id + workspace mapping + option_id).
    const podioItems = await createPodioItems(lead, franchise?.podio_app_id);

    await updateLeadPodio(leadId, podioItems.podioItemIdFranquia, podioItems.podioItemIdFranqueadora);

    // mantém o status atual do seu fluxo
    await markLeadStatus(conversationId, "enviado_podio");

    await scheduleLeadJobs(leadId);

    return { franchise };
  }

  return { franchise: null };
}

