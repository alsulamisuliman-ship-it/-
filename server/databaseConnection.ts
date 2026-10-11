import { createPool, type Pool } from "mysql2/promise";

let pool: Pool | undefined;
export function getDatabasePool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!pool) {
    pool = createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: 4,
      ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: true },
    });
  }
  return pool;
}
