// src/db/pool.ts
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Alerta em erros inesperados de conexão (ex: Supabase pausado)
pool.on("error", (err) => {
  console.error("[db/pool] Erro inesperado no pool:", err.message);
  // Importação dinâmica para evitar dependência circular no boot
  import("../services/alertService.js").then(({ alert }) => {
    alert("database_error", "Erro inesperado no pool de conexão com o banco", {
      error: err.message,
      hint: "Verifique se o Supabase está pausado em https://supabase.com/dashboard",
    }).catch(() => {});
  }).catch(() => {});
});

export const query = async (text: string, params: any[] = []) => {
  try {
    return await pool.query(text, params);
  } catch (err: any) {
    // Alerta em erros de query que indiquem banco fora do ar
    const isConnectionError =
      err?.code === "ECONNREFUSED" ||
      err?.code === "ENOTFOUND" ||
      err?.message?.includes("Tenant or user not found") ||
      err?.message?.includes("connection terminated");

    if (isConnectionError) {
      import("../services/alertService.js").then(({ alert }) => {
        alert("database_error", "Erro de conexão com o banco de dados (Supabase)", {
          error: err.message,
          code: err.code,
          hint: "Verifique se o Supabase está pausado em https://supabase.com/dashboard",
        }).catch(() => {});
      }).catch(() => {});
    }

    throw err;
  }
};

export default pool;

