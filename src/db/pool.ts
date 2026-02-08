// src/db/pool.ts
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não definida");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// função simples para queries
export function query<T = any>(text: string, params: any[] = []) {
  return pool.query<T>(text, params);
}

export default pool;

