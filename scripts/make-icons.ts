/**
 * Rasterizes the app icon (same constellation motif as public/icon.svg) into the
 * PNGs the manifest and iOS need — no image tooling required, just node:zlib.
 *
 *   npx tsx scripts/make-icons.ts
 *
 * Outputs into public/: icon-192.png, icon-512.png (rounded, transparent corners),
 * icon-512-maskable.png and apple-touch-icon.png (full-bleed, OS applies the mask).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

type RGBA = [number, number, number, number];

const STARS: Array<{ x: number; y: number; r: number; color: RGBA; fillAlpha: number }> = [
  { x: 262, y: 170, r: 46, color: [34, 211, 238, 255], fillAlpha: 0.16 },
  { x: 156, y: 330, r: 34, color: [139, 92, 246, 255], fillAlpha: 0.18 },
  { x: 372, y: 296, r: 40, color: [232, 121, 249, 255], fillAlpha: 0.15 },
];
const EDGES: Array<[number, number]> = [
  [1, 0],
  [0, 2],
  [1, 2],
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
// 1 inside the shape, 0 outside, ~1px antialiased edge (d = signed distance)
const coverage = (d: number) => clamp01(0.5 - d);

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function roundedRectDist(px: number, py: number, size: number, radius: number): number {
  const half = size / 2;
  const qx = Math.abs(px - half) - (half - radius);
  const qy = Math.abs(py - half) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function over(dst: RGBA, src: RGBA, srcAlpha: number): void {
  const a = clamp01(srcAlpha * (src[3] / 255));
  dst[0] = src[0] * a + dst[0] * (1 - a);
  dst[1] = src[1] * a + dst[1] * (1 - a);
  dst[2] = src[2] * a + dst[2] * (1 - a);
  dst[3] = Math.min(255, 255 * a + dst[3] * (1 - a));
}

function render(size: number, opts: { rounded: boolean; opaque: boolean; safeZoneScale: number }): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const s = (size / 512) * opts.safeZoneScale; // design-space → pixel-space
  const off = (512 * (size / 512) * (1 - opts.safeZoneScale)) / 2;
  const X = (v: number) => v * s + off;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // background: subtle radial lift toward the top-center, deep-space base
      const gd = clamp01(Math.hypot(x - size / 2, y - size * 0.35) / (size * 0.8));
      const c: RGBA = [
        0x11 + (0x0a - 0x11) * gd,
        0x18 + (0x0e - 0x18) * gd,
        0x2c + (0x1a - 0x2c) * gd,
        255,
      ];

      for (const [ai, bi] of EDGES) {
        const d = segDist(x, y, X(STARS[ai].x), X(STARS[ai].y), X(STARS[bi].x), X(STARS[bi].y));
        over(c, [148, 163, 184, 255], 0.35 * coverage(d - 2.5 * s));
      }

      for (const star of STARS) {
        const d = Math.hypot(x - X(star.x), y - X(star.y));
        const ringDist = Math.abs(d - star.r * s);
        // soft glow around the ring, then translucent fill, then the stroke itself
        over(c, star.color, 0.35 * Math.exp(-(ringDist * ringDist) / (2 * (9 * s) ** 2)));
        over(c, star.color, star.fillAlpha * coverage(d - star.r * s));
        over(c, star.color, coverage(ringDist - 3.5 * s));
      }

      const i = (y * size + x) * 4;
      let alpha = 255;
      if (opts.rounded) alpha = 255 * coverage(roundedRectDist(x, y, size, size * (104 / 512)));
      else if (!opts.opaque) alpha = 255;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = alpha;
    }
  }
  return px;
}

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head));
  return Buffer.concat([len, head, crc]);
}

function encodePng(pixels: Buffer, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.resolve(import.meta.dirname, '../public');
const targets = [
  { file: 'icon-192.png', size: 192, rounded: true, opaque: false, safeZoneScale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, opaque: false, safeZoneScale: 1 },
  { file: 'icon-512-maskable.png', size: 512, rounded: false, opaque: true, safeZoneScale: 0.78 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, opaque: true, safeZoneScale: 0.88 },
];
for (const t of targets) {
  writeFileSync(path.join(outDir, t.file), encodePng(render(t.size, t), t.size));
  console.log(`✓ public/${t.file}`);
}
