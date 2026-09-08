import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { externalPath, loadKey, pgTool, readManifest, verifyArchive, decryptStream, restrictFile, reportError } from "./backup-utils.mjs";

async function main() {
  const { values } = parseArgs({ options: { manifest: { type: "string" }, "key-file": { type: "string" }, "decrypt-to": { type: "string" }, help: { type: "boolean" } } });
  if (values.help) {
    console.log("node scripts/db-backup-verify.mjs --manifest <ruta-manifest.json> --key-file <ruta-clave>\nOpcional: --decrypt-to <ruta-nueva-externa.dump> para preparar una recuperación aislada.\nLa verificación no conecta a ninguna base ni ejecuta el SQL del respaldo.");
    return;
  }
  const manifest = await readManifest(await externalPath(values.manifest));
  const key = await loadKey(values["key-file"]);
  await verifyArchive(manifest, key, await pgTool("pg_restore"));
  if (values["decrypt-to"]) {
    const destination = await externalPath(values["decrypt-to"]);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    // Exclusive creation protects an existing archive. Only a verified encrypted
    // archive reaches this branch, and plaintext is restricted before writing.
    const stream = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    await new Promise((resolve, reject) => { stream.once("open", resolve); stream.once("error", reject); });
    await restrictFile(destination);
    await decryptStream(manifest, key, stream);
    console.log(`Archivo descifrado privado: ${destination}\nContiene datos sensibles. Úsalo solo en una base vacía aislada y retíralo después de comprobar la recuperación.`);
  }
  key.fill(0);
  console.log("SHA-256, autenticación AES-GCM y lectura completa de esquema/datos correctos. No se modificó ninguna base.");
}

main().catch(reportError);
