import { Router } from 'express';
import { requireAuth } from '../utils/auth.js';
import { query } from '../db/pool.js';

export const statsRouter = Router();

statsRouter.use(requireAuth);

statsRouter.get('/basic', async (_req, res) => {
  const leadsPerDay = await query(
    `SELECT DATE(created_at) as date, COUNT(*)::int as total
       FROM leads
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)`
  );

  const leadsPerFranchise = await query(
    `SELECT franchises.franchise_name, COUNT(leads.id)::int as total
       FROM leads
       JOIN conversations ON conversations.id = leads.conversation_id
       LEFT JOIN franchises ON franchises.id = conversations.franchise_id
      GROUP BY franchises.franchise_name
      ORDER BY total DESC`
  );

  const pendingJobs = await query(
    `SELECT type, COUNT(*)::int as total
       FROM jobs
      WHERE status = 'pending'
      GROUP BY type`
  );

  res.json({
    leads_per_day: leadsPerDay.rows,
    leads_per_franchise: leadsPerFranchise.rows,
    pending_jobs: pendingJobs.rows
  });
});
