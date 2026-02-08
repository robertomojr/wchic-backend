import type { Request, Response } from "express";
import axios from "axios";

export async function podioTest(req: Request, res: Response) {
  const clientId = process.env.PODIO_CLIENT_ID;
  const clientSecret = process.env.PODIO_CLIENT_SECRET;

  const appId = process.env.PODIO_APP_ID;
  const appToken = process.env.PODIO_APP_TOKEN;

  if (!clientId || !clientSecret || !appId || !appToken) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing PODIO_CLIENT_ID, PODIO_CLIENT_SECRET, PODIO_APP_ID or PODIO_APP_TOKEN in .env",
    });
  }

  try {
    // Autenticação como APP (grant_type=app) usando client_id/client_secret + app_id/app_token
    const tokenResp = await axios.post(
      "https://api.podio.com/oauth/token",
      new URLSearchParams({
        grant_type: "app",
        client_id: clientId,
        client_secret: clientSecret,
        app_id: appId,
        app_token: appToken,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const accessToken = tokenResp.data?.access_token;
    if (!accessToken) throw new Error("No access_token returned by Podio");

    const appResp = await axios.get(`https://api.podio.com/app/${appId}`, {
      headers: { Authorization: `OAuth2 ${accessToken}` },
    });

    return res.json({
      ok: true,
      appId: Number(appId),
      appName: appResp.data?.config?.name ?? "unknown",
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.response?.data ?? err?.message ?? "Unknown error",
    });
  }
}

