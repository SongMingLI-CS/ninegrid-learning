import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const assets = path.join(root, 'desktop', 'assets');
const source = path.join(assets, 'ninegrid-icon-source.png');
const pngOutput = path.join(assets, 'ninegrid.png');
const icoOutput = path.join(assets, 'ninegrid.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

await mkdir(assets, { recursive: true });
const pngs = await Promise.all(sizes.map(size => sharp(source)
  .resize(size, size, { fit: 'cover' })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer()));
await sharp(source).resize(256, 256, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(pngOutput);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const entryBytes = sizes.length * 16;
let offset = 6 + entryBytes;
const entries = pngs.map((png, index) => {
  const entry = Buffer.alloc(16);
  const size = sizes[index];
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
await writeFile(icoOutput, Buffer.concat([header, ...entries, ...pngs]));
const icon = await readFile(icoOutput);
if (icon.readUInt16LE(2) !== 1 || icon.readUInt16LE(4) !== sizes.length) throw new Error('Generated icon container is invalid.');
console.log(`Generated NineGrid Windows icon with ${sizes.length} embedded sizes.`);
