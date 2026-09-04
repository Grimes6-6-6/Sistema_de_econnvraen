import "server-only";

import { query } from "@/server/db/pool";

interface RateLimitRow {
  request_count: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const bucketStart = Math.floor(now / windowMs) * windowMs;
  const expiresAt = new Date(bucketStart + windowMs);

  await query("DELETE FROM rate_limits WHERE expires_at < NOW()");

  const result = await query<RateLimitRow>(
    `INSERT INTO rate_limits (
       rate_key, bucket_start, request_count, expires_at
     )
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (rate_key, bucket_start) DO UPDATE
     SET request_count = rate_limits.request_count + 1
     RETURNING request_count`,
    [key, bucketStart, expiresAt],
  );

  const count = result.rows[0]?.request_count ?? limit + 1;
  return {
    allowed: count <= limit,
    retryAfterSeconds:
      count <= limit ? 0 : Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)),
  };
}

export async function clearRateLimit(key: string): Promise<void> {
  await query("DELETE FROM rate_limits WHERE rate_key = $1", [key]);
}
