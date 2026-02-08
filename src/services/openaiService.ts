import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedPrompt = '';

export async function getAgentPrompt(): Promise<string> {
  if (cachedPrompt) {
    return cachedPrompt;
  }
  const promptPath = path.resolve(__dirname, '../prompts/agent_wchic.txt');
  cachedPrompt = await fs.readFile(promptPath, 'utf8');
  return cachedPrompt;
}

export async function callAgent(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error('OpenAI error', { status: response.status, errText });
    throw new Error('OpenAI request failed');
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI empty response');
  }
  return content as string;
}
