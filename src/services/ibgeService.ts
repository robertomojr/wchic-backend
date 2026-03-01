/**
 * ibgeService.ts
 *
 * Busca o código IBGE de uma cidade pelo nome + estado.
 * Usa a API pública do IBGE (sem autenticação).
 */

import axios from "axios";
import { logger } from "../utils/logger.js";

export type IbgeResult = {
  ibge_code: string;
  cidade: string;
  estado: string;
  uf: string;
} | null;

// Cache simples em memória para evitar chamadas repetidas
const cache = new Map<string, IbgeResult>();

export async function findIbgeCode(
  cidade: string,
  uf?: string
): Promise<IbgeResult> {
  const cacheKey = `${cidade.toLowerCase()}:${(uf ?? "").toLowerCase()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  try {
    // Normaliza cidade: remove acentos para melhor match
    const cidadeNorm = cidade.trim();

    // Busca por nome na API do IBGE
    const url = `https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome`;
    const resp = await axios.get(url, { timeout: 8000 });
    const municipios: any[] = resp.data ?? [];

    // Filtra por nome (case-insensitive) e opcionalmente por UF
    const matches = municipios.filter((m) => {
      const nomeMatch =
        normalize(m.nome) === normalize(cidadeNorm) ||
        normalize(m.nome).includes(normalize(cidadeNorm));
      const ufMatch = uf
        ? m.microrregiao?.mesorregiao?.UF?.sigla?.toLowerCase() ===
          uf.toLowerCase()
        : true;
      return nomeMatch && ufMatch;
    });

    if (matches.length === 0) {
      logger.warn("IBGE: cidade não encontrada", { cidade, uf });
      cache.set(cacheKey, null);
      return null;
    }

    // Prefere match exato
    const exact = matches.find(
      (m) => normalize(m.nome) === normalize(cidadeNorm)
    );
    const chosen = exact ?? matches[0];

    const result: IbgeResult = {
      ibge_code: String(chosen.id),
      cidade: chosen.nome,
      estado: chosen.microrregiao?.mesorregiao?.UF?.nome ?? "",
      uf: chosen.microrregiao?.mesorregiao?.UF?.sigla ?? "",
    };

    cache.set(cacheKey, result);
    logger.info("IBGE: cidade encontrada", result);
    return result;
  } catch (err: any) {
    logger.error("IBGE: erro na busca", { cidade, uf, error: err?.message });
    return null;
  }
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
