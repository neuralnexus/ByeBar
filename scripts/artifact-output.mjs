import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
    await validate(candidatePath, workspace);

    const sha256 = createHash('sha256').update(readFileSync(candidatePath)).digest('hex');
    writeFileSync(candidateChecksum, `${sha256}  ${basename(finalPath)}\n`);
    renameFile(candidateChecksum, checksumPath);
    try {
      renameFile(candidatePath, finalPath);
    } catch (error) {
      rmSync(checksumPath, { force: true });
      throw error;
    }
    return { path: finalPath, checksumPath, sha256 };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
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
    await validate(candidateDirectory, workspace);
    renameDirectory(candidateDirectory, finalDirectory);
    return finalDirectory;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
