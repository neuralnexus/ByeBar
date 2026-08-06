import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildValidatedDirectory } from './artifact-output.mjs';
import { safariMarketingVersion, validateSafariBuildNumber } from './configure-safari-project.mjs';
import { projectRoot, stageExtension } from './stage-extension.mjs';

const safariScript = join(dirname(fileURLToPath(import.meta.url)), 'build-safari.sh');

function runSafariShell(mode, environment) {
  execFileSync('bash', [safariScript, mode], {
    env: { ...process.env, ...environment },
    stdio: 'inherit'
  });
}

export async function buildSafariProject(options = {}) {
  const root = options.root || projectRoot;
  const finalDirectory = join(root, 'safari');
  const consumeStage = options.consumeStage || ((consume) => stageExtension('safari', consume));
  const convert =
    options.convert ||
    ((stageDirectory, candidateDirectory) =>
      runSafariShell('--internal-convert', {
        BYEBAR_SAFARI_STAGE: stageDirectory,
        BYEBAR_SAFARI_OUTPUT: candidateDirectory
      }));
  const validate =
    options.validate ||
    ((candidateDirectory, workspace) =>
      runSafariShell('--internal-validate', {
        BYEBAR_SAFARI_DERIVED_DATA: join(workspace, 'DerivedData'),
        BYEBAR_SAFARI_OUTPUT: candidateDirectory
      }));

  await buildValidatedDirectory(finalDirectory, {
    lock: options.lock,
    build: (candidateDirectory, workspace) =>
      consumeStage((stageDirectory) => convert(stageDirectory, candidateDirectory, workspace)),
    validate
  });
  return finalDirectory;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const finalDirectory = await buildSafariProject();
    const marketingVersion = safariMarketingVersion();
    const buildNumber = validateSafariBuildNumber(
      process.env.BYEBAR_SAFARI_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || '1'
    );
    const project = join(finalDirectory, 'ByeBar', 'ByeBar.xcodeproj');
    console.log(`Safari project created at: ${join(finalDirectory, 'ByeBar')}`);
    console.log(`Marketing version: ${marketingVersion}; build number: ${buildNumber}`);
    console.log(`Open ${project} in Xcode to run the macOS or iOS scheme and create signed archives.`);
  } catch (error) {
    console.error(`Safari build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
