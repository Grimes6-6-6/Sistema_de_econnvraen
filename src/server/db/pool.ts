import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __econnvraePool: Pool | undefined;
}

function getDatabaseConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL_NOT_CONFIGURED");
  }

  const sslEnabled = process.env.DATABASE_SSL === "true";
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");

  if (sslEnabled && !ca) {
    throw new Error("DATABASE_CA_CERT_REQUIRED");
  }

  const poolMax = Number(process.env.DATABASE_POOL_MAX || 10);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 50) {
    throw new Error("DATABASE_POOL_MAX_INVALID");
  }

  return {
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized: true, ca } : undefined,
    poolMax,
  };
}

function getPool(): Pool {
  if (!globalThis.__econnvraePool) {
    const config = getDatabaseConfig();
    const { poolMax, ...poolConfig } = config;
    globalThis.__econnvraePool = new Pool({
      ...poolConfig,
      max: poolMax,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      application_name: "econnvrae-next",
    });

    globalThis.__econnvraePool.on("error", (error) => {
      console.error("PostgreSQL pool error", {
        name: error.name,
        code: "code" in error ? error.code : undefined,
      });
    });
  }

  return globalThis.__econnvraePool;
}

export async function query<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
) {
  return getPool().query<Row>(text, [...values]);
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
