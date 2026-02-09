import type { Request, Response } from "express";
// import { getFranchiseByCityState } from "../db/repositories.js";

export function routingResolve() {
  throw new Error("routingResolve desativado: roteamento agora é via Supabase trigger");
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
