import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, stat, unlink, rmdir, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const aad = Buffer.from("ECONNVRAE-BACKUP-V1");

export class BackupError extends Error {}

export function isWithin(parent, child) {
  const segment = relative(parent, child);
  return segment === "" || (!segment.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && segment !== ".." && !isAbsolute(segment));
}

export async function externalPath(value) {
  if (!value || !isAbsolute(value)) throw new BackupError("Usa una ruta absoluta fuera del repositorio.");
  const target = resolve(value);
  let ancestor = target;
  while (true) {
    try {
      const canonical = await realpath(ancestor);
      const effective = resolve(canonical, relative(ancestor, target));
      if (isWithin(await realpath(projectRoot), effective)) {
        throw new BackupError("Los respaldos y las claves deben quedar fuera del repositorio.");
      }
      return effective;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const next = dirname(ancestor);
      if (next === ancestor) throw new BackupError("No se pudo resolver la carpeta de destino.");
      ancestor = next;
    }
  }
}

export async function restrictFile(path, directory = false) {
  if (process.platform !== "win32") {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  const identity = spawnSync("whoami.exe", [], { encoding: "utf8", windowsHide: true });
  if (identity.status !== 0 || !identity.stdout.trim()) throw new BackupError("No se pudo determinar el propietario del respaldo.");
  const acl = spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${identity.stdout.trim()}:${directory ? "(OI)(CI)" : ""}F`], { encoding: "utf8", windowsHide: true });
  if (acl.status !== 0) throw new BackupError("No se pudieron restringir los permisos del archivo privado.");
}

export async function initializeKey(value) {
  const path = await externalPath(value);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
  await restrictFile(path);
  return path;
}

export async function loadKey(value) {
  let encoded = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (value) {
    const path = await externalPath(value);
    if ((await stat(path)).size > 128) throw new BackupError("El archivo de clave no es válido.");
    encoded = (await readFile(path, "utf8")).trim();
  }
  if (!encoded || !/^[a-f0-9]{64}$/i.test(encoded)) {
    throw new BackupError("Configura una clave de 32 bytes en hexadecimal mediante --key-file o BACKUP_ENCRYPTION_KEY.");
  }
  return Buffer.from(encoded, "hex");
}

export async function pgTool(name) {
  const executable = `${name}${process.platform === "win32" ? ".exe" : ""}`;
  const candidates = process.env.PG_BIN_DIR ? [join(process.env.PG_BIN_DIR, executable)] : [executable];
  if (!process.env.PG_BIN_DIR && process.platform === "win32") {
    const installRoot = join(process.env.ProgramFiles || "C:/Program Files", "PostgreSQL");
    const versions = await readdir(installRoot).catch(() => []);
    for (const version of versions.sort((a, b) => Number(b) - Number(a))) candidates.push(join(installRoot, version, "bin", executable));
  }
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0 && /PostgreSQL/.test(result.stdout)) return { path: candidate, version: result.stdout.trim() };
  }
  throw new BackupError(`No se encontró ${name}. Instala las herramientas PostgreSQL o define PG_BIN_DIR.`);
}

export function directConnection(value) {
  let url;
  try { url = new URL(value); } catch { throw new BackupError("Configura BACKUP_DATABASE_URL o DATABASE_URL con la conexión PostgreSQL de origen."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) {
    throw new BackupError("La conexión de origen no es una URL PostgreSQL válida.");
  }
  if (url.hostname.endsWith(".neon.tech")) {
    url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
    if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  }
  return url;
}

export async function connectionEnvironment(url) {
  const secretDir = await mkdtemp(join(tmpdir(), "econnvrae-pgpass-"));
  await restrictFile(secretDir, true);
  const passfile = join(secretDir, "pgpass");
  const escape = (value) => value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  const fields = [url.hostname, url.port || "5432", decodeURIComponent(url.pathname.slice(1)), decodeURIComponent(url.username), decodeURIComponent(url.password)];
  if (fields.some((value) => /[\r\n]/.test(value))) throw new BackupError("La conexión contiene caracteres no admitidos.");
  await writeFile(passfile, `${fields.map(escape).join(":")}\n`, { flag: "wx", mode: 0o600 });
  const connection = new URL(url);
  connection.password = "";
  const env = { ...process.env, PGDATABASE: connection.toString(), PGPASSFILE: passfile, PGCONNECT_TIMEOUT: "15", PGAPPNAME: "econnvrae-backup" };
  for (const key of ["PGPASSWORD", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "BACKUP_DATABASE_URL", "BACKUP_ENCRYPTION_KEY"]) delete env[key];
  return {
    env,
    async cleanup() {
      await unlink(passfile);
      await rmdir(secretDir);
    },
  };
}

export function childProcess(tool, args, env = process.env) {
  const child = spawn(tool.path, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new BackupError("La operación PostgreSQL excedió 15 minutos.")); }, 15 * 60_000);
    child.once("error", () => { clearTimeout(timer); reject(new BackupError("No se pudo iniciar la herramienta PostgreSQL.")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new BackupError("PostgreSQL no completó la operación. Revisa versión del cliente, permisos de lectura, conexión directa y conectividad; los detalles sensibles no se imprimen."));
    });
  });
  return { child, completed };
}

export async function encryptStream(source, destination, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  await pipeline(source, cipher, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  return { nonce: nonce.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}

export async function checksum(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

export async function readManifest(path) {
  if ((await stat(path)).size > 16_384) throw new BackupError("El manifiesto supera el tamaño permitido.");
  const data = JSON.parse(await readFile(path, "utf8"));
  if (data.version !== 1 || data.algorithm !== "aes-256-gcm" || typeof data.archive !== "string" || basename(data.archive) !== data.archive || !/^econnvrae-[a-zA-Z0-9-]+\.dump\.enc$/.test(data.archive) || !/^[a-f0-9]{64}$/.test(data.sha256) || !/^[a-f0-9]{24}$/.test(data.nonce) || !/^[a-f0-9]{32}$/.test(data.tag) || !Number.isSafeInteger(data.bytes) || data.bytes <= 0) {
    throw new BackupError("El manifiesto del respaldo no es válido.");
  }
  const archivePath = join(dirname(path), data.archive);
  if ((await stat(archivePath)).size !== data.bytes || await checksum(archivePath) !== data.sha256) {
    throw new BackupError("El respaldo está incompleto o su SHA-256 no coincide.");
  }
  return { ...data, archivePath };
}

export async function decryptStream(manifest, key, destination) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(manifest.nonce, "hex"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(manifest.tag, "hex"));
  try {
    await pipeline(createReadStream(manifest.archivePath), decipher, destination);
  } catch {
    throw new BackupError("No se pudo autenticar o leer el respaldo. Revisa la clave, el archivo y su manifiesto.");
  }
}

export async function verifyArchive(manifest, key, tool) {
  // Authenticate the entire encrypted file before feeding any bytes to pg_restore.
  await decryptStream(manifest, key, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  const { child, completed } = childProcess(tool, ["--format=custom", "--file=-", "--no-owner", "--no-acl"]);
  child.stdout.resume();
  try {
    await Promise.all([completed, decryptStream(manifest, key, child.stdin)]);
  } catch (error) {
    child.kill();
    throw error;
  }
}

export function reportError(error) {
  if (error instanceof BackupError) console.error(error.message);
  else if (error.code === "EEXIST") console.error("El destino ya existe. No se sobrescribió ningún archivo.");
  else if (["ENOENT", "EACCES", "EPERM"].includes(error.code)) console.error("No se pudo acceder a la ruta. Verifica su existencia y permisos.");
  else console.error("No se completó el respaldo o su verificación. No uses archivos parciales.");
  process.exitCode = 1;
}
