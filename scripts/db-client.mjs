import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const { Pool } = pg;

export function createPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL no está configurada.");
  }

  const sslEnabled = process.env.DATABASE_SSL === "true";
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");

  if (sslEnabled && !ca) {
    throw new Error(
      "DATABASE_CA_CERT es obligatoria cuando DATABASE_SSL=true para verificar el servidor.",
    );
  }

  return new Pool({
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized: true, ca } : undefined,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}
