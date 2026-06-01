/**
 * Standalone SQL migration runner for Dokploy/Docker deployments.
 * Uses postgres.js — bundled in the Next.js standalone output.
 *
 * Applies all .sql files in ./drizzle/ in alphabetical order.
 * Tracks applied migrations in __tars_migrations (idempotent).
 * Retries DB connection up to 12x (5s each = 60s total).
 *
 * Only postgres (postgres.js) is used — it IS bundled in the Next.js
 * standalone /app/node_modules/postgres. drizzle-orm migrator is NOT
 * (it is tree-shaken out), so this script uses raw sql.unsafe() instead.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? join(__dirname, "drizzle");
const MAX_RETRIES = 12;
const RETRY_DELAY_MS = 5000;

if (!DATABASE_URL) {
  console.error("[migrate] ERROR: DATABASE_URL is not set");
  process.exit(1);
}

async function connectWithRetry() {
  const { default: postgres } = await import("postgres");
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let sql = null;
    try {
      sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 30 });
      await sql`SELECT 1`;
      console.log("[migrate] connected to database");
      return sql;
    } catch (err) {
      try {
        await sql?.end();
      } catch (_e) {
        /* ignore cleanup error */
      }
      if (attempt === MAX_RETRIES) {
        console.error(
          `[migrate] connection failed after ${MAX_RETRIES} attempts:`,
          err.message
        );
        process.exit(1);
      }
      console.warn(
        `[migrate] attempt ${attempt}/${MAX_RETRIES} failed — retry in 5s: ${err.message}`
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

async function applyFile(sql, file) {
  const sqlText = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
  const statements = sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  console.log(`[migrate] applying: ${file} (${statements.length} statements)`);
  for (const stmt of statements) {
    await sql.unsafe(stmt);
  }
  await sql`INSERT INTO __tars_migrations (filename) VALUES (${file})`;
  console.log(`[migrate] done: ${file}`);
}

async function applyMigrations() {
  const sql = await connectWithRetry();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS __tars_migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    console.log(`[migrate] found ${files.length} migration files`);

    for (const file of files) {
      const rows =
        await sql`SELECT id FROM __tars_migrations WHERE filename = ${file}`;
      if (rows.length > 0) {
        console.log(`[migrate] skip (already applied): ${file}`);
        continue;
      }
      await applyFile(sql, file);
    }
    console.log("[migrate] all migrations applied successfully");
  } finally {
    await sql.end();
  }
}

applyMigrations().catch((err) => {
  console.error("[migrate] fatal error:", err.message ?? err);
  process.exit(1);
});
