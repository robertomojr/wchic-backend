import type { Request, Response } from "express";
import { getFranchiseByCityState } from "../db/repositories.js";

export async function leadRouteTest(req: Request, res: Response) {
  const { nome, telefone, cidade, estado } = req.body ?? {};

  if (!nome || !telefone || !cidade || !estado) {
    return res.status(400).json({
      ok: false,
      error: "Envie nome, telefone, cidade e estado no body",
    });
  }

  const franchise = await getFranchiseByCityState(cidade, estado);

  return res.json({
    ok: true,
    lead: { nome, telefone, cidade, estado },
    routed_to: franchise
      ? {
          franchise_id: franchise.id,
          workspace_key: franchise.workspace_key,
          podio_app_id: franchise.podio_app_id,
        }
      : null,
  });
}
