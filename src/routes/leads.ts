import { Router } from "express";
import { requireAuth } from "../utils/auth.js";
import { query } from "../db/pool.js";
import { syncLeadToPodio } from "../services/podioSyncService.js";

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

/**
 * GET /leads — Lista leads com filtros opcionais
 */
leadsRouter.get("/", async (req, res) => {
  const { cidade, estado, franchise_id } = req.query as Record<string, string | undefined>;
  const conditions: string[] = [];
  const params: any[] = [];

  if (cidade) {
    params.push(cidade);
    conditions.push(`LOWER(l.cidade) = LOWER($${params.length})`);
  }
  if (estado) {
    params.push(estado);
    conditions.push(`LOWER(l.estado) = LOWER($${params.length})`);
  }
  if (franchise_id) {
    params.push(franchise_id);
    conditions.push(`l.franchise_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await query(
    `SELECT l.*, le.cidade, le.estado, le.ibge_code, le.event_start_date
     FROM leads l
     LEFT JOIN lead_events le ON le.lead_id = l.id
     ${where}
     ORDER BY l.created_at DESC`,
    params
  );
  res.json(result.rows);
});

/**
 * POST /leads/:id/sync-podio — Dispara sync manual para o Podio
 *
 * Útil para:
 * - Reenviar leads que falharam
 * - Sincronizar leads antigos após configurar credenciais do Podio
 * - Testar o fluxo sem precisar criar um novo lead
 */
leadsRouter.post("/:id/sync-podio", async (req, res) => {
  const { id } = req.params;

  const check = await query("SELECT id, external_id FROM leads WHERE id = $1", [id]);
  if (!check.rows[0]) {
    return res.status(404).json({ ok: false, error: "Lead não encontrado" });
  }

  try {
    const result = await syncLeadToPodio(id);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.response?.data ?? err?.message ?? "Erro desconhecido",
    });
  }
});
