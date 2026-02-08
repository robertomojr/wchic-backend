import { query } from "./pool.js";

/**
 * LEADS
 */

export async function findOrCreateLead(params: {
  externalId: string;
  phoneE164: string;
  source: string;
}) {
  const existing = await query(
    `SELECT * FROM leads WHERE external_id = $1`,
    [params.externalId]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await query(
    `
    INSERT INTO leads (external_id, phone_e164, source)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [params.externalId, params.phoneE164, params.source]
  );

  return created.rows[0];
}

export async function updateLeadRouting(params: {
  leadId: string;
  franchiseId: number | null;
  territoryStatus: "ativo" | "inativo" | "fallback" | null;
}) {
  await query(
    `
    UPDATE leads
    SET
      franchise_id = $1,
      territory_status = $2,
      routed_at = NOW(),
      updated_at = NOW()
    WHERE id = $3
    `,
    [params.franchiseId, params.territoryStatus, params.leadId]
  );
}

export async function updateLeadStatus(
  leadId: string,
  status: string
) {
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
 * LEAD MESSAGES (log de canal)
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
    [
      params.leadId,
      params.role,
      params.content,
      params.stage ?? null
    ]
  );
}

/**
 * ROUTING
 */

export async function getFranchiseByCityState(
  cidade: string,
  estado: string
) {
  const result = await query(
    `
    SELECT f.*
    FROM franchises f
    JOIN franchise_territories t
      ON t.franchise_id = f.id
    WHERE LOWER(t.cidade) = LOWER($1)
      AND LOWER(t.estado) = LOWER($2)
    LIMIT 1
    `,
    [cidade, estado]
  );

  return result.rows[0] ?? null;
}

/**
 * JOBS
 */

export async function createJob(
  type: string,
  leadId: string,
  runAt: Date
) {
  await query(
    `
    INSERT INTO jobs (type, lead_id, run_at)
    VALUES ($1, $2, $3)
    `,
    [type, leadId, runAt]
  );
}

export async function logJob(
  jobId: number,
  message: string
) {
  await query(
    `
    INSERT INTO job_logs (job_id, message)
    VALUES ($1, $2)
    `,
    [jobId, message]
  );
}
