import type { Request, Response } from "express";

export async function leadRouteTest(_req: Request, res: Response) {
  return res.status(410).json({
    ok: false,
    error: "leadRouteTest desativado (roteamento agora é via Supabase trigger)",
  });
}
