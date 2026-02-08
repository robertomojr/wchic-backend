import type { Request, Response } from "express";
import { upsertLeadToPodio } from "../services/podioService.js";

export async function podioLeadTest(req: Request, res: Response) {
  try {
    // ⚠️ payload mínimo, controlado
    const externalId = "wchic:wa:+5511999999999:2030-01-15";

    const canonical = {
      external_id: externalId,
      fields: {
        // title obrigatório
        title: "Lead WhatsApp (TESTE) - 2030-01-15",

        // status (category)
        status: "Novo",

        // roteamento (category)
        "area-da-franquia": "Franquia Campinas",

        // contato
        telefone: "+55 11 99999-9999",
        "e-mail": "teste@wchic.com.br",

        // local
        cidade: "Campinas",
        "codigo-ibge-2": "3509502",

        // datas → Podio exige YYYY-MM-DD HH:MM:SS
        "data-do-contato": { start: "2026-02-07 00:00:00" },
        "data-do-evento": { start: "2030-01-15 00:00:00" },

        // texto
        solicitacao: "TESTE: Lead criado via backend (dual-write).",
        historico: "TESTE AUTOMÁTICO: validar upsert e category option_id por workspace.",
      },
    };

    const franqueadora = await upsertLeadToPodio("franqueadora", canonical);
    const campinas = await upsertLeadToPodio("campinas", canonical);

    return res.json({
      ok: true,
      results: { franqueadora, campinas },
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.response?.data ?? err?.message ?? "Unknown error",
    });
  }
}
