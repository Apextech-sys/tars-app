import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getTestPool(): pg.Pool {
  if (!pool) {
    const url = process.env.TARS_APP_DB_URL;
    if (!url) {
      throw new Error("TARS_APP_DB_URL not set for tests");
    }
    pool = new Pool({ connectionString: url, max: 4 });
  }
  return pool;
}

export async function ensureSchema(): Promise<void> {
  const sqlPath = join(
    process.cwd(),
    "..",
    "lib",
    "db",
    "migrations",
    "0001_tars_jobs.sql"
  );
  const sql = readFileSync(sqlPath, "utf8");
  await getTestPool().query(sql);
}

export async function cleanJobs(): Promise<void> {
  await getTestPool().query("DELETE FROM tars_jobs");
}

beforeAll(async () => {
  await ensureSchema();
});

afterAll(async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});
