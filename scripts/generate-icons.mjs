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

// Solid fallback matching the SVG's gradient, used as the maskable icon's
// full-bleed background (must not be transparent).
const MASKABLE_BACKGROUND = '#6366f1';
// Maskable icons get cropped to arbitrary shapes (circle, squircle, ...) by the
// OS, so content must stay inside a centered ~80% "safe zone". We render the
// artwork smaller and pad it onto a full-size canvas, rather than reusing the
// plain icon's edge-to-edge render, so the maskable PNG is genuinely padded
// (and visibly different from icon-512.png, not just a copy of it).
const MASKABLE_SIZE = 512;
const MASKABLE_CONTENT_SIZE = Math.round(MASKABLE_SIZE * 0.8);
const MASKABLE_PADDING = Math.floor((MASKABLE_SIZE - MASKABLE_CONTENT_SIZE) / 2);

const plainTargets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
];

for (const { file, size } of plainTargets) {
  const buffer = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync(path.join(iconsDir, file), buffer);
  console.log(`generated ${file} (${size}x${size})`);
}

const maskableContent = await sharp(svg, { density: 384 })
  .resize(MASKABLE_CONTENT_SIZE, MASKABLE_CONTENT_SIZE)
  .png()
  .toBuffer();

const maskableBuffer = await sharp({
  create: {
    width: MASKABLE_SIZE,
    height: MASKABLE_SIZE,
    channels: 4,
    background: MASKABLE_BACKGROUND,
  },
})
  .composite([{ input: maskableContent, left: MASKABLE_PADDING, top: MASKABLE_PADDING }])
  .png()
  .toBuffer();

writeFileSync(path.join(iconsDir, 'icon-512-maskable.png'), maskableBuffer);
console.log(
  `generated icon-512-maskable.png (${MASKABLE_SIZE}x${MASKABLE_SIZE}, content padded to ${MASKABLE_CONTENT_SIZE}x${MASKABLE_CONTENT_SIZE})`
);
