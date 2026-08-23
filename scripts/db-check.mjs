import { createPool } from "./db-client.mjs";
import { verifyCurrentSchema } from "./db-schema.mjs";

const pool = createPool();

try {
  const result = await pool.query(
    "SELECT current_database() AS database, NOW() AS checked_at",
  );
  await verifyCurrentSchema(pool);
  console.log("Conexión y esquema PostgreSQL correctos:", result.rows[0]);
} finally {
  await pool.end();
}
