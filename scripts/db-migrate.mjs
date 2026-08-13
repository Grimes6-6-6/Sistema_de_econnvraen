import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./db-client.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(scriptDirectory, "../db/migrations");
const pool = createPool();
const MIGRATION_LOCK_ID = 731_284_901;

let lockAcquired = false;
try {
  await pool.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
  lockAcquired = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await pool.query(
      "SELECT checksum FROM schema_migrations WHERE filename = $1",
      [filename],
    );

    if (applied.rowCount) {
      if (applied.rows[0].checksum !== checksum) {
        throw new Error(
          `La migración ${filename} fue modificada después de aplicarse. Crea una nueva migración.`,
        );
      }
      console.log(`Omitida ${filename}: ya estaba aplicada.`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [filename, checksum],
      );
      await client.query("COMMIT");
      console.log(`Aplicada ${filename}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  if (lockAcquired) {
    await pool.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
  }
  await pool.end();
}
