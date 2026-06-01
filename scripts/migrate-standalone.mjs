/**
 * Standalone drizzle migration runner for Dokploy/Docker deployments.
 * Reads DATABASE_URL from env. Applies pending migrations from /app/drizzle/.
 * Called from the container entrypoint before server.js starts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "pg";
const { Client } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate] ERROR: DATABASE_URL is not set");
  process.exit(1);
}

// Allow specifying the migrations directory via env (for testing)
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? join(import.meta.dirname, "drizzle");

async function applyMigrations() {
  const client = new Client({ connectionString: DATABASE_URL });

  // Retry connection for up to 60s — Postgres may still be starting up
  const MAX_RETRIES = 12;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.connect();
      console.log("[migrate] connected to database");
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`[migrate] failed to connect after ${MAX_RETRIES} attempts:`, err.message);
        process.exit(1);
      }
      console.warn(`[migrate] connection attempt ${attempt}/${MAX_RETRIES} failed — retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  try {
    // Ensure drizzle migrations journal table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id        SERIAL PRIMARY KEY,
        hash      TEXT NOT NULL UNIQUE,
        created_at BIGINT
      )
    `);

    // Read migration files in order
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    console.log(`[migrate] found ${files.length} migration files`);

    for (const file of files) {
      // Use filename (without extension) as hash to match drizzle-kit convention
      const hash = file.replace(/\.sql$/, "");
      const { rows } = await client.query(
        "SELECT id FROM __drizzle_migrations WHERE hash = $1",
        [hash]
      );
      if (rows.length > 0) {
        console.log(`[migrate] skipping (already applied): ${file}`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`[migrate] applying: ${file}`);
      await client.query(sql);
      await client.query(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        [hash, Date.now()]
      );
      console.log(`[migrate] done: ${file}`);
    }

    console.log("[migrate] all migrations applied successfully");
  } finally {
    await client.end();
  }
}

applyMigrations().catch((err) => {
  console.error("[migrate] fatal error:", err);
  process.exit(1);
});
