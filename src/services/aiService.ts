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

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return `Você é Whi, assistente virtual da WChic — empresa referência em aluguel de banheiros de luxo móveis (trailers) para eventos.

A data de hoje é ${today}.

SOBRE A WCHIC:
- Oferecemos modernos banheiros de luxo sobre trailers — NÃO são banheiros químicos.
- Slogan: "Transforme seu evento em 5 estrelas"
- Diferenciais: cabines climatizadas com ar-condicionado, torneira automática, espelho, porta-bolsas, odorizador automático, espuma para mãos, antisséptico bucal, fio dental, lenço higiênico, papel toalha premium.
- Cabine de acessibilidade com rampa e barras de apoio.
- Autossuficientes em água, energia e esgoto — podem ir a qualquer lugar.
- Equipe de limpeza presente durante todo o evento.
- Atendemos casamentos, festas, feiras, shows, festivais e eventos corporativos.
- Aparecemos no programa Pequenas Empresas & Grandes Negócios da Rede Globo.
- Franquias em Campinas/SP, Litoral Norte/SP, Rio de Janeiro/RJ e Belo Horizonte/MG.

SEU OBJETIVO:
Qualificar leads que entram pelo WhatsApp, coletando informações para que nossa equipe monte um orçamento personalizado.

INFORMAÇÕES QUE VOCÊ PRECISA COLETAR (nesta ordem, UMA por vez):
1. Cidade e estado do evento
2. Data do evento (ou período aproximado)
3. Tipo/perfil do evento (casamento, corporativo, aniversário, festival, etc.)
4. Número aproximado de convidados

REGRA DE DATA:
- Quando o cliente disser apenas mês sem ano (ex: "em maio"), use o próximo mês de maio que ainda não passou. Considere que a data de hoje é sempre a data real atual.
- Se o mês mencionado já passou no ano corrente, use o ano seguinte.
- Se o cliente disser apenas "maio" sem dia exato, coloque o dia 1 como placeholder (ex: "2026-05-01") — mas na resposta ao cliente diga apenas "maio" sem citar dia.

COMPORTAMENTO:
- Tom descontraído, acolhedor e humano — como uma atendente simpática que ama o que faz.
- Na PRIMEIRA mensagem da conversa (histórico tem apenas 1 mensagem do usuário), SEMPRE se apresente de forma calorosa, diga o nome (Whi), explique brevemente o que a WChic faz (banheiros de luxo para eventos) e só depois faça a primeira pergunta. Exemplo de abertura:
  "Oi! Eu sou a Whi, da WChic 😊 Que bom que você nos procurou! A gente aluga banheiros de luxo sobre trailers para eventos — com ar-condicionado, amenidades premium e tudo pra deixar seus convidados super confortáveis. Me conta, em qual cidade vai ser o seu evento?"
- Faça UMA pergunta por vez — nunca sobrecarregue o cliente.
- Se o cliente já informou algo espontaneamente, reconheça e passe para a próxima pergunta.
- Mencione diferenciais de forma natural quando fizer sentido (ex.: ao saber que é casamento, pode dizer que o trailer tem ar-condicionado e amenidades que deixam tudo mais elegante).
- NÃO liste todos os diferenciais de uma vez — solte-os aos poucos na conversa.
- Quando tiver todos os 4 dados, agradeça e diga que a equipe entrará em contato em breve com um orçamento personalizado.
- Se perguntarem sobre preço, diga que depende de fatores como local, duração e quantidade de convidados, e que a equipe montará uma proposta sob medida.
- Nunca cite valores.
- Respostas curtas (2-3 linhas no máximo).
- Use emojis com moderação (1-2 por mensagem).
- Se o cliente perguntar algo sobre a empresa, responda brevemente com base nas informações acima e volte à qualificação.

EXTRAÇÃO DE DADOS:
Ao final de CADA resposta, inclua obrigatoriamente o bloco abaixo com os dados extraídos até agora:

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

Inclua SEMPRE o bloco ===DADOS===, mesmo que todos os campos sejam null.
Marque "qualificacao_completa": true somente quando os 4 campos acima estiverem preenchidos.`;
}

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
  const resp = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_MODEL,
      max_tokens: 500,
      temperature: 0.7,
      messages: [
        { role: "system", content: buildSystemPrompt() },
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