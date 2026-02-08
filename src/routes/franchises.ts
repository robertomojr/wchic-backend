import { Router } from 'express';
import { requireAuth } from '../utils/auth.js';
import { query } from '../db/pool.js';

export const franchisesRouter = Router();

franchisesRouter.use(requireAuth);

franchisesRouter.get('/', async (_req, res) => {
  const result = await query('SELECT * FROM franchises ORDER BY created_at DESC');
  res.json(result.rows);
});

franchisesRouter.post('/', async (req, res) => {
  const { cidade, estado, franchise_name, whatsapp_phone, podio_app_id, podio_view_url } = req.body ?? {};
  const result = await query(
    `INSERT INTO franchises (cidade, estado, franchise_name, whatsapp_phone, podio_app_id, podio_view_url)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [cidade, estado, franchise_name, whatsapp_phone, podio_app_id, podio_view_url ?? null]
  );
  res.status(201).json(result.rows[0]);
});

franchisesRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { cidade, estado, franchise_name, whatsapp_phone, podio_app_id, podio_view_url } = req.body ?? {};
  const result = await query(
    `UPDATE franchises
        SET cidade = $1,
            estado = $2,
            franchise_name = $3,
            whatsapp_phone = $4,
            podio_app_id = $5,
            podio_view_url = $6,
            updated_at = NOW()
      WHERE id = $7
      RETURNING *`,
    [cidade, estado, franchise_name, whatsapp_phone, podio_app_id, podio_view_url ?? null, id]
  );
  res.json(result.rows[0]);
});

franchisesRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  await query('DELETE FROM franchises WHERE id = $1', [id]);
  res.status(204).send();
});
