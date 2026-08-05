import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANONICAL_FILE_MODE,
  CANONICAL_ZIP_DATE,
  createDeterministicZip
} from '../scripts/deterministic-zip.mjs';
import { listRegularFiles, validatePackage } from '../scripts/validate-package.mjs';

const roots = [];

function createStage() {
  const root = mkdtempSync(join(tmpdir(), 'byebar-package-test-'));
  roots.push(root);
  const stage = join(root, 'stage');
  mkdirSync(join(stage, 'content'), { recursive: true });
  writeFileSync(join(stage, 'manifest.json'), '{"manifest_version":3}\n');
  writeFileSync(join(stage, 'content', 'main.js'), 'console.log("ByeBar");\n');
  writeFileSync(join(stage, 'empty.txt'), '');
  return { root, stage };
}

async function createCustomZip(stage, options = {}) {
  const zip = new JSZip();
  const files = options.reverse ? listRegularFiles(stage).reverse() : listRegularFiles(stage);
  for (const file of files) {
    zip.file(file, readFileSync(join(stage, file)), {
      createFolders: options.createFolders ?? false,
      date: options.date || CANONICAL_ZIP_DATE,
      unixPermissions: options.mode || CANONICAL_FILE_MODE
    });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false
  });
}

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('deterministic extension packages', () => {
  it('produces identical canonical bytes and validates their content', async () => {
    const { root, stage } = createStage();
    const first = await createDeterministicZip(stage);
    const second = await createDeterministicZip(stage);
    expect(second).toEqual(first);

    const archivePath = join(root, 'package.zip');
    writeFileSync(archivePath, first);
    const expectedHash = createHash('sha256').update(first).digest('hex');
    await expect(validatePackage(archivePath, stage)).resolves.toBe(expectedHash);

    const zip = await JSZip.loadAsync(first, { createFolders: false });
    expect(Object.keys(zip.files)).toEqual(['content/main.js', 'empty.txt', 'manifest.json']);
  });

  it('rejects noncanonical bytes even when content and primary metadata still match', async () => {
    const { root, stage } = createStage();
    const archive = await createDeterministicZip(stage);
    const centralHeader = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt16LE(1, centralHeader + 36);
    const archivePath = join(root, 'package.zip');
    writeFileSync(archivePath, archive);

    await expect(validatePackage(archivePath, stage)).rejects.toThrow('archive bytes are not canonical');
  });

  it.each([
    {
      label: 'entry order',
      options: { reverse: true },
      error: 'exact sorted extension file set'
    },
    {
      label: 'timestamp',
      options: { date: new Date('2026-01-01T00:00:00.000Z') },
      error: 'timestamp is not canonical'
    },
    {
      label: 'file mode',
      options: { mode: 0o100777 },
      error: 'file mode is not canonical'
    },
    {
      label: 'directory entries',
      options: { createFolders: true },
      error: 'exact sorted extension file set'
    }
  ])('rejects noncanonical $label metadata', async ({ options, error }) => {
    const { root, stage } = createStage();
    const archivePath = join(root, 'package.zip');
    writeFileSync(archivePath, await createCustomZip(stage, options));
    await expect(validatePackage(archivePath, stage)).rejects.toThrow(error);
  });
});
