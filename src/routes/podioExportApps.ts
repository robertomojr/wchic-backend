import type { Request, Response } from "express";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";

type AppKey = "franqueadora" | "campinas" | "litoral_norte" | "rio_bh";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
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

function getAppsFromEnv() {
  const apps: Record<AppKey, { appId: string; appToken: string }> = {
    franqueadora: {
      appId: requireEnv("PODIO_FRANQUEADORA_APP_ID"),
      appToken: requireEnv("PODIO_FRANQUEADORA_APP_TOKEN"),
    },
    campinas: {
      appId: requireEnv("PODIO_CAMPINAS_APP_ID"),
      appToken: requireEnv("PODIO_CAMPINAS_APP_TOKEN"),
    },
    litoral_norte: {
      appId: requireEnv("PODIO_LITORAL_NORTE_APP_ID"),
      appToken: requireEnv("PODIO_LITORAL_NORTE_APP_TOKEN"),
    },
    rio_bh: {
      appId: requireEnv("PODIO_RIO_BH_APP_ID"),
      appToken: requireEnv("PODIO_RIO_BH_APP_TOKEN"),
    },
  };

  return apps;
}

export async function podioExportApps(_req: Request, res: Response) {
  try {
    const apps = getAppsFromEnv();

    const outDir = path.join(process.cwd(), "podio-apps");
    fs.mkdirSync(outDir, { recursive: true });

    const files: Record<string, string> = {};

    for (const [name, { appId, appToken }] of Object.entries(apps)) {
      const accessToken = await getAccessTokenForApp(appId, appToken);

      const appResp = await axios.get(`https://api.podio.com/app/${appId}`, {
        headers: { Authorization: `OAuth2 ${accessToken}` },
      });

      const filePath = path.join(outDir, `${name}.app.${appId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(appResp.data, null, 2), "utf-8");
      files[name] = filePath;
    }

    return res.json({ ok: true, files });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.response?.data ?? err?.message ?? "Unknown error",
    });
  }
}
