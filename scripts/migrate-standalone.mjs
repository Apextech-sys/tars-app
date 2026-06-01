/**
 * Standalone drizzle migration runner for Dokploy/Docker deployments.
 * Uses drizzle-orm + postgres (postgres.js) — both bundled in Next.js standalone output.
 * Reads DATABASE_URL from env. Applies pending migrations from ./drizzle/.
 * Called from the container entrypoint before server.js starts.
 *
 * IMPORTANT: This script must use only packages available in the Next.js standalone
 * output (/app/node_modules). The 'pg' npm package is NOT available — use 'postgres'.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate] ERROR: DATABASE_URL is not set");
  process.exit(1);
}

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? join(__dirname, "drizzle");

async function applyMigrations() {
  let sql;

  // Retry connection for up to 60s — postgres may still be starting
  const MAX_RETRIES = 12;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Dynamic import — postgres is available in /app/node_modules/postgres
      const { default: postgres } = await import("postgres");
      sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 30 });
      // Test the connection with a simple query
      await sql`SELECT 1`;
      console.log("[migrate] connected to database");
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(
          `[migrate] failed to connect after ${MAX_RETRIES} attempts:`,
          err.message
        );
        process.exit(1);
      }
      console.warn(
        `[migrate] connection attempt ${attempt}/${MAX_RETRIES} failed — retrying in 5s: ${err.message}`
      );
      if (sql) {
        try { await sql.end(); } catch {}
        sql = null;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  try {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");

    const db = drizzle(sql);

    console.log(`[migrate] running drizzle migrations from: ${MIGRATIONS_DIR}`);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log("[migrate] all migrations applied successfully");
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}

applyMigrations().catch((err) => {
  console.error("[migrate] fatal error:", err.message ?? err);
  process.exit(1);
});
