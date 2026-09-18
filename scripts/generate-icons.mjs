// Renders public/icons/icon.svg into the PNG sizes required by the web app manifest.
// Run with `npm run icons`. Requires `sharp` (devDependency).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');
const svg = readFileSync(svgPath);

// Maskable icons must keep visual content inside the ~80% "safe zone" circle.
// Our source SVG art already sits within that safe zone, so plain and
// maskable variants can share the same render; the maskable one additionally
// gets an opaque background (already provided by the rounded rect).
const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-512-maskable.png', size: 512 },
];

for (const { file, size } of targets) {
  const buffer = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync(path.join(iconsDir, file), buffer);
  console.log(`generated ${file} (${size}x${size})`);
}
