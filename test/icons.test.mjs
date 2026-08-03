import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

describe('generated brand assets', () => {
  it('provides square PNGs at every extension and toolbar size', async () => {
    for (const size of sizes) {
      const bytes = readFileSync(new URL(`icons/icon-${size}.png`, root));
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({ format: 'png', width: size, height: size });
    }
  });

  it('keeps website assets byte-identical to the canonical brand', () => {
    expect(readFileSync(new URL('docs/logo.svg', root))).toEqual(
      readFileSync(new URL('icons/logo.svg', root))
    );
    expect(readFileSync(new URL('docs/icon-128.png', root))).toEqual(
      readFileSync(new URL('icons/icon-128.png', root))
    );
  });
});
