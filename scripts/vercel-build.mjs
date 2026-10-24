import { spawnSync } from "node:child_process";
import path from "node:path";

function runNodeScript(script, args = [], ignoreError = false) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0 && !ignoreError) {
    process.exit(result.status || 1);
  }
}

if (process.env.VERCEL_ENV === "production") {
  console.log("Aplicando y validando migraciones de producción antes de compilar...");
  runNodeScript(path.resolve("scripts/db-migrate.mjs"), [], true);
}

runNodeScript(path.resolve("node_modules/next/dist/bin/next"), ["build"]);
