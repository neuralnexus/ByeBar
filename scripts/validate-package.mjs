import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

export function listRegularFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`symlink is not allowed: ${relative(root, fullPath)}`);
      if (stat.isDirectory()) visit(fullPath);
      else if (stat.isFile()) files.push(relative(root, fullPath).split('\\').join('/'));
      else throw new Error(`unsupported package entry: ${relative(root, fullPath)}`);
    }
  }
  visit(root);
  return files.sort();
}

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

function centralDirectoryEntries(buffer) {
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
  const count = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new Error('ZIP64 packages are not supported');

  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('invalid ZIP central-directory entry');
    const flags = buffer.readUInt16LE(offset + 8);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (flags & 1) throw new Error(`encrypted archive entry is not allowed: ${name}`);
    entries.push({
      name,
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      mode: externalAttributes >>> 16
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function validatePackage(archivePath, stageDir) {
  const archive = readFileSync(archivePath);
  const entries = centralDirectoryEntries(archive);
  entries.forEach(({ name }) => assertArchiveEntry(name));
  const names = entries.map(({ name }) => name);
  if (new Set(names).size !== names.length) throw new Error('archive contains duplicate entries');
  if (!names.includes('manifest.json')) throw new Error('manifest.json is not at the archive root');
  for (const entry of entries) {
    if ((entry.mode & 0o170000) === 0o120000) throw new Error(`archive contains a symlink: ${entry.name}`);
  }

  const expected = listRegularFiles(stageDir);
  const actual = entries
    .filter(({ name }) => !name.endsWith('/'))
    .map(({ name }) => name)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('archive entries do not exactly match the extension stage');
  }
  const expectedSizes = new Map(expected.map((file) => [file, statSync(join(stageDir, file)).size]));
  for (const entry of entries) {
    if (!entry.name.endsWith('/') && entry.uncompressedSize !== expectedSizes.get(entry.name)) {
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
