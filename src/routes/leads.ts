import { Router } from 'express';
import { requireAuth } from '../utils/auth.js';
import { query } from '../db/pool.js';

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

leadsRouter.get('/', async (req, res) => {
  const { cidade, estado, franchise_id } = req.query as Record<string, string | undefined>;
  const conditions: string[] = [];
  const params: any[] = [];

  if (cidade) {
    params.push(cidade);
    conditions.push(`LOWER(cidade) = LOWER($${params.length})`);
  }
  if (estado) {
    params.push(estado);
    conditions.push(`LOWER(estado) = LOWER($${params.length})`);
  }
  if (franchise_id) {
    params.push(franchise_id);
    conditions.push(`conversation_id IN (SELECT id FROM conversations WHERE franchise_id = $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`SELECT * FROM leads ${where} ORDER BY created_at DESC`, params);
  res.json(result.rows);
});
