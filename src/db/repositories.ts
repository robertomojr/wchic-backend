import { query } from './pool.js';

export async function findOrCreateConversation(channel: string, customerPhone: string) {
  const existing = await query<{ id: number; franchise_id: number | null }>(
    'SELECT id, franchise_id FROM conversations WHERE channel = $1 AND customer_phone = $2',
    [channel, customerPhone]
  );
  if (existing.rows[0]) {
    await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [existing.rows[0].id]);
    return existing.rows[0];
  }

  const created = await query<{ id: number }>(
    'INSERT INTO conversations (channel, customer_phone) VALUES ($1, $2) RETURNING id',
    [channel, customerPhone]
  );
  return { id: created.rows[0].id, franchise_id: null };
}

export async function insertMessage(conversationId: number, role: string, type: string, text: string, mediaUrl?: string | null) {
  await query(
    'INSERT INTO messages (conversation_id, role, type, text, media_url) VALUES ($1, $2, $3, $4, $5)',
    [conversationId, role, type, text, mediaUrl ?? null]
  );
}

export async function upsertLead(conversationId: number, payload: Partial<Record<string, unknown>>) {
  const existing = await query<{ id: number }>('SELECT id FROM leads WHERE conversation_id = $1', [conversationId]);
  if (existing.rows[0]) {
    const fields = Object.keys(payload);
    if (fields.length === 0) {
      return existing.rows[0].id;
    }
    const setFragments = fields.map((field, idx) => `${field} = $${idx + 2}`);
    await query(
      `UPDATE leads SET ${setFragments.join(', ')}, updated_at = NOW() WHERE conversation_id = $1`,
      [conversationId, ...fields.map((field) => payload[field])]
    );
    return existing.rows[0].id;
  }
  const columns = Object.keys(payload);
  const values = Object.values(payload);
  const placeholders = columns.map((_, idx) => `$${idx + 2}`).join(', ');
  const result = await query<{ id: number }>(
    `INSERT INTO leads (conversation_id, ${columns.join(', ')}) VALUES ($1, ${placeholders}) RETURNING id`,
    [conversationId, ...values]
  );
  return result.rows[0].id;
}

export async function getLeadByConversation(conversationId: number) {
  const result = await query('SELECT * FROM leads WHERE conversation_id = $1', [conversationId]);
  return result.rows[0] ?? null;
}

export async function getFranchiseByCityState(cidade: string, estado: string) {
  const result = await query('SELECT * FROM franchises WHERE LOWER(cidade) = LOWER($1) AND LOWER(estado) = LOWER($2) LIMIT 1', [cidade, estado]);
  return result.rows[0] ?? null;
}

export async function updateLeadPodio(leadId: number, franquiaId: string | null, franqueadoraId: string | null) {
  await query(
    'UPDATE leads SET podio_item_id_franquia = $1, podio_item_id_franqueadora = $2, updated_at = NOW() WHERE id = $3',
    [franquiaId, franqueadoraId, leadId]
  );
}

export async function markLeadStatus(conversationId: number, status: string) {
  await query('UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2', [status, conversationId]);
}

export async function setConversationFranchise(conversationId: number, franchiseId: number | null) {
  await query('UPDATE conversations SET franchise_id = $1, updated_at = NOW() WHERE id = $2', [franchiseId, conversationId]);
}

export async function createJob(type: string, leadId: number, runAt: Date) {
  await query('INSERT INTO jobs (type, lead_id, run_at) VALUES ($1, $2, $3)', [type, leadId, runAt]);
}

export async function logJob(jobId: number, message: string) {
  await query('INSERT INTO job_logs (job_id, message) VALUES ($1, $2)', [jobId, message]);
}
