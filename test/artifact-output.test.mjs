import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { hostname, platform, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildValidatedDirectory,
  buildValidatedFile,
  hashDirectoryTree
} from '../scripts/artifact-output.mjs';

const roots = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'byebar-artifact-test-'));
  roots.push(root);
  return root;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeArtifactGeneration(finalPath, bytes) {
  const buffer = Buffer.from(bytes);
  const hash = sha256(buffer);
  writeFileSync(finalPath, buffer);
  writeFileSync(`${finalPath}.sha256`, `${hash}  ${basename(finalPath)}\n`);
  return hash;
}

function expectArtifactGeneration(finalPath, bytes) {
  const buffer = Buffer.from(bytes);
  expect(readFileSync(finalPath)).toEqual(buffer);
  expect(readFileSync(`${finalPath}.sha256`, 'utf8')).toBe(`${sha256(buffer)}  ${basename(finalPath)}\n`);
}

function writeStageGeneration(directory, payload) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'generation.txt'), payload);
  return hashDirectoryTree(directory);
}

function writePublicationJournal(transaction, targetName, state) {
  writeFileSync(
    join(transaction, 'state.json'),
    `${JSON.stringify({
      version: 2,
      targetName,
      lockToken: '00000000-0000-0000-0000-000000000001',
      lockTicket: 1,
      ...state
    })}\n`
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function lockClaimPath(finalPath, token) {
  return join(dirname(finalPath), `.${basename(finalPath)}.lock-claim-${token}`);
}

function publicationPreparationPath(finalPath, token) {
  return join(dirname(finalPath), `.${basename(finalPath)}.publish-prepare-${token}`);
}

function writeLockClaim(
  finalPath,
  { token, version = 2, pid = process.pid, processIdentity, ticket = 1, ageMs = 0 }
) {
  const claim = lockClaimPath(finalPath, token);
  mkdirSync(claim);
  const owner = { version, pid, hostname: hostname(), token };
  if (processIdentity !== undefined) owner.processIdentity = processIdentity;
  writeFileSync(join(claim, 'owner.json'), `${JSON.stringify(owner)}\n`);
  writeFileSync(join(claim, 'lease'), `${token}\n`);
  if (ticket !== null) {
    writeFileSync(join(claim, 'ticket.json'), `${JSON.stringify({ ticket, token })}\n`);
  }
  if (ageMs > 0) {
    const staleTime = new Date(Date.now() - ageMs);
    utimesSync(join(claim, 'lease'), staleTime, staleTime);
  }
  return claim;
}

function runPublisher(finalPath, payload, eventsPath) {
  const moduleUrl = new URL('../scripts/artifact-output.mjs', import.meta.url).href;
  const source = `
    import { appendFileSync, writeFileSync } from 'node:fs';
    import { buildValidatedFile } from ${JSON.stringify(moduleUrl)};
    await buildValidatedFile(process.env.FINAL_PATH, {
      lock: { timeoutMs: 3000, pollMs: 2, staleMs: 1000 },
      build: async (candidatePath) => {
        appendFileSync(process.env.EVENTS_PATH, process.env.PAYLOAD + ':start\\n');
        writeFileSync(candidatePath, process.env.PAYLOAD);
        await new Promise((resolve) => setTimeout(resolve, 80));
        appendFileSync(process.env.EVENTS_PATH, process.env.PAYLOAD + ':end\\n');
      },
      validate: async () => {}
    });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: {
        ...process.env,
        EVENTS_PATH: eventsPath,
        FINAL_PATH: finalPath,
        PAYLOAD: payload
      },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`publisher exited ${code}: ${stderr}`));
    });
  });
}

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('validated artifact publication', () => {
  it('preserves a valid prior generation when the build fails', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    writeArtifactGeneration(finalPath, 'old artifact');

    await expect(
      buildValidatedFile(finalPath, {
        build: async () => {
          expectArtifactGeneration(finalPath, 'old artifact');
          throw new Error('build failed');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('build failed');

    expectArtifactGeneration(finalPath, 'old artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('preserves a valid prior generation when candidate validation fails', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    writeArtifactGeneration(finalPath, 'old artifact');

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => writeFileSync(candidatePath, 'invalid'),
        validate: async () => {
          expectArtifactGeneration(finalPath, 'old artifact');
          throw new Error('validation failed');
        }
      })
    ).rejects.toThrow('validation failed');

    expectArtifactGeneration(finalPath, 'old artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('publishes matching bytes and checksum without temporary residue', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const bytes = Buffer.from('validated package');
    const expectedHash = sha256(bytes);

    const previousUmask = process.umask(0o077);
    let result;
    try {
      result = await buildValidatedFile(finalPath, {
        build: async (candidatePath) => writeFileSync(candidatePath, bytes),
        validate: async (candidatePath) => expect(readFileSync(candidatePath)).toEqual(bytes)
      });
    } finally {
      process.umask(previousUmask);
    }

    expect(result.sha256).toBe(expectedHash);
    expectArtifactGeneration(finalPath, bytes);
    expect(statSync(finalPath).mode & 0o777).toBe(0o644);
    expect(statSync(`${finalPath}.sha256`).mode & 0o777).toBe(0o644);
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('durably creates each missing file output-parent ancestor', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'missing', 'nested', 'artifacts', 'package.zip');

    await buildValidatedFile(finalPath, {
      build: async (candidatePath) => writeFileSync(candidatePath, 'nested payload'),
      validate: async () => {}
    });

    expectArtifactGeneration(finalPath, 'nested payload');
    expect(statSync(join(root, 'missing')).isDirectory()).toBe(true);
    expect(statSync(join(root, 'missing', 'nested')).isDirectory()).toBe(true);
    expect(statSync(join(root, 'missing', 'nested', 'artifacts')).isDirectory()).toBe(true);
  });

  it.each(['file', 'symlink'])(
    'rejects a %s in the file output-parent ancestor chain',
    async (ancestorKind) => {
      const root = temporaryRoot();
      const ancestor = join(root, 'blocked');
      const external = join(root, 'external');
      if (ancestorKind === 'file') {
        writeFileSync(ancestor, 'not a directory');
      } else {
        mkdirSync(external);
        writeFileSync(join(external, 'sentinel.txt'), 'external target');
        symlinkSync(external, ancestor, 'dir');
      }

      await expect(
        buildValidatedFile(join(ancestor, 'nested', 'package.zip'), {
          build: async (candidatePath) => writeFileSync(candidatePath, 'unexpected'),
          validate: async () => {}
        })
      ).rejects.toThrow('output directory ancestor is not a regular directory');

      expect(existsSync(join(ancestor, 'nested'))).toBe(false);
      if (ancestorKind === 'symlink') {
        expect(readFileSync(join(external, 'sentinel.txt'), 'utf8')).toBe('external target');
        expect(readdirSync(external)).toEqual(['sentinel.txt']);
      }
    }
  );

  it('serializes concurrent writers and publishes one complete generation at a time', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const firstStarted = deferred();
    const releaseFirst = deferred();
    let secondStarted = false;
    const lock = { timeoutMs: 1000, pollMs: 5 };

    const first = buildValidatedFile(finalPath, {
      lock,
      build: async (candidatePath) => {
        writeFileSync(candidatePath, 'first payload');
        firstStarted.resolve();
        await releaseFirst.promise;
      },
      validate: async () => {}
    });
    await firstStarted.promise;

    const second = buildValidatedFile(finalPath, {
      lock,
      build: async (candidatePath) => {
        secondStarted = true;
        writeFileSync(candidatePath, 'second payload');
      },
      validate: async () => {}
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(secondStarted).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);

    expect(secondStarted).toBe(true);
    expectArtifactGeneration(finalPath, 'second payload');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('handles processes concurrently creating the same missing output parents', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'missing', 'nested', 'package.zip');
    const eventsPath = join(root, 'events.log');

    await Promise.all([
      runPublisher(finalPath, 'alpha payload', eventsPath),
      runPublisher(finalPath, 'beta payload', eventsPath)
    ]);

    const payload = readFileSync(finalPath, 'utf8');
    expect(['alpha payload', 'beta payload']).toContain(payload);
    expectArtifactGeneration(finalPath, payload);
  }, 10_000);

  it('rolls back the prior generation if the artifact publication rename fails', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    writeArtifactGeneration(finalPath, 'old artifact');

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => writeFileSync(candidatePath, 'new artifact'),
        validate: async () => {},
        renameFile(source, destination) {
          if (destination === finalPath && source.includes('.package.zip.build-')) {
            throw new Error('artifact rename failed');
          }
          renameSync(source, destination);
        }
      })
    ).rejects.toThrow('artifact rename failed');

    expectArtifactGeneration(finalPath, 'old artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('rolls back the prior generation if the checksum publication rename fails', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    writeArtifactGeneration(finalPath, 'old artifact');

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => writeFileSync(candidatePath, 'new artifact'),
        validate: async () => {},
        renameFile(source, destination) {
          if (destination === `${finalPath}.sha256` && source.includes('.package.zip.build-')) {
            throw new Error('checksum rename failed');
          }
          renameSync(source, destination);
        }
      })
    ).rejects.toThrow('checksum rename failed');

    expectArtifactGeneration(finalPath, 'old artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('never exposes a canonical file transaction when its initial directory rename fails', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const transaction = join(root, '.package.zip.publish');
    writeArtifactGeneration(finalPath, 'old artifact');
    let inspectedPreparation = false;

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => writeFileSync(candidatePath, 'new artifact'),
        validate: async () => {},
        renameTransaction(source, destination) {
          expect(source).toContain('.package.zip.publish-prepare-');
          expect(destination).toBe(transaction);
          expect(existsSync(transaction)).toBe(false);
          expect(readdirSync(source)).toEqual(['state.json']);
          expect(JSON.parse(readFileSync(join(source, 'state.json'), 'utf8'))).toMatchObject({
            kind: 'file',
            phase: 'prepared',
            hadPrevious: true
          });
          inspectedPreparation = true;
          throw new Error('initial transaction rename failed');
        }
      })
    ).rejects.toThrow('initial transaction rename failed');

    expect(inspectedPreparation).toBe(true);
    expectArtifactGeneration(finalPath, 'old artifact');
    expect(existsSync(transaction)).toBe(false);
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('cleans an interrupted file transaction preparation before building', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const preparation = publicationPreparationPath(finalPath, 'interrupted');
    const previousSha256 = writeArtifactGeneration(finalPath, 'old artifact');
    mkdirSync(preparation);
    writePublicationJournal(preparation, 'package.zip', {
      kind: 'file',
      phase: 'prepared',
      hadPrevious: true,
      previousSha256,
      newSha256: sha256('uncommitted artifact')
    });

    await expect(
      buildValidatedFile(finalPath, {
        build: async () => {
          expect(existsSync(preparation)).toBe(false);
          expectArtifactGeneration(finalPath, 'old artifact');
          throw new Error('stop after preparation cleanup');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after preparation cleanup');

    expectArtifactGeneration(finalPath, 'old artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('does not steal an active lock', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const first = buildValidatedFile(finalPath, {
      lock: { timeoutMs: 1000, pollMs: 5, staleMs: 200 },
      build: async (candidatePath) => {
        writeFileSync(candidatePath, 'first payload');
        firstStarted.resolve();
        await releaseFirst.promise;
      },
      validate: async () => {}
    });
    await firstStarted.promise;

    try {
      await expect(
        buildValidatedFile(finalPath, {
          lock: { timeoutMs: 450, pollMs: 5, staleMs: 200 },
          build: async (candidatePath) => writeFileSync(candidatePath, 'unexpected'),
          validate: async () => {}
        })
      ).rejects.toThrow('timed out waiting for artifact lock');
    } finally {
      releaseFirst.resolve();
    }
    await first;

    expectArtifactGeneration(finalPath, 'first payload');
  });

  it('recovers an interrupted publication before building', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const transaction = join(root, '.package.zip.publish');
    const oldBytes = Buffer.from('old artifact');
    const oldHash = sha256(oldBytes);
    const newBytes = Buffer.from('partial new artifact');

    mkdirSync(transaction);
    writeFileSync(join(transaction, 'previous-artifact'), oldBytes);
    writeFileSync(join(transaction, 'previous-checksum'), `${oldHash}  package.zip\n`);
    writePublicationJournal(transaction, 'package.zip', {
      kind: 'file',
      phase: 'prepared',
      hadPrevious: true,
      previousSha256: oldHash,
      newSha256: sha256(newBytes)
    });
    writeFileSync(finalPath, newBytes);

    await expect(
      buildValidatedFile(finalPath, {
        build: async () => {
          expectArtifactGeneration(finalPath, oldBytes);
          throw new Error('stop after recovery');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after recovery');

    expectArtifactGeneration(finalPath, oldBytes);
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('serializes two processes racing to reap the same stale claim', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const eventsPath = join(root, 'events.log');
    writeLockClaim(finalPath, { token: 'dead-owner', pid: 0x7fffffff, ageMs: 5000 });

    await Promise.all([
      runPublisher(finalPath, 'alpha payload', eventsPath),
      runPublisher(finalPath, 'beta payload', eventsPath)
    ]);

    const events = readFileSync(eventsPath, 'utf8').trim().split('\n');
    expect(events).toHaveLength(4);
    expect(events[0].endsWith(':start')).toBe(true);
    expect(events[1]).toBe(`${events[0].slice(0, -6)}:end`);
    expect(events[2].endsWith(':start')).toBe(true);
    expect(events[3]).toBe(`${events[2].slice(0, -6)}:end`);
    expect(events[0].slice(0, -6)).not.toBe(events[2].slice(0, -6));

    const finalPayload = readFileSync(finalPath, 'utf8');
    expect(['alpha payload', 'beta payload']).toContain(finalPayload);
    expectArtifactGeneration(finalPath, finalPayload);
    expect(readdirSync(root).sort()).toEqual(['events.log', 'package.zip', 'package.zip.sha256']);
  }, 10_000);

  it.each([
    ['regular file', 'file'],
    ['symlink to a file', 'symlink-file'],
    ['symlink to a directory', 'symlink-directory']
  ])('ages and detaches a malformed claim root that is a %s', async (_label, kind) => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const token = `malformed-${kind}`;
    const claim = lockClaimPath(finalPath, token);
    const target = join(root, `external-${kind}`);

    if (kind === 'file') {
      writeFileSync(claim, 'malformed claim');
    } else if (kind === 'symlink-file') {
      writeFileSync(target, 'external file');
      symlinkSync(target, claim, 'file');
    } else {
      mkdirSync(target);
      writeFileSync(join(target, 'sentinel.txt'), 'external directory');
      writeFileSync(
        join(target, 'owner.json'),
        `${JSON.stringify({ version: 2, pid: process.pid, hostname: hostname(), token })}\n`
      );
      writeFileSync(join(target, 'lease'), `${token}\n`);
      writeFileSync(join(target, 'ticket.json'), `${JSON.stringify({ ticket: 1, token })}\n`);
      symlinkSync(target, claim, 'dir');
    }
    await new Promise((resolve) => setTimeout(resolve, 40));

    await buildValidatedFile(finalPath, {
      lock: { timeoutMs: 1000, pollMs: 5, staleMs: 20 },
      build: async (candidatePath) => writeFileSync(candidatePath, 'new payload'),
      validate: async () => {}
    });

    expect(existsSync(claim)).toBe(false);
    expectArtifactGeneration(finalPath, 'new payload');
    if (kind === 'symlink-file') expect(readFileSync(target, 'utf8')).toBe('external file');
    if (kind === 'symlink-directory') {
      expect(readFileSync(join(target, 'sentinel.txt'), 'utf8')).toBe('external directory');
      expect(existsSync(join(target, 'owner.json'))).toBe(true);
      expect(existsSync(join(target, 'lease'))).toBe(true);
      expect(existsSync(join(target, 'ticket.json'))).toBe(true);
    }
  });

  it('keeps a fresh malformed claim root until the stale interval elapses', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const claim = lockClaimPath(finalPath, 'fresh-malformed-root');
    writeFileSync(claim, 'malformed claim');

    await expect(
      buildValidatedFile(finalPath, {
        lock: { timeoutMs: 30, pollMs: 5, staleMs: 1000 },
        build: async (candidatePath) => writeFileSync(candidatePath, 'unexpected'),
        validate: async () => {}
      })
    ).rejects.toThrow('timed out waiting for artifact lock');

    expect(existsSync(claim)).toBe(true);
    expect(existsSync(finalPath)).toBe(false);
  });

  it('treats a fresh future-version claim as live', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const futureClaim = writeLockClaim(finalPath, {
      token: 'future-owner',
      version: 99,
      ticket: null
    });

    await expect(
      buildValidatedFile(finalPath, {
        lock: { timeoutMs: 30, pollMs: 5, staleMs: 1000 },
        build: async (candidatePath) => writeFileSync(candidatePath, 'unexpected'),
        validate: async () => {}
      })
    ).rejects.toThrow('timed out waiting for artifact lock');

    expect(existsSync(futureClaim)).toBe(true);
    expect(existsSync(finalPath)).toBe(false);
  });

  it('does not expire an aged lease while its same-host owner is alive', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const liveClaim = writeLockClaim(finalPath, {
      token: 'paused-owner',
      pid: process.pid,
      ageMs: 1000
    });

    await expect(
      buildValidatedFile(finalPath, {
        lock: { timeoutMs: 30, pollMs: 5, staleMs: 20 },
        build: async (candidatePath) => writeFileSync(candidatePath, 'unexpected'),
        validate: async () => {}
      })
    ).rejects.toThrow('timed out waiting for artifact lock');

    expect(existsSync(liveClaim)).toBe(true);
    expect(existsSync(finalPath)).toBe(false);
  });

  it.runIf(['darwin', 'linux'].includes(platform()))(
    'reclaims an aged claim when a reused PID has different process identity',
    async () => {
      const root = temporaryRoot();
      const finalPath = join(root, 'package.zip');
      writeLockClaim(finalPath, {
        token: 'reused-pid-owner',
        pid: process.pid,
        processIdentity: `${platform()}:${'0'.repeat(64)}`,
        ageMs: 1000
      });

      await buildValidatedFile(finalPath, {
        lock: { timeoutMs: 500, pollMs: 5, staleMs: 20 },
        build: async (candidatePath) => writeFileSync(candidatePath, 'new payload'),
        validate: async () => {}
      });

      expectArtifactGeneration(finalPath, 'new payload');
      expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
    }
  );

  it('reclaims an aged claim only when its same-host owner is provably dead', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    writeLockClaim(finalPath, { token: 'dead-owner', pid: 0x7fffffff, ageMs: 1000 });

    await buildValidatedFile(finalPath, {
      lock: { timeoutMs: 500, pollMs: 5, staleMs: 20 },
      build: async (candidatePath) => writeFileSync(candidatePath, 'new payload'),
      validate: async () => {}
    });

    expectArtifactGeneration(finalPath, 'new payload');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('does not publish after its token-specific lease is removed', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    writeArtifactGeneration(finalPath, 'old artifact');

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => {
          writeFileSync(candidatePath, 'new artifact');
          const claim = readdirSync(root).find((entry) => entry.startsWith('.package.zip.lock-claim-'));
          rmSync(join(root, claim), { recursive: true, force: true });
        },
        validate: async () => {}
      })
    ).rejects.toThrow('artifact lock lease lost');

    expectArtifactGeneration(finalPath, 'old artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('cleans partially collected detached transactions without touching public output', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const garbage = join(root, '.package.zip.publish-gc-interrupted');
    writeArtifactGeneration(finalPath, 'current artifact');
    mkdirSync(garbage);
    writeFileSync(join(garbage, 'previous-artifact'), 'partially removed backup');

    await expect(
      buildValidatedFile(finalPath, {
        build: async () => {
          expect(existsSync(garbage)).toBe(false);
          expectArtifactGeneration(finalPath, 'current artifact');
          throw new Error('stop after garbage collection');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after garbage collection');

    expectArtifactGeneration(finalPath, 'current artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('preserves a coherent public pair when the canonical transaction is malformed', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const transaction = join(root, '.package.zip.publish');
    writeArtifactGeneration(finalPath, 'current artifact');
    mkdirSync(transaction);
    writeFileSync(join(transaction, 'previous-artifact'), 'partial backup');

    await expect(
      buildValidatedFile(finalPath, {
        build: async () => {
          expect(existsSync(transaction)).toBe(false);
          expectArtifactGeneration(finalPath, 'current artifact');
          throw new Error('stop after malformed recovery');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after malformed recovery');

    expectArtifactGeneration(finalPath, 'current artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it.each([
    ['missing hadPrevious', { hadPrevious: undefined }],
    ['non-boolean hadPrevious', { hadPrevious: 0 }],
    ['invalid phase', { phase: 'committed' }],
    ['wrong target path', { targetName: 'other.zip' }],
    ['invalid new hash', { newSha256: 'not-a-hash' }]
  ])('does not mutate a coherent public pair for a journal with %s', async (_label, overrides) => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const transaction = join(root, '.package.zip.publish');
    writeArtifactGeneration(finalPath, 'current artifact');
    mkdirSync(transaction);
    writePublicationJournal(transaction, 'package.zip', {
      kind: 'file',
      phase: 'prepared',
      hadPrevious: false,
      newSha256: sha256('uncommitted artifact'),
      ...overrides
    });

    await expect(
      buildValidatedFile(finalPath, {
        build: async () => {
          expectArtifactGeneration(finalPath, 'current artifact');
          throw new Error('stop after safe inference');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after safe inference');

    expectArtifactGeneration(finalPath, 'current artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256']);
  });

  it('fails closed when an invalid file journal leaves two coherent generations', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const transaction = join(root, '.package.zip.publish');
    const previousBytes = Buffer.from('previous artifact');
    const previousSha256 = sha256(previousBytes);
    writeArtifactGeneration(finalPath, 'current artifact');
    mkdirSync(transaction);
    writeFileSync(join(transaction, 'previous-artifact'), previousBytes);
    writeFileSync(join(transaction, 'previous-checksum'), `${previousSha256}  package.zip\n`);
    writePublicationJournal(transaction, 'package.zip', {
      kind: 'file',
      phase: 'prepared',
      newSha256: sha256('uncommitted artifact')
    });
    let buildStarted = false;

    await expect(
      buildValidatedFile(finalPath, {
        build: async () => {
          buildStarted = true;
        },
        validate: async () => {}
      })
    ).rejects.toThrow('multiple coherent generations remain');

    expect(buildStarted).toBe(false);
    expectArtifactGeneration(finalPath, 'current artifact');
    expect(readFileSync(join(transaction, 'previous-artifact'))).toEqual(previousBytes);
    expect(readFileSync(join(transaction, 'previous-checksum'), 'utf8')).toBe(
      `${previousSha256}  package.zip\n`
    );
  });

  it.each(['live', 'dangling'])('does not follow a %s file publication transaction symlink', async (kind) => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const transaction = join(root, '.package.zip.publish');
    const target = join(root, 'transaction-target');

    if (kind === 'live') {
      const previousBytes = Buffer.from('target artifact');
      const previousSha256 = sha256(previousBytes);
      mkdirSync(target);
      writeFileSync(join(target, 'previous-artifact'), previousBytes);
      writeFileSync(join(target, 'previous-checksum'), `${previousSha256}  package.zip\n`);
      writePublicationJournal(target, 'package.zip', {
        kind: 'file',
        phase: 'prepared',
        hadPrevious: true,
        previousSha256,
        newSha256: sha256('untrusted target generation')
      });
    }
    symlinkSync(target, transaction, 'dir');

    await buildValidatedFile(finalPath, {
      build: async (candidatePath) => writeFileSync(candidatePath, 'published artifact'),
      validate: async () => {}
    });

    expectArtifactGeneration(finalPath, 'published artifact');
    expect(readdirSync(root)).not.toContain('.package.zip.publish');
    if (kind === 'live') {
      expect(readFileSync(join(target, 'previous-artifact'), 'utf8')).toBe('target artifact');
      expect(existsSync(join(target, 'previous-checksum'))).toBe(true);
      expect(existsSync(join(target, 'state.json'))).toBe(true);
    } else {
      expect(existsSync(target)).toBe(false);
    }
  });

  it('rejects a symlink artifact candidate', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const source = join(root, 'source.zip');
    writeFileSync(source, 'bytes');

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => symlinkSync(source, candidatePath),
        validate: async () => {}
      })
    ).rejects.toThrow('not a regular file');
    expect(existsSync(finalPath)).toBe(false);
    expect(readdirSync(root)).toEqual(['source.zip']);
  });

  it('rejects a regular candidate replaced by a symlink during validation', async () => {
    const root = temporaryRoot();
    const finalPath = join(root, 'package.zip');
    const source = join(root, 'source.zip');
    writeArtifactGeneration(finalPath, 'old artifact');
    writeFileSync(source, 'replacement bytes');

    await expect(
      buildValidatedFile(finalPath, {
        build: async (candidatePath) => writeFileSync(candidatePath, 'candidate bytes'),
        validate: async (candidatePath) => {
          rmSync(candidatePath);
          symlinkSync(source, candidatePath);
        }
      })
    ).rejects.toThrow('not a regular file after validation');

    expectArtifactGeneration(finalPath, 'old artifact');
    expect(readdirSync(root).sort()).toEqual(['package.zip', 'package.zip.sha256', 'source.zip']);
  });
});

describe('validated stage publication', () => {
  it('preserves the prior stage after validation failure', async () => {
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
          expect(readFileSync(join(finalDirectory, 'old.js'), 'utf8')).toBe('old');
          throw new Error('stage invalid');
        }
      })
    ).rejects.toThrow('stage invalid');

    expect(readdirSync(finalDirectory)).toEqual(['old.js']);
    expect(readFileSync(join(finalDirectory, 'old.js'), 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it('promotes a complete validated stage', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');

    await buildValidatedDirectory(finalDirectory, {
      build: async (candidateDirectory) => {
        mkdirSync(candidateDirectory);
        chmodSync(candidateDirectory, 0o700);
        writeFileSync(join(candidateDirectory, 'manifest.json'), '{}', { mode: 0o600 });
      },
      validate: async (candidateDirectory) => {
        expect(readFileSync(join(candidateDirectory, 'manifest.json'), 'utf8')).toBe('{}');
      }
    });

    expect(readdirSync(finalDirectory)).toEqual(['manifest.json']);
    expect(statSync(finalDirectory).mode & 0o777).toBe(0o755);
    expect(statSync(join(finalDirectory, 'manifest.json')).mode & 0o777).toBe(0o644);
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it('durably creates each missing directory output-parent ancestor', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'missing', 'nested', 'stages', 'chrome');

    await buildValidatedDirectory(finalDirectory, {
      build: async (candidateDirectory) => writeStageGeneration(candidateDirectory, 'nested stage'),
      validate: async () => {}
    });

    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('nested stage');
    expect(statSync(join(root, 'missing')).isDirectory()).toBe(true);
    expect(statSync(join(root, 'missing', 'nested')).isDirectory()).toBe(true);
    expect(statSync(join(root, 'missing', 'nested', 'stages')).isDirectory()).toBe(true);
  });

  it('hashes directory generations deterministically', () => {
    const root = temporaryRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    mkdirSync(join(first, 'nested'), { recursive: true });
    writeFileSync(join(first, 'z.txt'), 'z');
    writeFileSync(join(first, 'nested', 'a.txt'), 'a');
    mkdirSync(join(second, 'nested'), { recursive: true });
    writeFileSync(join(second, 'nested', 'a.txt'), 'a');
    writeFileSync(join(second, 'z.txt'), 'z');

    expect(hashDirectoryTree(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDirectoryTree(second)).toBe(hashDirectoryTree(first));
  });

  it('serializes concurrent stage writers', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const firstStarted = deferred();
    const releaseFirst = deferred();
    let secondStarted = false;
    const lock = { timeoutMs: 1000, pollMs: 5 };

    const first = buildValidatedDirectory(finalDirectory, {
      lock,
      build: async (candidateDirectory) => {
        mkdirSync(candidateDirectory);
        writeFileSync(join(candidateDirectory, 'generation.txt'), 'first');
        firstStarted.resolve();
        await releaseFirst.promise;
      },
      validate: async () => {}
    });
    await firstStarted.promise;
    const second = buildValidatedDirectory(finalDirectory, {
      lock,
      build: async (candidateDirectory) => {
        secondStarted = true;
        mkdirSync(candidateDirectory);
        writeFileSync(join(candidateDirectory, 'generation.txt'), 'second');
      },
      validate: async () => {}
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(secondStarted).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);

    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('second');
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it('keeps a stage generation pinned under the lease while a consumer reads it', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const consumerStarted = deferred();
    const releaseConsumer = deferred();
    let pinnedDirectory;
    let contenderStarted = false;
    const lock = { timeoutMs: 1000, pollMs: 5 };

    const first = buildValidatedDirectory(finalDirectory, {
      lock,
      build: async (candidateDirectory) => {
        writeStageGeneration(candidateDirectory, 'first');
      },
      validate: async () => {},
      consume: async (candidateDirectory) => {
        pinnedDirectory = candidateDirectory;
        expect(candidateDirectory).not.toBe(finalDirectory);
        expect(readFileSync(join(candidateDirectory, 'generation.txt'), 'utf8')).toBe('first');
        consumerStarted.resolve();
        await releaseConsumer.promise;
        expect(readFileSync(join(candidateDirectory, 'generation.txt'), 'utf8')).toBe('first');
      }
    });
    await consumerStarted.promise;

    const contender = buildValidatedDirectory(finalDirectory, {
      lock,
      build: async (candidateDirectory) => {
        contenderStarted = true;
        writeStageGeneration(candidateDirectory, 'second');
      },
      validate: async () => {}
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(contenderStarted).toBe(false);
    expect(readFileSync(join(pinnedDirectory, 'generation.txt'), 'utf8')).toBe('first');
    releaseConsumer.resolve();
    await Promise.all([first, contender]);

    expect(contenderStarted).toBe(true);
    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('second');
  });

  it('rolls back the prior stage if its publication rename fails', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    mkdirSync(finalDirectory);
    writeFileSync(join(finalDirectory, 'generation.txt'), 'old');

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async (candidateDirectory) => {
          mkdirSync(candidateDirectory);
          writeFileSync(join(candidateDirectory, 'generation.txt'), 'new');
        },
        validate: async () => {},
        renameDirectory(source, destination) {
          if (destination === finalDirectory && source.includes('.chrome.build-')) {
            throw new Error('stage rename failed');
          }
          renameSync(source, destination);
        }
      })
    ).rejects.toThrow('stage rename failed');

    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it('never exposes a canonical directory transaction when its initial directory rename fails', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const transaction = join(root, '.chrome.publish');
    writeStageGeneration(finalDirectory, 'old');
    let inspectedPreparation = false;

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async (candidateDirectory) => writeStageGeneration(candidateDirectory, 'new'),
        validate: async () => {},
        renameTransaction(source, destination) {
          expect(source).toContain('.chrome.publish-prepare-');
          expect(destination).toBe(transaction);
          expect(existsSync(transaction)).toBe(false);
          expect(readdirSync(source)).toEqual(['state.json']);
          expect(JSON.parse(readFileSync(join(source, 'state.json'), 'utf8'))).toMatchObject({
            kind: 'directory',
            phase: 'prepared',
            hadPrevious: true
          });
          inspectedPreparation = true;
          throw new Error('initial transaction rename failed');
        }
      })
    ).rejects.toThrow('initial transaction rename failed');

    expect(inspectedPreparation).toBe(true);
    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
    expect(existsSync(transaction)).toBe(false);
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it('cleans an interrupted directory transaction preparation before building', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const preparation = publicationPreparationPath(finalDirectory, 'interrupted');
    const previousSha256 = writeStageGeneration(finalDirectory, 'old');
    const expectedNew = join(root, 'expected-new');
    const newSha256 = writeStageGeneration(expectedNew, 'new');
    rmSync(expectedNew, { recursive: true });
    mkdirSync(preparation);
    writePublicationJournal(preparation, 'chrome', {
      kind: 'directory',
      phase: 'prepared',
      hadPrevious: true,
      previousSha256,
      newSha256
    });

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async () => {
          expect(existsSync(preparation)).toBe(false);
          expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
          throw new Error('stop after preparation cleanup');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after preparation cleanup');

    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it.each(['live', 'dangling'])(
    'does not follow a %s directory publication transaction symlink',
    async (kind) => {
      const root = temporaryRoot();
      const finalDirectory = join(root, 'chrome');
      const transaction = join(root, '.chrome.publish');
      const target = join(root, 'transaction-target');

      if (kind === 'live') {
        const previousSha256 = writeStageGeneration(join(target, 'previous-directory'), 'target stage');
        const expectedNew = join(root, 'expected-new');
        const newSha256 = writeStageGeneration(expectedNew, 'target new stage');
        rmSync(expectedNew, { recursive: true });
        writePublicationJournal(target, 'chrome', {
          kind: 'directory',
          phase: 'published',
          hadPrevious: true,
          previousSha256,
          newSha256
        });
      }
      symlinkSync(target, transaction, 'dir');

      await buildValidatedDirectory(finalDirectory, {
        build: async (candidateDirectory) => {
          writeStageGeneration(candidateDirectory, 'published stage');
        },
        validate: async () => {}
      });

      expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('published stage');
      expect(readdirSync(root)).not.toContain('.chrome.publish');
      if (kind === 'live') {
        expect(readFileSync(join(target, 'previous-directory', 'generation.txt'), 'utf8')).toBe(
          'target stage'
        );
        expect(existsSync(join(target, 'state.json'))).toBe(true);
      } else {
        expect(existsSync(target)).toBe(false);
      }
    }
  );

  it('preserves malformed canonical directory state while cleaning detached garbage', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const transaction = join(root, '.chrome.publish');
    const garbage = join(root, '.chrome.publish-gc-interrupted');
    mkdirSync(finalDirectory);
    writeFileSync(join(finalDirectory, 'generation.txt'), 'current');
    mkdirSync(join(transaction, 'previous-directory'), { recursive: true });
    writeFileSync(join(transaction, 'previous-directory', 'partial.txt'), 'malformed old stage');
    mkdirSync(join(garbage, 'previous-directory'), { recursive: true });
    writeFileSync(join(garbage, 'previous-directory', 'partial.txt'), 'detached old stage');
    let buildStarted = false;

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async () => {
          buildStarted = true;
        },
        validate: async () => {}
      })
    ).rejects.toThrow('invalid journal');

    expect(buildStarted).toBe(false);
    expect(existsSync(garbage)).toBe(false);
    expect(existsSync(transaction)).toBe(true);
    expect(readdirSync(finalDirectory)).toEqual(['generation.txt']);
    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('current');
    expect(readFileSync(join(transaction, 'previous-directory', 'partial.txt'), 'utf8')).toBe(
      'malformed old stage'
    );
    expect(readdirSync(root).sort()).toEqual(['.chrome.publish', 'chrome']);
  });

  it.each(['missing', 'malformed'])(
    'preserves the sole directory backup when its journal is %s',
    async (journalKind) => {
      const root = temporaryRoot();
      const finalDirectory = join(root, 'chrome');
      const transaction = join(root, '.chrome.publish');
      writeStageGeneration(join(transaction, 'previous-directory'), 'only good stage');
      if (journalKind === 'malformed') writeFileSync(join(transaction, 'state.json'), '{broken json\n');
      let buildStarted = false;

      await expect(
        buildValidatedDirectory(finalDirectory, {
          build: async () => {
            buildStarted = true;
          },
          validate: async () => {}
        })
      ).rejects.toThrow('transaction preserved');

      expect(buildStarted).toBe(false);
      expect(existsSync(finalDirectory)).toBe(false);
      expect(readFileSync(join(transaction, 'previous-directory', 'generation.txt'), 'utf8')).toBe(
        'only good stage'
      );
      expect(existsSync(transaction)).toBe(true);
    }
  );

  it('restores a valid prior stage when a published stage is missing', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const transaction = join(root, '.chrome.publish');
    const previousSha256 = writeStageGeneration(join(transaction, 'previous-directory'), 'old');
    const expectedNew = join(root, 'expected-new');
    const newSha256 = writeStageGeneration(expectedNew, 'new');
    rmSync(expectedNew, { recursive: true });
    writePublicationJournal(transaction, 'chrome', {
      kind: 'directory',
      phase: 'published',
      hadPrevious: true,
      previousSha256,
      newSha256
    });

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async () => {
          expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
          throw new Error('stop after published recovery');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after published recovery');

    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it('does not commit a new stage until its published journal is durable', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const transaction = join(root, '.chrome.publish');
    const previousSha256 = writeStageGeneration(join(transaction, 'previous-directory'), 'old');
    const newSha256 = writeStageGeneration(finalDirectory, 'new');
    writePublicationJournal(transaction, 'chrome', {
      kind: 'directory',
      phase: 'prepared',
      hadPrevious: true,
      previousSha256,
      newSha256
    });

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async () => {
          expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
          throw new Error('stop after prepared stage recovery');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after prepared stage recovery');

    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it('restores the hash-matching backup instead of accepting a corrupt published stage', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const transaction = join(root, '.chrome.publish');
    const previousSha256 = writeStageGeneration(join(transaction, 'previous-directory'), 'old');
    const newSha256 = writeStageGeneration(finalDirectory, 'new');
    writeFileSync(join(finalDirectory, 'generation.txt'), 'corrupt replacement');
    writePublicationJournal(transaction, 'chrome', {
      kind: 'directory',
      phase: 'published',
      hadPrevious: true,
      previousSha256,
      newSha256
    });

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async () => {
          expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
          throw new Error('stop after corrupt stage recovery');
        },
        validate: async () => {}
      })
    ).rejects.toThrow('stop after corrupt stage recovery');

    expect(readFileSync(join(finalDirectory, 'generation.txt'), 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['chrome']);
  });

  it('rejects recovery when the published stage is missing and the backup hash is wrong', async () => {
    const root = temporaryRoot();
    const finalDirectory = join(root, 'chrome');
    const transaction = join(root, '.chrome.publish');
    const expectedPrevious = join(root, 'expected-previous');
    const expectedNew = join(root, 'expected-new');
    const previousSha256 = writeStageGeneration(expectedPrevious, 'old');
    const newSha256 = writeStageGeneration(expectedNew, 'new');
    rmSync(expectedPrevious, { recursive: true });
    rmSync(expectedNew, { recursive: true });
    writeStageGeneration(join(transaction, 'previous-directory'), 'corrupt backup');
    writePublicationJournal(transaction, 'chrome', {
      kind: 'directory',
      phase: 'published',
      hadPrevious: true,
      previousSha256,
      newSha256
    });
    let buildStarted = false;

    await expect(
      buildValidatedDirectory(finalDirectory, {
        build: async () => {
          buildStarted = true;
        },
        validate: async () => {}
      })
    ).rejects.toThrow('cannot recover previous stage directory');

    expect(buildStarted).toBe(false);
    expect(existsSync(finalDirectory)).toBe(false);
    expect(readFileSync(join(transaction, 'previous-directory', 'generation.txt'), 'utf8')).toBe(
      'corrupt backup'
    );
  });
});
