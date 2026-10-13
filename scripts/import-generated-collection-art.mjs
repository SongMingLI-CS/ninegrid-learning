import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [sourceArg, itemId] = process.argv.slice(2);
if (!sourceArg || !/^[a-z0-9-]+$/.test(itemId ?? '')) throw new Error('Usage: node scripts/import-generated-collection-art.mjs <source.png> <item-id>');
const source = resolve(sourceArg);
const detail = resolve(`public/assets/catalog/items/${itemId}.webp`);
const thumbnail = resolve(`public/assets/catalog/thumbs/${itemId}.webp`);
await mkdir(dirname(detail), { recursive: true });
await mkdir(dirname(thumbnail), { recursive: true });
await sharp(source).resize(768, 768, { fit: 'cover', position: 'attention' }).webp({ quality: 82, effort: 6 }).toFile(detail);
await sharp(source).resize(220, 220, { fit: 'cover', position: 'attention' }).webp({ quality: 72, effort: 6 }).toFile(thumbnail);
const [detailInfo, thumbInfo] = await Promise.all([sharp(detail).metadata(), sharp(thumbnail).metadata()]);
console.log(JSON.stringify({ itemId, detail: detailInfo, thumbnail: thumbInfo }));
