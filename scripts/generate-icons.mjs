import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');
mkdirSync(iconsDir, { recursive: true });

const COLORS = {
  bg: [250, 249, 247],
  popupFill: [255, 255, 255],
  popupStroke: [232, 228, 223],
  lineMuted: [240, 236, 231],
  lineSoft: [232, 228, 223],
  accent: [196, 92, 38],
  dismiss: [40, 40, 40],
  white: [255, 255, 255]
};

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

function insideRoundedRect(x, y, left, top, width, height, radius) {
  if (x < left || x > left + width || y < top || y > top + height) return false;
  const r = Math.min(radius, width / 2, height / 2);
  const right = left + width;
  const bottom = top + height;

  if (x >= left + r && x <= right - r) return true;
  if (y >= top + r && y <= bottom - r) return true;

  const corners = [
    [left + r, top + r],
    [right - r, top + r],
    [left + r, bottom - r],
    [right - r, bottom - r]
  ];

  return corners.some(([cx, cy]) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  });
}

function insideCircle(x, y, cx, cy, radius) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function pickColor(size, x, y) {
  const popup = {
    left: size * 0.2,
    top: size * 0.24,
    width: size * 0.6,
    height: size * 0.38,
    radius: Math.max(2, size * 0.08)
  };

  const badge = {
    cx: size * 0.72,
    cy: size * 0.62,
    radius: size * 0.17
  };

  const line1 = {
    left: size * 0.27,
    top: size * 0.34,
    width: size * 0.28,
    height: Math.max(1, size * 0.05),
    radius: Math.max(1, size * 0.025)
  };

  const line2 = {
    left: size * 0.27,
    top: size * 0.44,
    width: size * 0.44,
    height: Math.max(1, size * 0.04),
    radius: Math.max(1, size * 0.02)
  };

  const line3 = {
    left: size * 0.27,
    top: size * 0.52,
    width: size * 0.34,
    height: Math.max(1, size * 0.04),
    radius: Math.max(1, size * 0.02)
  };

  const xStroke = Math.max(1.4, size * 0.045);
  const x1 = badge.cx - badge.radius * 0.42;
  const y1 = badge.cy - badge.radius * 0.42;
  const x2 = badge.cx + badge.radius * 0.42;
  const y2 = badge.cy + badge.radius * 0.42;

  if (distanceToSegment(x, y, x1, y1, x2, y2) <= xStroke) return COLORS.white;
  if (distanceToSegment(x, y, x2, y1, x1, y2) <= xStroke) return COLORS.white;
  if (insideCircle(x, y, badge.cx, badge.cy, badge.radius)) return COLORS.accent;

  if (insideRoundedRect(x, y, line1.left, line1.top, line1.width, line1.height, line1.radius)) {
    return COLORS.lineSoft;
  }
  if (insideRoundedRect(x, y, line2.left, line2.top, line2.width, line2.height, line2.radius)) {
    return COLORS.lineMuted;
  }
  if (insideRoundedRect(x, y, line3.left, line3.top, line3.width, line3.height, line3.radius)) {
    return COLORS.lineMuted;
  }

  const stroke = Math.max(1, Math.round(size * 0.03));
  const outer = insideRoundedRect(x, y, popup.left, popup.top, popup.width, popup.height, popup.radius);
  const inner = insideRoundedRect(
    x,
    y,
    popup.left + stroke,
    popup.top + stroke,
    popup.width - stroke * 2,
    popup.height - stroke * 2,
    Math.max(1, popup.radius - stroke)
  );

  if (outer && !inner) return COLORS.popupStroke;
  if (inner) return COLORS.popupFill;

  return COLORS.bg;
}

function writePng(path, size) {
  const raw = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pickColor(size, x, y);
      row.push(r, g, b);
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
