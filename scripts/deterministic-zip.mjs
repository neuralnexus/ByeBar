import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import JSZip from 'jszip';

export const CANONICAL_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');
export const CANONICAL_FILE_MODE = 0o100644;

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
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
    comment: ''
  });
}

export async function writeDeterministicZip(root, outputPath) {
  const archive = await createDeterministicZip(root);
  writeFileSync(outputPath, archive, { mode: 0o644 });
  return archive;
}
