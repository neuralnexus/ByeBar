import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export async function buildValidatedFile(finalPath, { build, validate, renameFile = renameSync }) {
  const parent = dirname(finalPath);
  const checksumPath = `${finalPath}.sha256`;
  mkdirSync(parent, { recursive: true });
  rmSync(finalPath, { force: true });
  rmSync(checksumPath, { force: true });

  const workspace = mkdtempSync(join(parent, `.${basename(finalPath)}-`));
  const candidatePath = join(workspace, basename(finalPath));
  const candidateChecksum = `${candidatePath}.sha256`;
  try {
    await build(candidatePath, workspace);
    if (!existsSync(candidatePath)) throw new Error(`artifact build did not produce ${basename(finalPath)}`);
    const candidateStat = lstatSync(candidatePath);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
      throw new Error(`artifact candidate is not a regular file: ${basename(finalPath)}`);
    }
    chmodSync(candidatePath, 0o644);
    await validate(candidatePath, workspace);

    const sha256 = createHash('sha256').update(readFileSync(candidatePath)).digest('hex');
    writeFileSync(candidateChecksum, `${sha256}  ${basename(finalPath)}\n`, { mode: 0o644 });
    chmodSync(candidateChecksum, 0o644);
    renameFile(candidatePath, finalPath);
    try {
      renameFile(candidateChecksum, checksumPath);
    } catch (error) {
      rmSync(finalPath, { force: true });
      rmSync(checksumPath, { force: true });
      throw error;
    }
    return { path: finalPath, checksumPath, sha256 };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
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

export async function buildValidatedDirectory(
  finalDirectory,
  { build, validate, renameDirectory = renameSync }
) {
  const parent = dirname(finalDirectory);
  mkdirSync(parent, { recursive: true });
  rmSync(finalDirectory, { recursive: true, force: true });

  const workspace = mkdtempSync(join(parent, `.${basename(finalDirectory)}-`));
  const candidateDirectory = join(workspace, basename(finalDirectory));
  try {
    await build(candidateDirectory, workspace);
    normalizeDirectoryTree(candidateDirectory);
    await validate(candidateDirectory, workspace);
    renameDirectory(candidateDirectory, finalDirectory);
    return finalDirectory;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
