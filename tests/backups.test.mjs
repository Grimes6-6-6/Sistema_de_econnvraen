import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";
import { encryptStream, decryptStream, checksum, readManifest, directConnection, externalPath } from "../scripts/backup-utils.mjs";

test("respaldo cifrado: roundtrip, corrupción, clave errónea y ruta segura", async () => {
  const dir = await mkdtemp(join(tmpdir(), "econnvrae-backup-test-"));
  try {
    const key = randomBytes(32);
    const plaintext = Buffer.from("Datos sintéticos para ensayo. No contiene usuarios reales.");
    const archive = "econnvrae-test.dump.enc";
    const path = join(dir, archive);
    const encrypted = await encryptStream(Readable.from([plaintext]), path, key);
    assert.notDeepEqual(await readFile(path), plaintext);
    const metadata = { version: 1, algorithm: "aes-256-gcm", archive, bytes: (await readFile(path)).length, sha256: await checksum(path), ...encrypted };
    const manifestPath = join(dir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(metadata));
    const manifest = await readManifest(manifestPath);
    const output = [];
    await decryptStream(manifest, key, new Writable({ write(chunk, _encoding, done) { output.push(chunk); done(); } }));
    assert.deepEqual(Buffer.concat(output), plaintext);
    await assert.rejects(decryptStream(manifest, randomBytes(32), new Writable({ write(_chunk, _encoding, done) { done(); } })), /autenticar/);
    await writeFile(path, Buffer.alloc(metadata.bytes));
    await assert.rejects(readManifest(manifestPath), /SHA-256/);
    await writeFile(manifestPath, JSON.stringify({ ...metadata, archive: "../escape.dump.enc" }));
    await assert.rejects(readManifest(manifestPath), /no es válido/);
    await assert.rejects(externalPath(process.cwd()), /fuera del repositorio/);
  } finally {
    assert.ok(basename(dir).startsWith("econnvrae-backup-test-"));
    await rm(dir, { recursive: true });
  }
});

test("conexión directa de Neon y rechazo de URLs inválidas", () => {
  const url = directConnection("postgresql://example:fake@ep-test-pooler.example.neon.tech/neondb");
  assert.equal(url.hostname, "ep-test.example.neon.tech");
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.throws(() => directConnection("https://example.com"));
});
