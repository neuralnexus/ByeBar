import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');
mkdirSync(iconsDir, { recursive: true });

function chunk(tag, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const type = Buffer.from(tag);
  const crc = crc32(Buffer.concat([type, payload]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([length, type, payload, crcBuf]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writePng(path, size) {
  const raw = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const bar = y > size * 0.62 && y < size * 0.82;
      const pad = Math.max(8, Math.floor(size / 8));
      const xmark =
        (Math.abs(x - y) < Math.max(2, size / 32) &&
          x > pad &&
          x < size - pad &&
          y > pad &&
          y < size - pad) ||
        (Math.abs(size - 1 - x - y) < Math.max(2, size / 32) &&
          x > pad &&
          x < size - pad &&
          y > pad &&
          y < size - pad);
      if (xmark) row.push(40, 40, 40);
      else if (bar) row.push(196, 92, 38);
      else row.push(250, 249, 247);
    }
    raw.push(Buffer.from(row));
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(raw), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);

  writeFileSync(path, png);
}

for (const size of [48, 96, 128, 256, 512]) {
  writePng(join(iconsDir, `icon-${size}.png`), size);
}

console.log('icons generated');
