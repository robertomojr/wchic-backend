/**
 * dashboard.ts
 *
 * Tarefa #14 — Dashboard API
 *
 * Endpoints:
 *   POST /dash/login          — autentica com senha fixa, retorna token
 *   GET  /dash/leads          — lista leads com filtros (?franchise=&status=&q=)
 *   GET  /dash/leads/:id      — detalhe do lead + conversa
 *   GET  /dash/stats          — stats globais + por franquia (funil)
 *
 * Auth: Bearer token simples (hash da senha + salt).
 * Env var: DASHBOARD_PASSWORD (obrigatória)
 */

import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { query } from "../db/pool.js";
import { logger } from "../utils/logger.js";

export const dashboardRouter = Router();

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function makeToken(password: string): string {
  const salt = process.env.DASHBOARD_TOKEN_SALT ?? "wchic-dash-2026";
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return res.status(503).json({ error: "Dashboard não configurado (DASHBOARD_PASSWORD ausente)" });
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token ausente" });
  }

  const token = header.slice(7);
  if (token !== makeToken(expected)) {
    return res.status(401).json({ error: "Token inválido" });
  }

  next();
}

// ---------------------------------------------------------------------------
// POST /dash/login
// ---------------------------------------------------------------------------
dashboardRouter.post("/login", (req: Request, res: Response) => {
  const { password } = req.body ?? {};
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected) {
    return res.status(503).json({ error: "Dashboard não configurado" });
  }

  if (password !== expected) {
    return res.status(401).json({ error: "Senha incorreta" });
  }

  res.json({
    token: makeToken(expected),
    expiresIn: TOKEN_TTL_MS,
  });
});

// Todas as rotas abaixo exigem auth
dashboardRouter.use(authMiddleware);

// ---------------------------------------------------------------------------
// GET /dash/stats
// ---------------------------------------------------------------------------
dashboardRouter.get("/stats", async (_req: Request, res: Response) => {
  try {
    // Totais gerais
    const totals = await query(`
      SELECT
        COUNT(*)::int AS total_leads,
        COUNT(*) FILTER (WHERE le.cidade IS NOT NULL)::int AS com_cidade,
        COUNT(*) FILTER (WHERE le.event_start_date IS NOT NULL)::int AS com_data,
        COUNT(*) FILTER (WHERE le.perfil_evento_universal IS NOT NULL)::int AS com_perfil,
        COUNT(*) FILTER (
          WHERE le.cidade IS NOT NULL
            AND le.event_start_date IS NOT NULL
            AND le.perfil_evento_universal IS NOT NULL
            AND le.pessoas_estimadas IS NOT NULL
        )::int AS qualificados
      FROM leads l
      LEFT JOIN lead_events le ON le.lead_id = l.id
    `);

    // Por franquia
    const byFranchise = await query(`
      SELECT
        COALESCE(f.name, 'Não roteado') AS franchise_name,
        f.id AS franchise_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE le.cidade IS NOT NULL
            AND le.event_start_date IS NOT NULL
            AND le.perfil_evento_universal IS NOT NULL
            AND le.pessoas_estimadas IS NOT NULL
        )::int AS qualificados
      FROM leads l
      LEFT JOIN franchises f ON f.id = l.franchise_id
      LEFT JOIN lead_events le ON le.lead_id = l.id
      GROUP BY f.id, f.name
      ORDER BY total DESC
    `);

    // Leads por dia (últimos 30 dias)
    const daily = await query(`
      SELECT
        DATE(l.created_at) AS day,
        COUNT(*)::int AS count
      FROM leads l
      WHERE l.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(l.created_at)
      ORDER BY day
    `);

    res.json({
      totals: totals.rows[0],
      byFranchise: byFranchise.rows,
      daily: daily.rows,
    });
  } catch (err: any) {
    logger.error("Dashboard stats error", { error: err?.message });
    res.status(500).json({ error: "Erro ao buscar estatísticas" });
  }
});

// ---------------------------------------------------------------------------
// GET /dash/leads?franchise=&status=&q=&page=&limit=
// ---------------------------------------------------------------------------
dashboardRouter.get("/leads", async (req: Request, res: Response) => {
  try {
    const franchise = req.query.franchise as string | undefined;
    const status = req.query.status as string | undefined;
    const search = req.query.q as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 0;

    if (franchise && franchise !== "all") {
      paramIdx++;
      conditions.push(`l.franchise_id = $${paramIdx}`);
      params.push(franchise);
    }

    if (status) {
      paramIdx++;
      conditions.push(`l.status = $${paramIdx}`);
      params.push(status);
    }

    if (search) {
      paramIdx++;
      conditions.push(`(l.phone_e164 ILIKE $${paramIdx} OR le.cidade ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count
    const countResult = await query(
      `SELECT COUNT(*)::int AS total
       FROM leads l
       LEFT JOIN lead_events le ON le.lead_id = l.id
       ${where}`,
      params
    );

    // Leads
    const leadsResult = await query(
      `SELECT
        l.id,
        l.phone_e164,
        l.source,
        l.status,
        l.territory_status,
        l.franchise_id,
        COALESCE(f.name, 'Não roteado') AS franchise_name,
        l.created_at,
        l.updated_at,
        le.cidade,
        le.estado,
        le.event_start_date,
        le.perfil_evento_universal,
        le.pessoas_estimadas,
        (le.cidade IS NOT NULL
          AND le.event_start_date IS NOT NULL
          AND le.perfil_evento_universal IS NOT NULL
          AND le.pessoas_estimadas IS NOT NULL
        ) AS qualificado,
        (SELECT COUNT(*)::int FROM lead_messages lm WHERE lm.lead_id = l.id) AS msg_count
      FROM leads l
      LEFT JOIN lead_events le ON le.lead_id = l.id
      LEFT JOIN franchises f ON f.id = l.franchise_id
      ${where}
      ORDER BY l.created_at DESC
      LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`,
      [...params, limit, offset]
    );

    res.json({
      leads: leadsResult.rows,
      total: countResult.rows[0].total,
      page,
      limit,
      totalPages: Math.ceil(countResult.rows[0].total / limit),
    });
  } catch (err: any) {
    logger.error("Dashboard leads list error", { error: err?.message });
    res.status(500).json({ error: "Erro ao buscar leads" });
  }
});

// ---------------------------------------------------------------------------
// GET /dash/leads/:id
// ---------------------------------------------------------------------------
dashboardRouter.get("/leads/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const leadResult = await query(
      `SELECT
        l.*,
        COALESCE(f.name, 'Não roteado') AS franchise_name,
        le.cidade,
        le.estado,
        le.ibge_code,
        le.event_start_date,
        le.event_end_date,
        le.perfil_evento_universal,
        le.pessoas_estimadas,
        le.decisor
      FROM leads l
      LEFT JOIN lead_events le ON le.lead_id = l.id
      LEFT JOIN franchises f ON f.id = l.franchise_id
      WHERE l.id = $1`,
      [id]
    );

    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: "Lead não encontrado" });
    }

    const messages = await query(
      `SELECT role, content, stage, created_at
       FROM lead_messages
       WHERE lead_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    res.json({
      lead: leadResult.rows[0],
      messages: messages.rows,
    });
  } catch (err: any) {
    logger.error("Dashboard lead detail error", { error: err?.message });
    res.status(500).json({ error: "Erro ao buscar lead" });
  }
});

// ---------------------------------------------------------------------------
// GET /dash/franchises (para popular filtros)
// ---------------------------------------------------------------------------
dashboardRouter.get("/franchises", async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, workspace_key FROM franchises ORDER BY name`
    );
    res.json(result.rows);
  } catch (err: any) {
    logger.error("Dashboard franchises error", { error: err?.message });
    res.status(500).json({ error: "Erro ao buscar franquias" });
  }
});
