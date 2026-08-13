import { createPool } from "./db-client.mjs";

const pool = createPool();

try {
  const result = await pool.query(
    "SELECT current_database() AS database, current_user AS username, NOW() AS checked_at",
  );
  console.log("Conexión PostgreSQL correcta:", result.rows[0]);
} finally {
  await pool.end();
}
