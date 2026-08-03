import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildValidatedDirectory, buildValidatedFile } from '../scripts/artifact-output.mjs';

const roots = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'byebar-artifact-test-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('validated artifact publication', () => {
  it('removes stale output before a build starts and leaves none after failure', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    writeFileSync(finalPath, 'old artifact');
    writeFileSync(`${finalPath}.sha256`, 'old checksum');

    await expect(
      buildValidatedFile(finalPath, {
        build: async () => {
          expect(existsSync(finalPath)).toBe(false);
          expect(existsSync(`${finalPath}.sha256`)).toBe(false);
          throw new Error('build failed');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('build failed');

    expect(existsSync(finalPath)).toBe(false);
    expect(existsSync(`${finalPath}.sha256`)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it('does not publish a candidate that fails validation', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => writeFileSync(candidatePath, 'invalid'),
        validate: async () => {
          throw new Error('validation failed');
        }
      })
    ).rejects.toThrow('validation failed');

    expect(readdirSync(root)).toEqual([]);
  });

  it('publishes matching bytes and checksum without temporary residue', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const bytes = Buffer.from('validated package');
    const expectedHash = createHash('sha256').update(bytes).digest('hex');

    const result = await buildValidatedFile(finalPath, {
      build: async (candidatePath) => writeFileSync(candidatePath, bytes),
      validate: async (candidatePath) => expect(readFileSync(candidatePath)).toEqual(bytes)
    });

    expect(result.sha256).toBe(expectedHash);
    expect(readFileSync(finalPath)).toEqual(bytes);
    expect(readFileSync(`${finalPath}.sha256`, 'utf8')).toBe(`${expectedHash}  package.zip\n`);
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('rolls back the checksum if the artifact commit rename fails', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const destinations = [];

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => writeFileSync(candidatePath, 'validated'),
        validate: async () => {},
        renameFile(source, destination) {
          destinations.push(destination);
          if (destination === finalPath) throw new Error('rename failed');
          renameSync(source, destination);
        }
      })
    ).rejects.toThrow('rename failed');

    expect(destinations).toEqual([`${finalPath}.sha256`, finalPath]);
    expect(existsSync(finalPath)).toBe(false);
    expect(existsSync(`${finalPath}.sha256`)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('validated stage publication', () => {
  it('does not retain a stale or partial stage after validation failure', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    mkdirSync(finalDirectory);
    writeFileSync(join(finalDirectory, 'old.js'), 'old');

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async (candidateDirectory) => {
          mkdirSync(candidateDirectory);
          writeFileSync(join(candidateDirectory, 'partial.js'), 'partial');
        },
        validate: async () => {
          throw new Error('stage invalid');
        }
      })
    ).rejects.toThrow('stage invalid');

    expect(existsSync(finalDirectory)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it('promotes a complete validated stage', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');

    await buildValidatedDirectory(finalDirectory, {
      build: async (candidateDirectory) => {
        mkdirSync(candidateDirectory);
        writeFileSync(join(candidateDirectory, 'manifest.json'), '{}');
      },
      validate: async (candidateDirectory) => {
        expect(readFileSync(join(candidateDirectory, 'manifest.json'), 'utf8')).toBe('{}');
      }
    });

    expect(readdirSync(finalDirectory)).toEqual(['manifest.json']);
    expect(readdirSync(root)).toEqual(['chrome']);
  });
});
