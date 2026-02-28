#!/usr/bin/env node
/**
 * scripts/registerPodioWebhooks.mjs
 *
 * Registra o webhook do WChic nos 4 apps do Podio.
 * Executar UMA VEZ após o deploy da Tarefa #11.
 *
 * Uso:
 *   node scripts/registerPodioWebhooks.mjs
 *
 * Variáveis de ambiente necessárias (pode exportar no terminal antes):
 *   PODIO_CLIENT_ID, PODIO_CLIENT_SECRET
 *   PODIO_FRANQUEADORA_APP_ID, PODIO_FRANQUEADORA_APP_TOKEN
 *   PODIO_CAMPINAS_APP_ID, PODIO_CAMPINAS_APP_TOKEN
 *   PODIO_LITORAL_NORTE_APP_ID, PODIO_LITORAL_NORTE_APP_TOKEN
 *   PODIO_RIO_BH_APP_ID, PODIO_RIO_BH_APP_TOKEN
 */

import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const WEBHOOK_URL = "https://wchic-backend.onrender.com/webhook/podio";

const WORKSPACES = [
  { key: "franqueadora",  appId: process.env.PODIO_FRANQUEADORA_APP_ID,  appToken: process.env.PODIO_FRANQUEADORA_APP_TOKEN },
  { key: "campinas",      appId: process.env.PODIO_CAMPINAS_APP_ID,      appToken: process.env.PODIO_CAMPINAS_APP_TOKEN },
  { key: "litoral_norte", appId: process.env.PODIO_LITORAL_NORTE_APP_ID, appToken: process.env.PODIO_LITORAL_NORTE_APP_TOKEN },
  { key: "rio_bh",        appId: process.env.PODIO_RIO_BH_APP_ID,        appToken: process.env.PODIO_RIO_BH_APP_TOKEN },
];

async function getAccessToken(appId, appToken) {
  const resp = await axios.post(
    "https://api.podio.com/oauth/token",
    new URLSearchParams({
      grant_type: "app",
      client_id: process.env.PODIO_CLIENT_ID,
      client_secret: process.env.PODIO_CLIENT_SECRET,
      app_id: appId,
      app_token: appToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return resp.data.access_token;
}

async function listExistingHooks(accessToken, appId) {
  const resp = await axios.get(
    `https://api.podio.com/hook/app/${appId}/`,
    { headers: { Authorization: `OAuth2 ${accessToken}` } }
  );
  return resp.data ?? [];
}

async function registerHook(accessToken, appId, key) {
  const resp = await axios.post(
    `https://api.podio.com/hook/app/${appId}/`,
    { url: WEBHOOK_URL, type: "item.update" },
    { headers: { Authorization: `OAuth2 ${accessToken}`, "Content-Type": "application/json" } }
  );
  return resp.data;
}

async function main() {
  console.log("🔗 Registrando webhooks do Podio...\n");
  console.log(`URL do webhook: ${WEBHOOK_URL}\n`);

  for (const ws of WORKSPACES) {
    if (!ws.appId || !ws.appToken) {
      console.log(`⚠️  ${ws.key}: variáveis não configuradas — pulando`);
      continue;
    }

    try {
      const token = await getAccessToken(ws.appId, ws.appToken);

      // Verifica se já existe webhook cadastrado
      const existing = await listExistingHooks(token, ws.appId);
      const alreadyRegistered = existing.find(h => h.url === WEBHOOK_URL && h.type === "item.update");

      if (alreadyRegistered) {
        console.log(`✅ ${ws.key} (app ${ws.appId}): webhook já existe (hook_id: ${alreadyRegistered.hook_id})`);
        continue;
      }

      const result = await registerHook(token, ws.appId, ws.key);
      console.log(`✅ ${ws.key} (app ${ws.appId}): webhook registrado! hook_id: ${result.hook_id}`);
      console.log(`   ⚠️  O Podio enviará uma verificação. O backend responde automaticamente.`);
    } catch (err) {
      const detail = err?.response?.data ?? err?.message;
      console.log(`❌ ${ws.key}: erro — ${JSON.stringify(detail)}`);
    }
  }

  console.log("\n✅ Concluído!");
}

main();
