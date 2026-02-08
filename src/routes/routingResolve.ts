import type { Request, Response } from "express";
import { getFranchiseByCityState } from "../db/repositories.js";
import type { WorkspaceKey } from "../services/podioService.js";

function inferWorkspaceKeyFromFranchise(franchise: any): WorkspaceKey | null {
  if (franchise?.workspace_key) return franchise.workspace_key as WorkspaceKey;

  const text = String(
    franchise?.name ??
      franchise?.nome ??
      franchise?.area ??
      franchise?.area_da_franquia ??
      franchise?.workspace ??
      ""
  ).toLowerCase();

  if (text.includes("campinas")) return "campinas";
  if (text.includes("litoral")) return "litoral_norte";
  if (text.includes("rio") || text.includes("bh") || text.includes("belo horizonte")) return "rio_bh";

  return null;
}

function errorToDebug(err: any) {
  // tenta extrair o máximo possível sem quebrar
  const message =
    (typeof err?.message === "string" && err.message) ||
    (typeof err === "string" && err) ||
    "";

  return {
    message,
    name: err?.name ?? null,
    code: err?.code ?? null,
    stack: err?.stack ?? null,
    raw: (() => {
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    })(),
  };
}

export async function routingResolve(req: Request, res: Response) {
  const cidade = String(req.query.cidade ?? "").trim();
  const estado = String(req.query.estado ?? "").trim().toUpperCase();

  if (!cidade || !estado) {
    return res.status(400).json({
      ok: false,
      error: "Informe ?cidade=...&estado=... (ex: ?cidade=Campinas&estado=SP)",
    });
  }

  try {
    const franchise = await getFranchiseByCityState(cidade, estado);

    if (!franchise) {
      return res.json({
        ok: true,
        found: false,
        cidade,
        estado,
        workspaceKey: null,
        franchise: null,
      });
    }

    const workspaceKey = inferWorkspaceKeyFromFranchise(franchise);

    return res.json({
      ok: true,
      found: true,
      cidade,
      estado,
      workspaceKey,
      franchise: {
        id: franchise.id ?? null,
        name: franchise.name ?? franchise.nome ?? null,
        podio_app_id: franchise.podio_app_id ?? null,
        workspace_key: franchise.workspace_key ?? null,
      },
    });
  } catch (err: any) {
    const debug = errorToDebug(err);
    return res.status(500).json({
      ok: false,
      error: debug.message || "Routing failed (no message)",
      debug,
    });
  }
}

