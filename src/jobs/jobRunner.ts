import { query } from '../db/pool.js';
import { getPodioFieldMap } from '../services/podioFieldMap.js';
import { getItem } from '../services/podioService.js';
import { sendTemplateMessage, sendTextMessage } from '../services/whatsappService.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const JOB_BATCH_SIZE = 20;

function getFieldValue(item: any, fieldId: string) {
  const field = item?.fields?.find((f: any) => String(f.field_id) === String(fieldId));
  if (!field) return null;
  const values = field.values ?? [];
  if (values.length === 0) return null;
  const value = values[0];
  return value.value ?? value;
}

async function markJob(jobId: number, status: string, lastError?: string) {
  await query('UPDATE jobs SET status = $1, last_error = $2, updated_at = NOW() WHERE id = $3', [status, lastError ?? null, jobId]);
}

async function incrementJobAttempt(jobId: number, nextRunAt?: Date, lastError?: string) {
  await query(
    'UPDATE jobs SET attempts = attempts + 1, run_at = COALESCE($1, run_at), last_error = $2, updated_at = NOW() WHERE id = $3',
    [nextRunAt ?? null, lastError ?? null, jobId]
  );
}

async function logJob(jobId: number, message: string) {
  await query('INSERT INTO job_logs (job_id, message) VALUES ($1, $2)', [jobId, message]);
}

async function getFranchiseForLead(leadId: number) {
  const result = await query(
    `SELECT leads.id, leads.podio_item_id_franquia, leads.podio_item_id_franqueadora,
            conversations.franchise_id, franchises.whatsapp_phone, franchises.podio_app_id
       FROM leads
       JOIN conversations ON conversations.id = leads.conversation_id
       LEFT JOIN franchises ON franchises.id = conversations.franchise_id
      WHERE leads.id = $1`,
    [leadId]
  );
  return result.rows[0] ?? null;
}

async function sendOpsCharge(phone: string, message: string, useTemplate = false) {
  if (useTemplate) {
    await sendTemplateMessage(config.whatsapp.opsPhoneNumberId, phone, 'TEMPLATE_NAME', 'pt_BR', [message]);
    return;
  }
  await sendTextMessage(config.whatsapp.opsPhoneNumberId, phone, message);
}

async function checkPodioStatus(itemId: string, map: any) {
  const item = await getItem(itemId);
  const statusFieldId = map.status;
  const statusValue = getFieldValue(item, statusFieldId);
  return statusValue;
}

async function checkPodioFieldFilled(itemId: string, fieldId: string) {
  const item = await getItem(itemId);
  const value = getFieldValue(item, fieldId);
  return value !== null && value !== undefined && value !== '';
}

export async function runDueJobs() {
  const now = new Date();
  const jobs = await query(
    "SELECT * FROM jobs WHERE status = 'pending' AND run_at <= NOW() ORDER BY run_at ASC LIMIT $1",
    [JOB_BATCH_SIZE]
  );

  if (jobs.rows.length === 0) {
    return;
  }

  const fieldMap = await getPodioFieldMap();

  for (const job of jobs.rows) {
    const jobId = Number(job.id);
    try {
      await markJob(jobId, 'running');
      const lead = await getFranchiseForLead(job.lead_id);
      if (!lead?.whatsapp_phone) {
        await logJob(jobId, 'No franchise phone configured');
        await markJob(jobId, 'skipped');
        continue;
      }

      const podioItemId = lead.podio_item_id_franquia;
      if (!podioItemId) {
        await logJob(jobId, 'No Podio item id for franchise');
        await markJob(jobId, 'skipped');
        continue;
      }

      if (job.type === 'SLA_24H') {
        const statusValue = await checkPodioStatus(podioItemId, fieldMap.franquia);
        if (String(statusValue || '').toLowerCase() !== String(fieldMap.franquia.status_value_contatado || '').toLowerCase()) {
          await sendOpsCharge(lead.whatsapp_phone, `SLA 24h: lead ${lead.id} ainda não está como Contatado no Podio.`);
          await logJob(jobId, 'SLA 24h cobrança enviada');
        } else {
          await logJob(jobId, 'SLA 24h ok');
        }
        await markJob(jobId, 'done');
      }

      if (job.type === 'SLA_7D') {
        const etapaFieldId = fieldMap.franquia.etapa;
        const filled = await checkPodioFieldFilled(podioItemId, etapaFieldId);
        if (!filled) {
          await sendOpsCharge(lead.whatsapp_phone, `SLA 7 dias: evento ${lead.id} sem etapa/status no Podio.`);
          await logJob(jobId, 'SLA 7d cobrança enviada');
        } else {
          await logJob(jobId, 'SLA 7d ok');
        }
        await markJob(jobId, 'done');
      }

      if (job.type === 'POST_EVENTO') {
        const required = fieldMap.franquia.campos_pos_evento || [];
        const item = await getItem(podioItemId);
        const missing = required.filter((fieldId: string) => !getFieldValue(item, fieldId));
        if (missing.length > 0) {
          await sendOpsCharge(lead.whatsapp_phone, `Pós-evento: campos pendentes (${missing.length}) para lead ${lead.id}.`);
          await logJob(jobId, 'Pós-evento cobrança enviada');
        } else {
          await logJob(jobId, 'Pós-evento ok');
        }
        await markJob(jobId, 'done');
      }
    } catch (error) {
      const err = String(error);
      logger.error('Job failed', { jobId, err });
      await incrementJobAttempt(jobId, new Date(now.getTime() + 60 * 60 * 1000), err);
      await markJob(jobId, 'pending', err);
    }
  }
}
