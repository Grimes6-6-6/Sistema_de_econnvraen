import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile(new URL("../public/econnvrae-logo.png", import.meta.url));
// The wordmark is horizontal; use its first letter at browser-tab sizes.
const letter = await sharp(source)
  .extract({ left: 72, top: 236, width: 255, height: 248 })
  .png()
  .toBuffer();
const logo = await sharp(letter).trim().png().toBuffer();
const renderLogo = (size) => sharp(logo).resize(size, size, {
  fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 },
}).ensureAlpha().png().toBuffer();
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(renderLogo));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([header, ...images]));
await writeFile(new URL("../src/app/icon.png", import.meta.url), await renderLogo(256));
await writeFile(new URL("../src/app/apple-icon.png", import.meta.url), await renderLogo(180));
console.log("Generated browser and mobile icons from the official ECONNVRAE logo.");
