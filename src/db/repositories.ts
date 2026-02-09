import { query } from "./pool.js";

/**
 * LEADS (lead-first)
 */

export async function findOrCreateLead(params: {
  externalId: string;
  phoneE164: string;
  source: string;
}) {
  const existing = await query(`SELECT * FROM leads WHERE external_id = $1`, [
    params.externalId,
  ]);

  if (existing.rows[0]) return existing.rows[0];

  // territory_status NULL evita violar constraint quando franchise_id ainda é NULL
  const created = await query(
    `
    INSERT INTO leads (external_id, phone_e164, source, territory_status)
    VALUES ($1, $2, $3, NULL)
    RETURNING *
    `,
    [params.externalId, params.phoneE164, params.source]
  );

  return created.rows[0];
}

export async function updateLeadStatus(leadId: string, status: string) {
  await query(
    `
    UPDATE leads
    SET status = $1,
        updated_at = NOW()
    WHERE id = $2
    `,
    [status, leadId]
  );
}

/**
 * LEAD MESSAGES
 */

export async function insertLeadMessage(params: {
  leadId: string;
  role: "user" | "agent" | "system";
  content: string;
  stage?: string | null;
}) {
  await query(
    `
    INSERT INTO lead_messages (lead_id, role, content, stage)
    VALUES ($1, $2, $3, $4)
    `,
    [params.leadId, params.role, params.content, params.stage ?? null]
  );
}

/**
 * LEAD EVENTS (1 por lead)
 * Trigger no Supabase roteia quando ibge_code é inserido/atualizado.
 */

export async function upsertLeadEvent(params: {
  leadId: string;
  cidade?: string | null;
  estado?: string | null;
  ibgeCode?: string | null;
  eventStartDate?: string | null; // "YYYY-MM-DD"
  eventEndDate?: string | null; // "YYYY-MM-DD"
  perfilEventoUniversal?: string | null;
  pessoasEstimadas?: string | null;
  decisor?: boolean | null;
}) {
  await query(
    `
    INSERT INTO lead_events (
      lead_id,
      cidade,
      estado,
      ibge_code,
      event_start_date,
      event_end_date,
      perfil_evento_universal,
      pessoas_estimadas,
      decisor
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (lead_id) DO UPDATE SET
      cidade = EXCLUDED.cidade,
      estado = EXCLUDED.estado,
      ibge_code = EXCLUDED.ibge_code,
      event_start_date = EXCLUDED.event_start_date,
      event_end_date = EXCLUDED.event_end_date,
      perfil_evento_universal = EXCLUDED.perfil_evento_universal,
      pessoas_estimadas = EXCLUDED.pessoas_estimadas,
      decisor = EXCLUDED.decisor
    `,
    [
      params.leadId,
      params.cidade ?? null,
      params.estado ?? null,
      params.ibgeCode ?? null,
      params.eventStartDate ?? null,
      params.eventEndDate ?? null,
      params.perfilEventoUniversal ?? null,
      params.pessoasEstimadas ?? null,
      params.decisor ?? null,
    ]
  );
}

/**
 * JOBS (opcional)
 */

export async function createJob(type: string, leadId: string, runAt: Date) {
  await query(
    `
    INSERT INTO jobs (type, lead_id, run_at)
    VALUES ($1, $2, $3)
    `,
    [type, leadId, runAt]
  );
}

export async function logJob(jobId: number, message: string) {
  await query(
    `
    INSERT INTO job_logs (job_id, message)
    VALUES ($1, $2)
    `,
    [jobId, message]
  );
}
