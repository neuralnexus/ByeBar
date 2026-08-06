import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { createDeterministicZip, listRegularFiles } from './deterministic-zip.mjs';

export { listRegularFiles };

const CANONICAL_DOS_TIME = 0;
const CANONICAL_DOS_DATE = 0x21;
const CANONICAL_FILE_MODE = 0o100644;
const CANONICAL_VERSION_MADE_BY = 0x031e;
const STORE_COMPRESSION = 0;
const DEFLATE_COMPRESSION = 8;
const STORE_VERSION_NEEDED = 10;
const DEFLATE_VERSION_NEEDED = 20;

function assertArchiveEntry(entry) {
  const normalized = posix.normalize(entry);
  if (
    !entry ||
    entry.includes('\\') ||
    posix.isAbsolute(entry) ||
    normalized !== entry ||
    normalized.startsWith('../')
  ) {
    throw new Error(`unsafe archive entry: ${entry}`);
  }
}

export function centralDirectoryEntries(buffer) {
  const minimumEocdSize = 22;
  const earliest = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory record is missing');
  const disk = buffer.readUInt16LE(eocd + 4);
  const directoryDisk = buffer.readUInt16LE(eocd + 6);
  const diskCount = buffer.readUInt16LE(eocd + 8);
  const count = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  const archiveCommentLength = buffer.readUInt16LE(eocd + 20);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new Error('ZIP64 packages are not supported');
  if (disk !== 0 || directoryDisk !== 0 || diskCount !== count) {
    throw new Error('multi-disk ZIP packages are not supported');
  }
  if (archiveCommentLength !== 0 || eocd + minimumEocdSize !== buffer.length) {
    throw new Error('archive comments or trailing bytes are not allowed');
  }
  if (directoryOffset + directorySize !== eocd) throw new Error('ZIP central-directory bounds are invalid');

  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > eocd) throw new Error('truncated ZIP central-directory entry');
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid ZIP central-directory entry');
    const versionMadeBy = buffer.readUInt16LE(offset + 4);
    const versionNeeded = buffer.readUInt16LE(offset + 6);
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const dosTime = buffer.readUInt16LE(offset + 12);
    const dosDate = buffer.readUInt16LE(offset + 14);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (flags & 1) throw new Error(`encrypted archive entry is not allowed: ${name}`);
    if (localHeaderOffset + 30 > directoryOffset || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`invalid ZIP local header: ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const localName = buffer
      .subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength)
      .toString('utf8');
    entries.push({
      name,
      centralHeaderOffset: offset,
      localHeaderOffset,
      versionMadeBy,
      versionNeeded,
      flags,
      compression,
      dosTime,
      dosDate,
      extraLength,
      commentLength,
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      mode: externalAttributes >>> 16,
      localVersionNeeded: buffer.readUInt16LE(localHeaderOffset + 4),
      localFlags: buffer.readUInt16LE(localHeaderOffset + 6),
      localCompression: buffer.readUInt16LE(localHeaderOffset + 8),
      localDosTime: buffer.readUInt16LE(localHeaderOffset + 10),
      localDosDate: buffer.readUInt16LE(localHeaderOffset + 12),
      localName,
      localExtraLength
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== eocd) throw new Error('ZIP central-directory size does not match its entries');
  return entries;
}

export async function validatePackage(archivePath, stageDir) {
  const archive = readFileSync(archivePath);
  const entries = centralDirectoryEntries(archive);
  entries.forEach(({ name }) => assertArchiveEntry(name));
  const names = entries.map(({ name }) => name);
  if (new Set(names).size !== names.length) throw new Error('archive contains duplicate entries');
  if (!names.includes('manifest.json')) throw new Error('manifest.json is not at the archive root');

  const expected = listRegularFiles(stageDir);
  const actual = entries.map(({ name }) => name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('archive entries are not the exact sorted extension file set');
  }
  const expectedSizes = new Map(expected.map((file) => [file, statSync(join(stageDir, file)).size]));
  for (const entry of entries) {
    if (entry.name.endsWith('/')) throw new Error(`directory entries are not allowed: ${entry.name}`);
    if (entry.versionMadeBy !== CANONICAL_VERSION_MADE_BY) {
      throw new Error(`archive platform metadata is not canonical: ${entry.name}`);
    }
    if (entry.mode !== CANONICAL_FILE_MODE) {
      throw new Error(`archive file mode is not canonical: ${entry.name}`);
    }
    if (entry.flags !== 0 || entry.localFlags !== 0) {
      throw new Error(`archive flags are not canonical: ${entry.name}`);
    }
    const expectedCompression = entry.uncompressedSize === 0 ? STORE_COMPRESSION : DEFLATE_COMPRESSION;
    if (entry.compression !== expectedCompression || entry.localCompression !== expectedCompression) {
      throw new Error(`archive compression is not canonical: ${entry.name}`);
    }
    const expectedVersionNeeded =
      expectedCompression === STORE_COMPRESSION ? STORE_VERSION_NEEDED : DEFLATE_VERSION_NEEDED;
    if (entry.versionNeeded !== expectedVersionNeeded || entry.localVersionNeeded !== expectedVersionNeeded) {
      throw new Error(`archive version-needed is not canonical: ${entry.name}`);
    }
    if (
      entry.dosTime !== CANONICAL_DOS_TIME ||
      entry.localDosTime !== CANONICAL_DOS_TIME ||
      entry.dosDate !== CANONICAL_DOS_DATE ||
      entry.localDosDate !== CANONICAL_DOS_DATE
    ) {
      throw new Error(`archive timestamp is not canonical: ${entry.name}`);
    }
    if (entry.extraLength !== 0 || entry.localExtraLength !== 0 || entry.commentLength !== 0) {
      throw new Error(`archive extra metadata is not canonical: ${entry.name}`);
    }
    if (entry.localName !== entry.name) throw new Error(`local ZIP filename differs: ${entry.name}`);
    if (entry.uncompressedSize !== expectedSizes.get(entry.name)) {
      throw new Error(`archive size differs from stage: ${entry.name}`);
    }
  }

  const zip = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
  for (const file of expected) {
    const archived = await zip.file(file)?.async('nodebuffer');
    if (!archived?.equals(readFileSync(join(stageDir, file)))) {
      throw new Error(`archive content differs from stage: ${file}`);
    }
  }
  if (!archive.equals(await createDeterministicZip(stageDir))) {
    throw new Error('archive bytes are not canonical for the extension stage');
  }
  return createHash('sha256').update(archive).digest('hex');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const archivePath = resolve(process.argv[2]);
    const stageDir = resolve(process.argv[3]);
    const sha256 = await validatePackage(archivePath, stageDir);
    console.log(`package validation passed: ${archivePath}`);
    console.log(`sha256: ${sha256}`);
  } catch (error) {
    console.error(`package validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
