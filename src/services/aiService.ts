/**
 * aiService.ts
 *
 * Tarefa #13 — IA para qualificação de leads
 *
 * Responsabilidades:
 * 1. Recebe o histórico da conversa do banco
 * 2. Chama OpenAI para gerar resposta ao cliente (tom amigável, 1 pergunta por vez)
 * 3. Extrai dados do evento (cidade, data, perfil, convidados) das respostas
 * 4. Atualiza lead_events no banco (trigger roteia quando ibge_code chega)
 * 5. Envia resposta via WhatsApp
 */

import axios from "axios";
import { query } from "../db/pool.js";
import { upsertLeadEvent } from "../db/repositories.js";
import { findIbgeCode } from "./ibgeService.js";
import { sendTextMessage } from "./whatsappService.js";
import { syncLeadToPodio } from "./podioSyncService.js";
import { logger } from "../utils/logger.js";
import { alert } from "./alertService.js";

const OPENAI_API = "https://api.openai.com/v1/chat/completions";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `Você é um assistente virtual da WChic, empresa especializada em tendas, estruturas e mobiliário para eventos. Seu nome é Whi (pronuncia-se "Wai").

Seu objetivo é qualificar leads que entram pelo WhatsApp, coletando as informações necessárias para que nossa equipe possa fazer um orçamento.

INFORMAÇÕES QUE VOCÊ PRECISA COLETAR (nesta ordem de prioridade):
1. Cidade e estado do evento
2. Data do evento
3. Perfil/tipo do evento (casamento, corporativo, aniversário, festa junina, etc.)
4. Número aproximado de convidados

REGRAS IMPORTANTES:
- Tom descontraído, amigável e acolhedor — como um atendente simpático
- Faça UMA pergunta por vez — não sobrecarregue o cliente
- Se o cliente já forneceu alguma informação, não pergunte de novo
- Quando tiver coletado todas as informações, agradeça e diga que a equipe entrará em contato
- Se o cliente fizer perguntas sobre preço, diga que a equipe vai elaborar um orçamento personalizado
- Nunca cite valores ou preços
- Responda em português brasileiro
- Mensagens curtas e diretas (máximo 3 linhas)

EXTRAÇÃO DE DADOS:
Ao final de cada resposta, inclua um bloco JSON com os dados extraídos até agora.
O bloco deve estar no formato exato abaixo, sem texto antes ou depois do JSON:

===DADOS===
{
  "cidade": "nome da cidade ou null",
  "uf": "sigla do estado (ex: SP) ou null",
  "data_evento": "YYYY-MM-DD ou null",
  "perfil_evento": "tipo do evento ou null",
  "num_convidados": "número aproximado ou null",
  "qualificacao_completa": true ou false
}
===FIM===

Inclua SEMPRE o bloco ===DADOS=== ao final, mesmo que todos os campos sejam null.`;

// ---------------------------------------------------------------------------
// processWithAI — função principal exportada
// ---------------------------------------------------------------------------
export async function processWithAI(
  leadId: string,
  phoneE164: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "dummy") {
    logger.warn("OpenAI não configurado — IA ignorada", { leadId });
    return;
  }

  const phoneNumberId = process.env.WHATSAPP_CLIENTS_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    logger.warn("WHATSAPP_CLIENTS_PHONE_NUMBER_ID não configurado", { leadId });
    return;
  }

  try {
    // 1) Busca histórico da conversa
    const history = await getConversationHistory(leadId);
    if (history.length === 0) return;

    // 2) Chama OpenAI
    const aiResponse = await callOpenAI(apiKey, history);
    if (!aiResponse) return;

    // 3) Separa texto da resposta e bloco de dados
    const { message, dados } = parseAIResponse(aiResponse);

    logger.info("IA gerou resposta", {
      leadId,
      messagePreview: message.substring(0, 80),
      dados,
    });

    // 4) Salva resposta da IA no banco
    await query(
      `INSERT INTO lead_messages (lead_id, role, content, stage)
       VALUES ($1, 'agent', $2, 'qualification')`,
      [leadId, message]
    );

    // 5) Envia mensagem ao cliente via WhatsApp
    await sendTextMessage(phoneNumberId, phoneE164.replace("+", ""), message);

    // 6) Atualiza lead_events com dados extraídos
    if (dados && hasSomeData(dados)) {
      await updateLeadWithExtractedData(leadId, dados);
    }
  } catch (err: any) {
    logger.error("IA: erro ao processar mensagem", {
      leadId,
      error: err?.message,
    });
    alert("generic_error", "Erro na IA ao processar mensagem do WhatsApp", {
      lead_id: leadId,
      error: String(err?.message ?? err).slice(0, 200),
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// getConversationHistory — busca histórico do banco
// ---------------------------------------------------------------------------
async function getConversationHistory(
  leadId: string
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const result = await query(
    `SELECT role, content
     FROM lead_messages
     WHERE lead_id = $1
     ORDER BY created_at ASC
     LIMIT 30`,
    [leadId]
  );

  return result.rows.map((row) => ({
    role: row.role === "agent" ? "assistant" : "user",
    content: row.content,
  }));
}

// ---------------------------------------------------------------------------
// callOpenAI
// ---------------------------------------------------------------------------
async function callOpenAI(
  apiKey: string,
  history: Array<{ role: string; content: string }>
): Promise<string | null> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  const resp = await axios.post(
    OPENAI_API,
    {
      model,
      max_tokens: 500,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  return resp.data?.choices?.[0]?.message?.content ?? null;
}

// ---------------------------------------------------------------------------
// parseAIResponse — separa mensagem do cliente do bloco JSON de dados
// ---------------------------------------------------------------------------
type ExtractedData = {
  cidade: string | null;
  uf: string | null;
  data_evento: string | null;
  perfil_evento: string | null;
  num_convidados: string | null;
  qualificacao_completa: boolean;
};

function parseAIResponse(raw: string): {
  message: string;
  dados: ExtractedData | null;
} {
  const start = raw.indexOf("===DADOS===");
  const end = raw.indexOf("===FIM===");

  if (start === -1 || end === -1) {
    return { message: raw.trim(), dados: null };
  }

  const message = raw.substring(0, start).trim();
  const jsonStr = raw.substring(start + 11, end).trim();

  try {
    const dados = JSON.parse(jsonStr) as ExtractedData;
    return { message, dados };
  } catch {
    logger.warn("IA: falha ao parsear bloco JSON de dados");
    return { message, dados: null };
  }
}

function hasSomeData(dados: ExtractedData): boolean {
  return !!(
    dados.cidade ||
    dados.data_evento ||
    dados.perfil_evento ||
    dados.num_convidados
  );
}

// ---------------------------------------------------------------------------
// updateLeadWithExtractedData — atualiza banco e dispara roteamento
// ---------------------------------------------------------------------------
async function updateLeadWithExtractedData(
  leadId: string,
  dados: ExtractedData
): Promise<void> {
  // Busca estado completo se tivermos UF
  const estadoFull = dados.uf ? ufToEstado(dados.uf) : null;

  // Busca ibge_code se tivermos cidade (necessário para roteamento)
  let ibgeCode: string | null = null;
  if (dados.cidade) {
    const ibge = await findIbgeCode(dados.cidade, dados.uf ?? undefined);
    if (ibge) {
      ibgeCode = ibge.ibge_code;
      logger.info("IBGE encontrado para cidade da IA", {
        leadId,
        cidade: dados.cidade,
        ibge_code: ibgeCode,
      });
    }
  }

  // Atualiza lead_events — trigger do banco roteia quando ibge_code for preenchido
  await upsertLeadEvent({
    leadId,
    cidade: dados.cidade ?? null,
    estado: estadoFull ?? dados.uf ?? null,
    ibgeCode,
    eventStartDate: dados.data_evento ?? null,
    perfilEventoUniversal: dados.perfil_evento ?? null,
    pessoasEstimadas: dados.num_convidados ?? null,
  });

  logger.info("Lead atualizado com dados da IA", {
    leadId,
    ibge_code: ibgeCode,
    qualificacao_completa: dados.qualificacao_completa,
  });

  // Se tiver ibge_code, tenta sync com Podio
  if (ibgeCode) {
    // Aguarda um momento para o trigger do banco rodar
    setTimeout(() => {
      syncLeadToPodio(leadId).catch((err) => {
        logger.error("Podio sync falhou após qualificação IA", {
          leadId,
          error: err?.message,
        });
      });
    }, 2000);
  }
}

// ---------------------------------------------------------------------------
// UF → Nome completo do estado
// ---------------------------------------------------------------------------
const UF_MAP: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas",
  BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

function ufToEstado(uf: string): string | null {
  return UF_MAP[uf.toUpperCase()] ?? null;
}
