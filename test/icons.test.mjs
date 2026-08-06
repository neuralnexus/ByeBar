import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const brandSizes = [16, 32, 48, 64, 96, 128, 256, 512, 1024];
const toolbarSizes = [16, 24, 32, 48, 64];

describe('generated brand assets', () => {
  it('provides square PNGs at every extension brand size', async () => {
    for (const size of brandSizes) {
      const bytes = readFileSync(new URL(`icons/icon-${size}.png`, root));
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({ format: 'png', width: size, height: size });
    }
  });

  it('provides a dedicated square PNG at every toolbar size', async () => {
    for (const size of toolbarSizes) {
      const bytes = readFileSync(new URL(`icons/toolbar-${size}.png`, root));
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
