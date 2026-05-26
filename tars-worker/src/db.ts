import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Config } from "./config.js";
import * as schema from "../../lib/db/worker-schema.js";

const { Pool } = pg;

let _pool: pg.Pool | undefined;
let _db: NodePgDatabase<typeof schema> | undefined;

export function initDb(cfg: Config): {
  pool: pg.Pool;
  db: NodePgDatabase<typeof schema>;
} {
  if (_pool && _db) {
    return { pool: _pool, db: _db };
  }
  _pool = new Pool({
    connectionString: cfg.TARS_APP_DB_URL,
    max: Math.max(cfg.TARS_WORKER_CONCURRENCY + 2, 4),
    idleTimeoutMillis: 30_000,
  });
  _db = drizzle(_pool, { schema });
  return { pool: _pool, db: _db };
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) throw new Error("db not initialised — call initDb first");
  return _db;
}

export function getPool(): pg.Pool {
  if (!_pool) throw new Error("pool not initialised — call initDb first");
  return _pool;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _db = undefined;
  }
}

export async function withTx<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore — connection may be dead
    }
    throw err;
  } finally {
    client.release();
  }
}
