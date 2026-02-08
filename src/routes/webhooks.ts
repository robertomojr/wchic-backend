import { Router } from 'express';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { verifyWebhookSignature, parseIncomingMessages, sendTextMessage } from '../services/whatsappService.js';
import { findOrCreateConversation, insertMessage, upsertLead } from '../db/repositories.js';
import { callAgent, getAgentPrompt } from '../services/openaiService.js';
import { extractLeadJson, normalizeLead, validateLead, finalizeLead } from '../services/leadService.js';
import { query } from '../db/pool.js';

export const webhookRouter = Router();

function verifyToken(req: any, res: any, expectedToken: string) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === expectedToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

webhookRouter.get('/clients', (req, res) => verifyToken(req, res, config.whatsapp.verifyTokenClients));
webhookRouter.get('/ops', (req, res) => verifyToken(req, res, config.whatsapp.verifyTokenOps));

webhookRouter.post('/clients', async (req, res) => {
  const rawBody = (req as any).rawBody ?? '';
  if (!verifyWebhookSignature(rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
    return res.sendStatus(401);
  }

  const messages = parseIncomingMessages(req.body);
  if (messages.length === 0) {
    return res.sendStatus(200);
  }

  for (const msg of messages) {
    const conversation = await findOrCreateConversation('clients', msg.from);
    await insertMessage(conversation.id, 'user', msg.type, msg.text ?? '');

    const dbMessages = await query(
      'SELECT role, text FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 20',
      [conversation.id]
    );

    const systemPrompt = await getAgentPrompt();
    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...dbMessages.rows.map((row: any) => ({ role: row.role, content: row.text }))
    ];

    const assistantReply = await callAgent(chatMessages);
    await insertMessage(conversation.id, 'assistant', 'text', assistantReply);

    const leadJson = extractLeadJson(assistantReply);
    let replyText = assistantReply;
    if (leadJson) {
      replyText = assistantReply.split('LEAD_WCHIC_JSON:')[0].trim();
      const normalized = normalizeLead(leadJson);
      await upsertLead(conversation.id, normalized);
      const errors = validateLead(normalized);
      if (errors.length === 0) {
        const lead = await query('SELECT id FROM leads WHERE conversation_id = $1', [conversation.id]);
        const leadId = lead.rows[0]?.id;
        if (leadId) {
          await finalizeLead(conversation.id, leadId, normalized);
        }
      } else {
        logger.warn('Lead JSON missing fields', { errors });
      }
    }

    if (replyText) {
      await sendTextMessage(config.whatsapp.clientsPhoneNumberId, msg.from, replyText);
    }
  }

  res.sendStatus(200);
});

webhookRouter.post('/ops', async (req, res) => {
  const rawBody = (req as any).rawBody ?? '';
  if (!verifyWebhookSignature(rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
    return res.sendStatus(401);
  }

  const messages = parseIncomingMessages(req.body);
  if (messages.length === 0) {
    return res.sendStatus(200);
  }

  for (const msg of messages) {
    const conversation = await findOrCreateConversation('ops', msg.from);
    await insertMessage(conversation.id, 'user', msg.type, msg.text ?? '');
  }

  res.sendStatus(200);
});
