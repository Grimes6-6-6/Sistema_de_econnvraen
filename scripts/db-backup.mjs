import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { BackupError, externalPath, initializeKey, loadKey, pgTool, directConnection, connectionEnvironment, childProcess, encryptStream, checksum, readManifest, verifyArchive, restrictFile, isWithin, reportError } from "./backup-utils.mjs";

async function main() {
  const { values } = parseArgs({ options: { "output-dir": { type: "string" }, "key-file": { type: "string" }, "init-key": { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) {
    console.log("Crear clave: node scripts/db-backup.mjs --init-key --key-file <ruta-absoluta-privada>\nRespaldar: node scripts/db-backup.mjs --output-dir <carpeta-externa> --key-file <ruta-clave>\nConexión: BACKUP_DATABASE_URL, DATABASE_URL_UNPOOLED o DATABASE_URL del entorno (no se cargan .env locales).\nHerramientas: PG_BIN_DIR opcional. Ver docs/backups.md.");
    return;
  }
  if (values["init-key"]) {
    const path = await initializeKey(values["key-file"]);
    console.log(`Clave creada con acceso restringido: ${path}\nGuarda una copia privada separada de los respaldos. Perder la clave impide recuperarlos.`);
    return;
  }
  const outputDir = await externalPath(values["output-dir"]);
  if (values["key-file"] && isWithin(outputDir, await externalPath(values["key-file"]))) {
    throw new BackupError("Guarda la clave en otra carpeta, separada de los respaldos.");
  }
  const key = await loadKey(values["key-file"]);
  const connection = directConnection(process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
  const [dump, restore] = await Promise.all([pgTool("pg_dump"), pgTool("pg_restore")]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `econnvrae-${stamp}-${randomUUID().slice(0, 8)}`;
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const directory = join(await externalPath(outputDir), name);
  await mkdir(directory, { mode: 0o700 });
  await restrictFile(directory, true);
  const archive = `${name}.dump.enc`;
  const partial = join(directory, `${archive}.partial`);
  const archivePath = join(directory, archive);
  const credentials = await connectionEnvironment(connection);
  let encryption;
  try {
    const { child, completed } = childProcess(dump, ["--format=custom", "--no-owner", "--no-acl", "--no-password", "--lock-wait-timeout=15000"], credentials.env);
    child.stdin.end();
    try {
      [, encryption] = await Promise.all([completed, encryptStream(child.stdout, partial, key)]);
    } catch (error) {
      child.kill();
      throw error;
    }
  } finally {
    await credentials.cleanup();
  }
  await rename(partial, archivePath);
  const manifest = { version: 1, algorithm: "aes-256-gcm", createdAt: new Date().toISOString(), archive, bytes: (await stat(archivePath)).size, sha256: await checksum(archivePath), ...encryption, pgDump: dump.version };
  const pendingManifest = join(directory, "manifest.json.partial");
  await writeFile(pendingManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await verifyArchive(await readManifest(pendingManifest), key, restore);
  const manifestPath = join(dirname(pendingManifest), "manifest.json");
  await rename(pendingManifest, manifestPath);
  key.fill(0);
  console.log(`Respaldo cifrado y verificado: ${manifestPath}\nTamaño cifrado: ${manifest.bytes} bytes. SHA-256 y lectura completa PostgreSQL correctos.\nLa prueba de restauración en una base aislada sigue siendo necesaria periódicamente.`);
}

main().catch(reportError);
