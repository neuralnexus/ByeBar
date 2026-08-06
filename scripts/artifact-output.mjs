import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { hostname, platform } from 'node:os';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';

const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_LOCK_POLL_MS = 50;
const DEFAULT_STALE_LOCK_MS = 5 * 60 * 1000;
const DEAD_OWNER_GRACE_MS = 1000;
const LOCK_VERSION = 2;
const JOURNAL_VERSION = 2;
const SHA256_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const PROCESS_IDENTITY_RE = /^(?:darwin|linux):[a-f0-9]{64}$/;

// Publication serializes writers and recovers interrupted writes. Consumers must wait for the
// returned promise before reading; separate public paths are not a transaction for concurrent readers.

function publicationPaths(finalPath) {
  const parent = dirname(finalPath);
  const name = basename(finalPath);
  const transaction = join(parent, `.${name}.publish`);
  return {
    parent,
    name,
    transaction,
    state: join(transaction, 'state.json'),
    previousArtifact: join(transaction, 'previous-artifact'),
    previousChecksum: join(transaction, 'previous-checksum'),
    previousDirectory: join(transaction, 'previous-directory'),
    lockClaimPrefix: `.${name}.lock-claim-`,
    lockGcPrefix: `.${name}.lock-gc-`,
    transactionPreparePrefix: `.${name}.publish-prepare-`,
    transactionGcPrefix: `.${name}.publish-gc-`,
    workspacePrefix: `.${name}.build-`
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readJson(path) {
  try {
    if (!isRegularFile(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isRegularFile(path) {
  const stat = lstatOrNull(path);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
}

function isRegularDirectory(path) {
  const stat = lstatOrNull(path);
  return Boolean(stat?.isDirectory() && !stat.isSymbolicLink());
}

const UNSUPPORTED_FSYNC_ERRORS = new Set(['EBADF', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM']);

function syncPath(path) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    if (!UNSUPPORTED_FSYNC_ERRORS.has(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function syncDirectory(path) {
  if (!isRegularDirectory(path)) throw new Error(`cannot sync non-directory path: ${path}`);
  syncPath(path);
}

function syncRegularFile(path) {
  if (!isRegularFile(path)) throw new Error(`cannot sync non-file path: ${path}`);
  syncPath(path);
}

function syncParentDirectories(...paths) {
  for (const directory of new Set(paths.map((path) => dirname(path)))) syncDirectory(directory);
}

function durableRename(source, destination, rename = renameSync) {
  syncParentDirectories(source, destination);
  rename(source, destination);
  syncParentDirectories(source, destination);
}

function durableMkdir(path) {
  mkdirSync(path);
  syncDirectory(path);
  syncDirectory(dirname(path));
}

function ensureDurableDirectory(path) {
  const absolute = resolve(path);
  const { root } = parse(absolute);
  if (!isRegularDirectory(root)) throw new Error(`output directory root is not regular: ${root}`);
  let current = root;
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    const existing = lstatOrNull(current);
    if (existing) {
      // macOS exposes system aliases such as /var -> /private/var at the filesystem root.
      if (index === 0 && existing.isSymbolicLink()) {
        current = realpathSync(current);
        if (!isRegularDirectory(current)) {
          throw new Error(`output directory ancestor is not a regular directory: ${current}`);
        }
        syncDirectory(current);
        syncDirectory(dirname(current));
        continue;
      }
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new Error(`output directory ancestor is not a regular directory: ${current}`);
      }
      syncDirectory(current);
      syncDirectory(dirname(current));
      continue;
    }

    try {
      mkdirSync(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (!isRegularDirectory(current)) {
      throw new Error(`output directory ancestor is not a regular directory: ${current}`);
    }
    syncDirectory(current);
    syncDirectory(dirname(current));
  }
}

function durableRemove(path) {
  const stat = lstatOrNull(path);
  if (!stat) return false;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    rmSync(path, { recursive: true, force: true });
  } else {
    unlinkSync(path);
  }
  syncDirectory(dirname(path));
  return true;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function processStartIdentity(pid) {
  try {
    const system = platform();
    let evidence;
    if (system === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const commandEnd = stat.lastIndexOf(')');
      if (commandEnd === -1) return null;
      const fields = stat
        .slice(commandEnd + 1)
        .trim()
        .split(/\s+/);
      const startTicks = fields[19];
      const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      if (!/^\d+$/.test(startTicks) || !/^[a-f0-9-]{36}$/.test(bootId)) return null;
      evidence = `${bootId}:${startTicks}`;
    } else if (system === 'darwin') {
      evidence = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
        stdio: ['ignore', 'pipe', 'ignore']
      })
        .trim()
        .replace(/\s+/g, ' ');
      if (!evidence) return null;
    } else {
      return null;
    }
    return `${system}:${createHash('sha256').update(evidence).digest('hex')}`;
  } catch {
    return null;
  }
}

const ownProcessIdentity = processStartIdentity(process.pid);

function processIdentityIsComparable(identity) {
  return (
    typeof identity === 'string' &&
    PROCESS_IDENTITY_RE.test(identity) &&
    identity.startsWith(`${platform()}:`)
  );
}

function processOwnerIsGone(owner) {
  if (!plausibleLockOwner(owner) || owner.hostname !== hostname()) return false;
  if (!processIsAlive(owner.pid)) return true;
  if (!processIdentityIsComparable(owner.processIdentity)) return false;
  const currentIdentity = owner.pid === process.pid ? ownProcessIdentity : processStartIdentity(owner.pid);
  return currentIdentity !== null && currentIdentity !== owner.processIdentity;
}

function numericLockOption(value, fallback, minimum, name) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < minimum) {
    throw new Error(`${name} must be a finite number greater than or equal to ${minimum}`);
  }
  return result;
}

function lockSettings(options) {
  const lock = options.lock || {};
  return {
    timeoutMs: numericLockOption(
      lock.timeoutMs ?? options.lockTimeoutMs,
      DEFAULT_LOCK_TIMEOUT_MS,
      0,
      'lock timeout'
    ),
    pollMs: numericLockOption(
      lock.pollMs ?? options.lockPollMs,
      DEFAULT_LOCK_POLL_MS,
      1,
      'lock poll interval'
    ),
    staleMs: numericLockOption(
      lock.staleMs ?? options.staleLockMs,
      DEFAULT_STALE_LOCK_MS,
      1,
      'stale lock interval'
    )
  };
}

function plausibleLockOwner(owner) {
  return (
    Number.isSafeInteger(owner?.pid) &&
    owner.pid > 0 &&
    owner.pid <= 0x7fffffff &&
    typeof owner.hostname === 'string'
  );
}

function currentLockOwner(owner, token) {
  return owner?.version === LOCK_VERSION && owner.token === token && plausibleLockOwner(owner);
}

function newestEntryMtime(path, initialMtime) {
  let newest = initialMtime;
  try {
    for (const entry of readdirSync(path)) {
      const stat = lstatOrNull(join(path, entry));
      if (stat) newest = Math.max(newest, stat.mtimeMs);
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
  return newest;
}

function inspectClaim(paths, entryName, settings) {
  const token = entryName.slice(paths.lockClaimPrefix.length);
  const path = join(paths.parent, entryName);
  const claimStat = lstatOrNull(path);
  if (!claimStat) return null;
  if (!claimStat.isDirectory() || claimStat.isSymbolicLink()) {
    const age = Math.max(0, Date.now() - claimStat.mtimeMs);
    return {
      token,
      path,
      recognized: false,
      abandoned: age >= settings.staleMs,
      ticket: null,
      age
    };
  }

  const owner = readJson(join(path, 'owner.json'));
  const leasePath = join(path, 'lease');
  const leaseStat = lstatOrNull(leasePath);
  const recognized = currentLockOwner(owner, token) && Boolean(leaseStat?.isFile());
  const lastSeen = recognized ? leaseStat.mtimeMs : newestEntryMtime(path, claimStat.mtimeMs);
  const age = Math.max(0, Date.now() - lastSeen);
  // This lock is local-host/workspace scoped; foreign-host claims are never stolen because their
  // process liveness cannot be proven safely.
  const ownerGone = processOwnerIsGone(owner);
  const abandoned = plausibleLockOwner(owner)
    ? ownerGone && age >= Math.min(settings.staleMs, DEAD_OWNER_GRACE_MS)
    : age >= settings.staleMs;
  const ticketRecord = recognized ? readJson(join(path, 'ticket.json')) : null;
  const ticket =
    Number.isSafeInteger(ticketRecord?.ticket) && ticketRecord.ticket > 0 && ticketRecord.token === token
      ? ticketRecord.ticket
      : null;

  return { token, path, recognized, abandoned, ticket, age };
}

function cleanupDetachedPath(path) {
  try {
    durableRemove(path);
  } catch {
    // Detached garbage cannot affect lock ownership or publication recovery.
  }
}

function detachToGarbage(source, paths, prefix) {
  const garbage = join(paths.parent, `${prefix}${randomUUID()}`);
  try {
    durableRename(source, garbage);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  cleanupDetachedPath(garbage);
  return true;
}

function cleanupDetachedGarbage(paths) {
  for (const entry of readdirSync(paths.parent, { withFileTypes: true })) {
    if (entry.name.startsWith(paths.lockGcPrefix) || entry.name.startsWith(paths.transactionGcPrefix)) {
      cleanupDetachedPath(join(paths.parent, entry.name));
    }
  }
}

function cleanupAbandonedPreparations(paths, lease) {
  for (const entry of readdirSync(paths.parent, { withFileTypes: true })) {
    if (!entry.name.startsWith(paths.transactionPreparePrefix)) continue;
    lease.assert();
    durableRemove(join(paths.parent, entry.name));
  }
}

// Claims are never reused: stale cleanup can detach only the observed token, while tickets order contenders.
function liveClaims(paths, settings) {
  const claims = [];
  for (const entry of readdirSync(paths.parent, { withFileTypes: true })) {
    if (!entry.name.startsWith(paths.lockClaimPrefix)) continue;
    const claim = inspectClaim(paths, entry.name, settings);
    if (!claim) continue;
    if (claim.abandoned) {
      detachToGarbage(claim.path, paths, paths.lockGcPrefix);
    } else {
      claims.push(claim);
    }
  }
  return claims;
}

function claimPrecedes(left, right) {
  return left.ticket < right.ticket || (left.ticket === right.ticket && left.token < right.token);
}

function createLease(paths, settings, token, ticket, claimPath) {
  let lost = false;

  function inspectOwnClaim() {
    const claim = inspectClaim(paths, `${paths.lockClaimPrefix}${token}`, settings);
    if (
      !claim ||
      !claim.recognized ||
      claim.abandoned ||
      claim.ticket !== ticket ||
      claim.path !== claimPath
    ) {
      lost = true;
      return null;
    }
    return claim;
  }

  function pulse() {
    return Boolean(!lost && inspectOwnClaim());
  }

  return {
    token,
    ticket,
    pulse,
    assert() {
      if (!pulse()) throw new Error(`artifact lock lease lost: ${paths.name}`);
    },
    held() {
      return Boolean(!lost && inspectOwnClaim());
    },
    release() {
      detachToGarbage(claimPath, paths, paths.lockGcPrefix);
    }
  };
}

async function acquirePublicationLock(paths, settings) {
  const startedAt = Date.now();
  const token = randomUUID();
  const claimPath = join(paths.parent, `${paths.lockClaimPrefix}${token}`);
  let lease;
  cleanupDetachedGarbage(paths);

  try {
    mkdirSync(claimPath);
    const owner = {
      version: LOCK_VERSION,
      pid: process.pid,
      hostname: hostname(),
      token,
      createdAt: new Date().toISOString()
    };
    if (ownProcessIdentity) owner.processIdentity = ownProcessIdentity;
    writeFileSync(join(claimPath, 'owner.json'), `${JSON.stringify(owner)}\n`, { mode: 0o600 });
    writeFileSync(join(claimPath, 'lease'), `${token}\n`, { mode: 0o600 });

    const existing = liveClaims(paths, settings);
    const highestTicket = existing.reduce((highest, claim) => Math.max(highest, claim.ticket || 0), 0);
    if (highestTicket >= Number.MAX_SAFE_INTEGER) throw new Error('artifact lock ticket space exhausted');
    const ticket = highestTicket + 1;
    const temporaryTicket = join(claimPath, `.ticket-${token}.tmp`);
    writeFileSync(temporaryTicket, `${JSON.stringify({ ticket, token })}\n`, { mode: 0o600 });
    renameSync(temporaryTicket, join(claimPath, 'ticket.json'));

    lease = createLease(paths, settings, token, ticket, claimPath);
    while (true) {
      if (!lease.pulse()) throw new Error(`artifact lock lease lost: ${paths.name}`);
      const ownOrder = { ticket, token };
      const blocked = liveClaims(paths, settings).some(
        (claim) => claim.token !== token && (claim.ticket === null || claimPrecedes(claim, ownOrder))
      );
      if (!blocked) return lease;
      if (Date.now() - startedAt >= settings.timeoutMs) {
        throw new Error(`timed out waiting for artifact lock: ${join(paths.parent, paths.name)}`);
      }
      await sleep(settings.pollMs);
    }
  } catch (error) {
    if (lease) lease.release();
    else detachToGarbage(claimPath, paths, paths.lockGcPrefix);
    throw error;
  }
}

function cleanupAbandonedWorkspaces(paths) {
  for (const entry of readdirSync(paths.parent, { withFileTypes: true })) {
    if (entry.name.startsWith(paths.workspacePrefix)) {
      rmSync(join(paths.parent, entry.name), { recursive: true, force: true });
    }
  }
}

function hashRegularFile(path) {
  if (!isRegularFile(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function updateTreeEntryHash(hash, type, relativePath, bytes) {
  const pathBytes = Buffer.from(relativePath);
  hash.update(`${type}\0${pathBytes.length}\0`);
  hash.update(pathBytes);
  hash.update('\0');
  if (bytes) {
    hash.update(`${bytes.length}\0`);
    hash.update(bytes);
  }
}

export function hashDirectoryTree(root) {
  if (!isRegularDirectory(root)) return null;
  const hash = createHash('sha256').update('byebar-directory-tree-v1\0');

  function visit(directory, relativeDirectory) {
    const names = readdirSync(directory).sort();
    for (const name of names) {
      const path = join(directory, name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const stat = lstatOrNull(path);
      if (!stat || stat.isSymbolicLink()) return false;
      if (stat.isDirectory()) {
        updateTreeEntryHash(hash, 'directory', relativePath);
        if (!visit(path, relativePath)) return false;
      } else if (stat.isFile()) {
        updateTreeEntryHash(hash, 'file', relativePath, readFileSync(path));
      } else {
        return false;
      }
    }
    return true;
  }

  return visit(root, '') ? hash.digest('hex') : null;
}

function syncDirectoryTree(root) {
  if (!isRegularDirectory(root)) throw new Error(`cannot sync non-directory tree: ${root}`);
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`cannot sync directory tree containing symlink: ${path}`);
    if (stat.isDirectory()) syncDirectoryTree(path);
    else if (stat.isFile()) syncRegularFile(path);
    else throw new Error(`cannot sync unsupported directory entry: ${path}`);
  }
  syncDirectory(root);
}

function checksumHash(checksumPath, finalName) {
  if (!isRegularFile(checksumPath)) return null;
  const match = /^([a-f0-9]{64}) {2}([^\r\n]+)\n$/.exec(readFileSync(checksumPath, 'utf8'));
  return match?.[2] === finalName ? match[1] : null;
}

function coherentFileHash(artifactPath, checksumPath, finalName) {
  const expected = checksumHash(checksumPath, finalName);
  if (!expected) return null;
  return hashRegularFile(artifactPath) === expected ? expected : null;
}

function writeJournal(transaction, state) {
  if (!isRegularDirectory(transaction)) {
    throw new Error(`publication transaction is not a regular directory: ${transaction}`);
  }
  const statePath = join(transaction, 'state.json');
  const temporaryState = join(transaction, `.state-${randomUUID()}.tmp`);
  writeFileSync(temporaryState, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  syncRegularFile(temporaryState);
  durableRename(temporaryState, statePath);
}

function prepareCanonicalTransaction(paths, state, lease, renameTransaction) {
  if (
    (state.kind !== 'file' && state.kind !== 'directory') ||
    state.phase !== 'prepared' ||
    !validJournalState(state, state.kind, paths)
  ) {
    throw new Error(`refusing to prepare an invalid publication journal: ${paths.transaction}`);
  }
  const preparation = join(paths.parent, `${paths.transactionPreparePrefix}${randomUUID()}`);
  durableMkdir(preparation);
  try {
    writeJournal(preparation, state);
    const persistedState = readJson(join(preparation, 'state.json'));
    if (!validJournalState(persistedState, state.kind, paths) || persistedState.phase !== 'prepared') {
      throw new Error(`prepared publication journal is not valid: ${preparation}`);
    }
    syncDirectory(preparation);
    lease.assert();
    if (lstatOrNull(paths.transaction)) {
      throw new Error(`publication transaction already exists: ${paths.transaction}`);
    }
    durableRename(preparation, paths.transaction, renameTransaction);
  } finally {
    if (lstatOrNull(preparation)) durableRemove(preparation);
  }
}

function hasCanonicalTransaction(paths) {
  const stat = lstatOrNull(paths.transaction);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    detachToGarbage(paths.transaction, paths, paths.transactionGcPrefix);
    return false;
  }
  return true;
}

function discardTransaction(paths) {
  // Detach first so interrupted recursive deletion cannot become canonical recovery state.
  if (lstatOrNull(paths.transaction)) {
    detachToGarbage(paths.transaction, paths, paths.transactionGcPrefix);
  }
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_RE.test(value);
}

function hasExactKeys(record, expectedKeys) {
  const actualKeys = Object.keys(record).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function validJournalState(state, kind, paths) {
  if (!state || Array.isArray(state) || Object.getPrototypeOf(state) !== Object.prototype) return false;
  if (typeof state.hadPrevious !== 'boolean') return false;
  const expectedKeys = [
    'hadPrevious',
    'kind',
    'lockTicket',
    'lockToken',
    'newSha256',
    'phase',
    'targetName',
    'version'
  ];
  if (state.hadPrevious) expectedKeys.push('previousSha256');
  return (
    hasExactKeys(state, expectedKeys) &&
    state.version === JOURNAL_VERSION &&
    state.kind === kind &&
    state.targetName === paths.name &&
    (state.phase === 'prepared' || state.phase === 'published') &&
    typeof state.lockToken === 'string' &&
    UUID_RE.test(state.lockToken) &&
    Number.isSafeInteger(state.lockTicket) &&
    state.lockTicket > 0 &&
    isSha256(state.newSha256) &&
    (!state.hadPrevious || isSha256(state.previousSha256))
  );
}

function publicationRecoveryError(paths, kind, reason) {
  return new Error(
    `cannot recover ${kind} publication: ${reason}; transaction preserved at ${paths.transaction}`
  );
}

function assertRegularPublicationPath(path, expectedType, paths, kind) {
  const stat = lstatOrNull(path);
  if (!stat) return false;
  const matches = !stat.isSymbolicLink() && (expectedType === 'file' ? stat.isFile() : stat.isDirectory());
  if (!matches) {
    throw publicationRecoveryError(paths, kind, `unexpected ${expectedType} path type at ${path}`);
  }
  return true;
}

function inspectFilePublicationPaths(finalPath, checksumPath, paths) {
  return {
    finalArtifact: assertRegularPublicationPath(finalPath, 'file', paths, 'file'),
    finalChecksum: assertRegularPublicationPath(checksumPath, 'file', paths, 'file'),
    previousArtifact: assertRegularPublicationPath(paths.previousArtifact, 'file', paths, 'file'),
    previousChecksum: assertRegularPublicationPath(paths.previousChecksum, 'file', paths, 'file')
  };
}

function fileGenerationSources(finalPath, checksumPath, paths, expectedHash) {
  const artifact = [finalPath, paths.previousArtifact].find((path) => hashRegularFile(path) === expectedHash);
  const checksum = [checksumPath, paths.previousChecksum].find(
    (path) => checksumHash(path, paths.name) === expectedHash
  );
  return artifact && checksum ? { artifact, checksum } : null;
}

function restoreFileGeneration(finalPath, checksumPath, paths, expectedHash) {
  const sources = fileGenerationSources(finalPath, checksumPath, paths, expectedHash);
  if (!sources) throw new Error(`cannot recover previous artifact generation: ${finalPath}`);

  if (sources.artifact !== finalPath) durableRemove(finalPath);
  if (sources.checksum !== checksumPath) durableRemove(checksumPath);
  if (sources.artifact !== finalPath) durableRename(sources.artifact, finalPath);
  if (sources.checksum !== checksumPath) durableRename(sources.checksum, checksumPath);
  if (coherentFileHash(finalPath, checksumPath, paths.name) !== expectedHash) {
    throw new Error(`recovered artifact generation is not coherent: ${finalPath}`);
  }
  discardTransaction(paths);
}

function coherentFileGenerationHashes(finalPath, checksumPath, paths) {
  const hashes = new Set();
  for (const artifactPath of [finalPath, paths.previousArtifact]) {
    const hash = hashRegularFile(artifactPath);
    if (
      hash &&
      [checksumPath, paths.previousChecksum].some(
        (candidateChecksum) => checksumHash(candidateChecksum, paths.name) === hash
      )
    ) {
      hashes.add(hash);
    }
  }
  return hashes;
}

function recoverFileWithoutTrustedJournal(finalPath, checksumPath, paths) {
  inspectFilePublicationPaths(finalPath, checksumPath, paths);
  const hashes = coherentFileGenerationHashes(finalPath, checksumPath, paths);
  if (hashes.size === 1) {
    restoreFileGeneration(finalPath, checksumPath, paths, [...hashes][0]);
    return;
  }
  const reason =
    hashes.size > 1
      ? 'journal is invalid and multiple coherent generations remain'
      : 'journal is invalid and no coherent generation can be proven';
  throw publicationRecoveryError(paths, 'file', reason);
}

function recoverFilePublication(finalPath, checksumPath, paths) {
  if (!hasCanonicalTransaction(paths)) return;
  const state = readJson(paths.state);
  if (!validJournalState(state, 'file', paths)) {
    recoverFileWithoutTrustedJournal(finalPath, checksumPath, paths);
    return;
  }

  const locations = inspectFilePublicationPaths(finalPath, checksumPath, paths);
  if (!state.hadPrevious && (locations.previousArtifact || locations.previousChecksum)) {
    throw publicationRecoveryError(paths, 'file', 'journal denies the existing backup generation');
  }
  if (
    state.hadPrevious &&
    ((locations.previousArtifact && hashRegularFile(paths.previousArtifact) !== state.previousSha256) ||
      (locations.previousChecksum &&
        checksumHash(paths.previousChecksum, paths.name) !== state.previousSha256))
  ) {
    throw publicationRecoveryError(paths, 'file', 'backup paths do not match the journal hash');
  }

  const publishedHash = coherentFileHash(finalPath, checksumPath, paths.name);
  if (state.phase === 'published' && publishedHash === state.newSha256) {
    discardTransaction(paths);
    return;
  }

  if (state.hadPrevious) {
    if (!fileGenerationSources(finalPath, checksumPath, paths, state.previousSha256)) {
      throw publicationRecoveryError(
        paths,
        'file',
        `cannot recover previous artifact generation ${finalPath}`
      );
    }
    restoreFileGeneration(finalPath, checksumPath, paths, state.previousSha256);
    return;
  }

  if (publishedHash && publishedHash !== state.newSha256) {
    throw publicationRecoveryError(paths, 'file', 'public generation does not match the journal hash');
  }
  durableRemove(finalPath);
  durableRemove(checksumPath);
  discardTransaction(paths);
}

function recoverDirectoryPublication(finalDirectory, paths) {
  if (!hasCanonicalTransaction(paths)) return;
  const state = readJson(paths.state);
  if (!validJournalState(state, 'directory', paths)) {
    throw publicationRecoveryError(paths, 'directory', `invalid journal at ${paths.state}`);
  }

  const finalPresent = assertRegularPublicationPath(finalDirectory, 'directory', paths, 'directory');
  const backupPresent = assertRegularPublicationPath(
    paths.previousDirectory,
    'directory',
    paths,
    'directory'
  );
  if (!state.hadPrevious && backupPresent) {
    throw publicationRecoveryError(paths, 'directory', 'journal denies the existing backup generation');
  }
  const backupHash = backupPresent ? hashDirectoryTree(paths.previousDirectory) : null;
  if (state.hadPrevious && backupPresent && backupHash !== state.previousSha256) {
    throw publicationRecoveryError(
      paths,
      'directory',
      `cannot recover previous stage directory ${finalDirectory}: backup path does not match the journal hash`
    );
  }

  const publishedHash = hashDirectoryTree(finalDirectory);
  if (state.phase === 'published' && publishedHash === state.newSha256) {
    discardTransaction(paths);
    return;
  }

  if (state.hadPrevious && publishedHash === state.previousSha256) {
    discardTransaction(paths);
    return;
  }

  if (state.hadPrevious) {
    if (backupHash !== state.previousSha256) {
      throw publicationRecoveryError(
        paths,
        'directory',
        `cannot recover previous stage directory ${finalDirectory}`
      );
    }
    durableRemove(finalDirectory);
    durableRename(paths.previousDirectory, finalDirectory);
    if (hashDirectoryTree(finalDirectory) !== state.previousSha256) {
      throw new Error(`recovered stage generation is not coherent: ${finalDirectory}`);
    }
    discardTransaction(paths);
    return;
  }

  if (finalPresent && publishedHash !== state.newSha256) {
    throw publicationRecoveryError(paths, 'directory', 'public generation does not match the journal hash');
  }
  durableRemove(finalDirectory);
  discardTransaction(paths);
}

export async function buildValidatedFile(finalPath, options) {
  const { build, validate, renameFile = renameSync, renameTransaction = renameSync } = options;
  const checksumPath = `${finalPath}.sha256`;
  const paths = publicationPaths(finalPath);
  ensureDurableDirectory(paths.parent);
  const lease = await acquirePublicationLock(paths, lockSettings(options));
  let workspace;

  try {
    cleanupDetachedGarbage(paths);
    lease.assert();
    cleanupAbandonedPreparations(paths, lease);
    cleanupAbandonedWorkspaces(paths);
    lease.assert();
    recoverFilePublication(finalPath, checksumPath, paths);

    const previousSha256 = coherentFileHash(finalPath, checksumPath, paths.name);
    if (!previousSha256 && (lstatOrNull(finalPath) || lstatOrNull(checksumPath))) {
      durableRemove(finalPath);
      durableRemove(checksumPath);
    }

    workspace = mkdtempSync(join(paths.parent, paths.workspacePrefix));
    const candidatePath = join(workspace, paths.name);
    const candidateChecksum = `${candidatePath}.sha256`;
    await build(candidatePath, workspace);
    if (!existsSync(candidatePath)) throw new Error(`artifact build did not produce ${paths.name}`);
    if (!isRegularFile(candidatePath)) {
      throw new Error(`artifact candidate is not a regular file: ${paths.name}`);
    }
    chmodSync(candidatePath, 0o644);
    await validate(candidatePath, workspace);
    if (!isRegularFile(candidatePath)) {
      throw new Error(`artifact candidate is not a regular file after validation: ${paths.name}`);
    }
    chmodSync(candidatePath, 0o644);
    syncRegularFile(candidatePath);

    const sha256 = hashRegularFile(candidatePath);
    if (!sha256) throw new Error(`artifact candidate could not be hashed: ${paths.name}`);
    writeFileSync(candidateChecksum, `${sha256}  ${paths.name}\n`, { mode: 0o644 });
    chmodSync(candidateChecksum, 0o644);
    syncRegularFile(candidateChecksum);

    lease.assert();
    const preparedState = {
      version: JOURNAL_VERSION,
      kind: 'file',
      targetName: paths.name,
      phase: 'prepared',
      lockToken: lease.token,
      lockTicket: lease.ticket,
      hadPrevious: Boolean(previousSha256),
      ...(previousSha256 ? { previousSha256 } : {}),
      newSha256: sha256
    };

    try {
      prepareCanonicalTransaction(paths, preparedState, lease, renameTransaction);
      if (previousSha256) {
        lease.assert();
        durableRename(finalPath, paths.previousArtifact, renameFile);
        lease.assert();
        durableRename(checksumPath, paths.previousChecksum, renameFile);
      }
      lease.assert();
      durableRename(candidatePath, finalPath, renameFile);
      lease.assert();
      durableRename(candidateChecksum, checksumPath, renameFile);
      if (coherentFileHash(finalPath, checksumPath, paths.name) !== sha256) {
        throw new Error(`published artifact generation is not coherent: ${finalPath}`);
      }
      lease.assert();
      writeJournal(paths.transaction, { ...preparedState, phase: 'published' });
      discardTransaction(paths);
    } catch (error) {
      if (lease.held() && readJson(paths.state)?.lockToken === lease.token) {
        try {
          recoverFilePublication(finalPath, checksumPath, paths);
        } catch (rollbackError) {
          throw new Error(`${error.message}; rollback failed: ${rollbackError.message}`, {
            cause: rollbackError
          });
        }
      }
      throw error;
    }

    return { path: finalPath, checksumPath, sha256 };
  } finally {
    try {
      if (workspace) rmSync(workspace, { recursive: true, force: true });
    } finally {
      lease.release();
    }
  }
}

function normalizeDirectoryTree(root) {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`stage candidate is not a regular directory: ${basename(root)}`);
  }
  function visit(directory) {
    chmodSync(directory, 0o755);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`stage candidate contains symlink: ${entry.name}`);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) chmodSync(path, 0o644);
      else throw new Error(`stage candidate contains unsupported entry: ${entry.name}`);
    }
  }
  visit(root);
}

export async function buildValidatedDirectory(finalDirectory, options) {
  const { build, validate, consume, renameDirectory = renameSync, renameTransaction = renameSync } = options;
  const paths = publicationPaths(finalDirectory);
  ensureDurableDirectory(paths.parent);
  const lease = await acquirePublicationLock(paths, lockSettings(options));
  let workspace;

  try {
    cleanupDetachedGarbage(paths);
    lease.assert();
    cleanupAbandonedPreparations(paths, lease);
    cleanupAbandonedWorkspaces(paths);
    lease.assert();
    recoverDirectoryPublication(finalDirectory, paths);
    const previousSha256 = hashDirectoryTree(finalDirectory);
    if (!previousSha256 && lstatOrNull(finalDirectory)) {
      durableRemove(finalDirectory);
    }
    const hadPrevious = Boolean(previousSha256);

    workspace = mkdtempSync(join(paths.parent, paths.workspacePrefix));
    const candidateDirectory = join(workspace, paths.name);
    await build(candidateDirectory, workspace);
    normalizeDirectoryTree(candidateDirectory);
    await validate(candidateDirectory, workspace);
    normalizeDirectoryTree(candidateDirectory);
    const newSha256 = hashDirectoryTree(candidateDirectory);
    if (!newSha256) throw new Error(`stage candidate could not be hashed: ${paths.name}`);

    if (consume) {
      await consume(candidateDirectory, workspace);
      normalizeDirectoryTree(candidateDirectory);
      if (hashDirectoryTree(candidateDirectory) !== newSha256) {
        throw new Error(`stage consumer modified pinned generation: ${paths.name}`);
      }
    }
    syncDirectoryTree(candidateDirectory);

    lease.assert();
    const preparedState = {
      version: JOURNAL_VERSION,
      kind: 'directory',
      targetName: paths.name,
      phase: 'prepared',
      lockToken: lease.token,
      lockTicket: lease.ticket,
      hadPrevious,
      ...(previousSha256 ? { previousSha256 } : {}),
      newSha256
    };

    try {
      prepareCanonicalTransaction(paths, preparedState, lease, renameTransaction);
      if (hadPrevious) {
        lease.assert();
        durableRename(finalDirectory, paths.previousDirectory, renameDirectory);
      }
      lease.assert();
      durableRename(candidateDirectory, finalDirectory, renameDirectory);
      if (hashDirectoryTree(finalDirectory) !== newSha256) {
        throw new Error(`published stage generation is not coherent: ${finalDirectory}`);
      }
      lease.assert();
      writeJournal(paths.transaction, { ...preparedState, phase: 'published' });
      discardTransaction(paths);
    } catch (error) {
      if (lease.held() && readJson(paths.state)?.lockToken === lease.token) {
        try {
          recoverDirectoryPublication(finalDirectory, paths);
        } catch (rollbackError) {
          throw new Error(`${error.message}; rollback failed: ${rollbackError.message}`, {
            cause: rollbackError
          });
        }
      }
      throw error;
    }

    return finalDirectory;
  } finally {
    try {
      if (workspace) rmSync(workspace, { recursive: true, force: true });
    } finally {
      lease.release();
    }
  }
}
