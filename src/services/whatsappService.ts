import crypto from 'node:crypto';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export type IncomingMessage = {
  from: string;
  id: string;
  timestamp: string;
  text?: string;
  type: string;
};

export function verifyWebhookSignature(rawBody: string, signatureHeader?: string) {
  if (!config.whatsapp.appSecret) {
    return true;
  }
  if (!signatureHeader) {
    return false;
  }
  const signature = signatureHeader.replace('sha256=', '');
  const expected = crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
  const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!isValid) {
    logger.warn('Invalid webhook signature');
  }
  return isValid;
}

export function parseIncomingMessages(body: any): IncomingMessage[] {
  const messages: IncomingMessage[] = [];
  const entry = body?.entry ?? [];
  for (const item of entry) {
    const changes = item?.changes ?? [];
    for (const change of changes) {
      const value = change?.value;
      const incoming = value?.messages ?? [];
      for (const msg of incoming) {
        messages.push({
          from: msg.from,
          id: msg.id,
          timestamp: msg.timestamp,
          type: msg.type,
          text: msg.text?.body
        });
      }
    }
  }
  return messages;
}

export async function sendTextMessage(phoneNumberId: string, to: string, text: string) {
  const url = `${config.whatsapp.apiBase}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to,
    text: { body: text }
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error('Failed sending WhatsApp message', { status: response.status, errText });
    throw new Error('WhatsApp send failed');
  }
}

export async function sendTemplateMessage(phoneNumberId: string, to: string, templateName: string, languageCode: string, params: string[]) {
  const url = `${config.whatsapp.apiBase}/${phoneNumberId}/messages`;
  const components = params.length
    ? [
        {
          type: 'body',
          parameters: params.map((text) => ({ type: 'text', text }))
        }
      ]
    : [];

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error('Failed sending WhatsApp template', { status: response.status, errText });
    throw new Error('WhatsApp template send failed');
  }
}
