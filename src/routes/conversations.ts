import { Router } from 'express';
import { requireAuth } from '../utils/auth.js';
import { query } from '../db/pool.js';

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

conversationsRouter.get('/', async (req, res) => {
  const { channel, status } = req.query as { channel?: string; status?: string };
  const conditions: string[] = [];
  const params: any[] = [];

  if (channel) {
    params.push(channel);
    conditions.push(`channel = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`SELECT * FROM conversations ${where} ORDER BY updated_at DESC`, params);
  res.json(result.rows);
});

conversationsRouter.get('/:id/messages', async (req, res) => {
  const id = Number(req.params.id);
  const result = await query('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC', [id]);
  res.json(result.rows);
});
