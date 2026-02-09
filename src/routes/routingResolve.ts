import type { Request, Response } from "express";

export async function routingResolve(_req: Request, res: Response) {
  return res.status(410).json({
    ok: false,
    error: "routingResolve desativado (roteamento agora é via Supabase trigger)",
  });
}
