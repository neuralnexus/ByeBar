import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import JSZip from 'jszip';

export const CANONICAL_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');
export const CANONICAL_FILE_MODE = 0o100644;

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const STORE_COMPRESSION = 0;
const DEFLATE_COMPRESSION = 8;

function versionNeededFor(compression) {
  if (compression === STORE_COMPRESSION) return 10;
  if (compression === DEFLATE_COMPRESSION) return 20;
  throw new Error(`unsupported deterministic ZIP compression method: ${compression}`);
}

function normalizeVersionNeeded(archive) {
  const eocd = archive.length - 22;
  if (eocd < 0 || archive.readUInt32LE(eocd) !== END_OF_CENTRAL_DIRECTORY) {
    throw new Error('generated ZIP end-of-central-directory record is invalid');
  }
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > eocd || archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error('generated ZIP central-directory entry is invalid');
    }
    const compression = archive.readUInt16LE(offset + 10);
    const localOffset = archive.readUInt32LE(offset + 42);
    if (
      localOffset + 30 > offset ||
      archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER ||
      archive.readUInt16LE(localOffset + 8) !== compression
    ) {
      throw new Error('generated ZIP local header is invalid');
    }

    const versionNeeded = versionNeededFor(compression);
    archive.writeUInt16LE(versionNeeded, offset + 6);
    archive.writeUInt16LE(versionNeeded, localOffset + 4);
    offset +=
      46 +
      archive.readUInt16LE(offset + 28) +
      archive.readUInt16LE(offset + 30) +
      archive.readUInt16LE(offset + 32);
  }
  if (offset !== eocd) throw new Error('generated ZIP central-directory bounds are invalid');
  return archive;
}

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

export async function createDeterministicZip(root) {
  const zip = new JSZip();
  for (const file of listRegularFiles(root)) {
    zip.file(file, readFileSync(join(root, file)), {
      binary: true,
      createFolders: false,
      date: CANONICAL_ZIP_DATE,
      unixPermissions: CANONICAL_FILE_MODE
    });
  }
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
    comment: ''
  });
  return normalizeVersionNeeded(archive);
}

export async function writeDeterministicZip(root, outputPath) {
  const archive = await createDeterministicZip(root);
  writeFileSync(outputPath, archive, { mode: 0o644 });
  return archive;
}
