import axios from "axios";
import fs from "node:fs";
import path from "node:path";

export type WorkspaceKey = "franqueadora" | "campinas" | "litoral_norte" | "rio_bh";

export type CanonicalLead = {
  external_id: string; // wchic:wa:+55...:YYYY-MM-DD
  fields: Record<string, any>; // chaves = podio_external_id (ex: "status", "area-da-franquia")
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function loadJson(relPath: string) {
  const p = path.join(process.cwd(), relPath);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function getWorkspaceEnv(key: WorkspaceKey) {
  const prefix =
    key === "franqueadora"
      ? "PODIO_FRANQUEADORA"
      : key === "campinas"
      ? "PODIO_CAMPINAS"
      : key === "litoral_norte"
      ? "PODIO_LITORAL_NORTE"
      : "PODIO_RIO_BH";

  return {
    appId: requireEnv(`${prefix}_APP_ID`),
    appToken: requireEnv(`${prefix}_APP_TOKEN`),
  };
}

async function getAccessTokenForApp(appId: string, appToken: string) {
  const clientId = requireEnv("PODIO_CLIENT_ID");
  const clientSecret = requireEnv("PODIO_CLIENT_SECRET");

  const tokenResp = await axios.post(
    "https://api.podio.com/oauth/token",
    new URLSearchParams({
      grant_type: "app",
      client_id: clientId,
      client_secret: clientSecret,
      app_id: appId,
      app_token: appToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const accessToken = tokenResp.data?.access_token;
  if (!accessToken) throw new Error("No access_token returned by Podio");
  return accessToken as string;
}

function loadWorkspaceMapping(key: WorkspaceKey) {
  return loadJson(`src/config/podio.workspace.${key}.json`);
}

/**
 * Resolve qual external_id do campo "Nome" (título) existe no app:
 * - preferir "title"
 * - senão, achar campo com label "Nome"
 * - senão, achar primeiro text required
 */
function resolveTitleExternalId(ws: any): string | null {
  if (ws?.fields?.["title"]) return "title";

  const entries = Object.entries(ws?.fields ?? {}) as Array<[string, any]>;

  const byLabelNome = entries.find(([, meta]) => meta?.type === "text" && meta?.label === "Nome");
  if (byLabelNome) return byLabelNome[0];

  const byRequiredText = entries.find(([, meta]) => meta?.type === "text" && meta?.required === true);
  if (byRequiredText) return byRequiredText[0];

  return null;
}

/**
 * Converte payload canônico -> payload Podio (por podio_external_id)
 * - category: converte label -> option_id usando mapping do workspace
 * - title: garante preenchimento mesmo se o external_id do título variar (title/title-2/etc)
 */
function buildPodioFields(workspaceKey: WorkspaceKey, canonical: CanonicalLead) {
  const ws = loadWorkspaceMapping(workspaceKey);
  const out: Record<string, any> = {};

  for (const [podioExternalId, value] of Object.entries(canonical.fields)) {
    const fieldMeta = ws.fields?.[podioExternalId];
    if (!fieldMeta) continue;

    if (fieldMeta.type === "category") {
      const optionsMap = ws.categories?.[podioExternalId]?.options ?? {};

      if (Array.isArray(value)) {
        out[podioExternalId] = value
          .map((label) => optionsMap[label])
          .filter((id) => typeof id === "number");
      } else if (typeof value === "string") {
        const id = optionsMap[value];
        if (typeof id === "number") out[podioExternalId] = id;
      } else if (typeof value === "number") {
        out[podioExternalId] = value;
      }
    } else {
      out[podioExternalId] = value;
    }
  }

  // ✅ Garantir título (Nome) de forma compatível com cada app/workspace
  const titleExternalId = resolveTitleExternalId(ws);
  const canonicalTitle = canonical.fields?.["title"];

  if (titleExternalId) {
    if (!out[titleExternalId]) {
      out[titleExternalId] =
        typeof canonicalTitle === "string" && canonicalTitle.trim().length > 0
          ? canonicalTitle
          : `Lead WhatsApp - ${canonical.external_id}`;
    }
  }

  return out;
}

async function getItemByExternalId(accessToken: string, appId: string, externalId: string) {
  const resp = await axios.get(
    `https://api.podio.com/item/app/${appId}/external_id/${encodeURIComponent(externalId)}`,
    { headers: { Authorization: `OAuth2 ${accessToken}` } }
  );
  return resp.data;
}

async function createItemInternal(
  accessToken: string,
  appId: string,
  externalId: string | null,
  fields: Record<string, any>
) {
  const payload: any = { fields };
  if (externalId) payload.external_id = externalId;

  const resp = await axios.post(`https://api.podio.com/item/app/${appId}/`, payload, {
    headers: { Authorization: `OAuth2 ${accessToken}` },
  });
  return resp.data;
}

async function updateItem(accessToken: string, itemId: number, externalId: string, fields: Record<string, any>) {
  const resp = await axios.put(
    `https://api.podio.com/item/${itemId}`,
    { external_id: externalId, fields },
    { headers: { Authorization: `OAuth2 ${accessToken}` } }
  );
  return resp.data;
}

/**
 * ✅ NOVO: Upsert por external_id (idempotente) por workspace/app
 */
export async function upsertLeadToPodio(workspaceKey: WorkspaceKey, canonical: CanonicalLead) {
  const { appId, appToken } = getWorkspaceEnv(workspaceKey);
  const accessToken = await getAccessTokenForApp(appId, appToken);
  const fields = buildPodioFields(workspaceKey, canonical);

  try {
    const existing = await getItemByExternalId(accessToken, appId, canonical.external_id);
    const itemId = existing?.item_id;
    if (!itemId) throw new Error("Item exists but item_id missing");

    await updateItem(accessToken, itemId, canonical.external_id, fields);
    return { ok: true, action: "updated", workspaceKey, appId: Number(appId), itemId };
  } catch (err: any) {
    if (err?.response?.status === 404) {
      const created = await createItemInternal(accessToken, appId, canonical.external_id, fields);
      return {
        ok: true,
        action: "created",
        workspaceKey,
        appId: Number(appId),
        itemId: created?.item_id,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// LEGACY COMPAT: mantém o projeto rodando enquanto migramos arquivos antigos.
// ---------------------------------------------------------------------------

async function getAccessTokenDefaultApp() {
  const appId = requireEnv("PODIO_FRANQUEADORA_APP_ID");
  const appToken = requireEnv("PODIO_FRANQUEADORA_APP_TOKEN");
  return getAccessTokenForApp(appId, appToken);
}

/**
 * LEGACY: getItem(itemId)
 */
export async function getItem(itemId: string) {
  const accessToken = await getAccessTokenDefaultApp();
  const resp = await axios.get(`https://api.podio.com/item/${itemId}`, {
    headers: { Authorization: `OAuth2 ${accessToken}` },
  });
  return resp.data;
}

/**
 * LEGACY: createItem(appId, fields)
 * Observação: aqui "fields" deve ser por podio_external_id (não field_id).
 */
export async function createItem(appId: string, fields: Record<string, any>) {
  const accessToken = await getAccessTokenDefaultApp();
  return createItemInternal(accessToken, appId, null, fields);
}

