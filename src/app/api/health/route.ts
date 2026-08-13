import { query } from "@/server/db/pool";
import { noStoreJson } from "@/server/http";

export async function GET() {
  try {
    await query("SELECT 1");
    return noStoreJson({ status: "ok" });
  } catch {
    return noStoreJson(
      { status: "unavailable" },
      { status: 503 },
    );
  }
}
