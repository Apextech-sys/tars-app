import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { cleanJobs, getTestPool } from "../setup.js";

const { Client } = pg;

describe("dispatch / queue plumbing", () => {
  afterEach(async () => {
    await cleanJobs();
  });

  it("fires pg_notify('tars_jobs_new', id) on INSERT", async () => {
    const url = process.env.TARS_APP_DB_URL!;
    const listener = new Client({ connectionString: url });
    await listener.connect();
    await listener.query("LISTEN tars_jobs_new");

    const got = new Promise<string>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("NOTIFY did not arrive in 5s")),
        5_000,
      );
      listener.on("notification", (msg) => {
        if (msg.channel === "tars_jobs_new" && msg.payload) {
          clearTimeout(t);
          resolve(msg.payload);
        }
      });
    });

    const id = randomUUID();
    await getTestPool().query(
      "INSERT INTO tars_jobs (id, kind, payload, status) VALUES ($1,$2,$3,'queued')",
      [id, "no-op", { hello: "world" }],
    );

    const payload = await got;
    expect(payload).toBe(id);

    await listener.query("UNLISTEN tars_jobs_new");
    await listener.end();
  });

  it("rejects duplicate idempotency_key", async () => {
    const key = "dedupe-" + randomUUID();
    const id1 = randomUUID();
    const id2 = randomUUID();
    const pool = getTestPool();

    await pool.query(
      "INSERT INTO tars_jobs (id, kind, payload, idempotency_key) VALUES ($1,'no-op','{}'::jsonb,$2)",
      [id1, key],
    );

    let dupeErr: unknown;
    try {
      await pool.query(
        "INSERT INTO tars_jobs (id, kind, payload, idempotency_key) VALUES ($1,'no-op','{}'::jsonb,$2)",
        [id2, key],
      );
    } catch (e) {
      dupeErr = e;
    }
    expect(dupeErr).toBeDefined();
    expect(String(dupeErr)).toMatch(/duplicate|unique/i);

    const res = await pool.query<{ id: string }>(
      "SELECT id FROM tars_jobs WHERE idempotency_key = $1",
      [key],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe(id1);
  });
});
