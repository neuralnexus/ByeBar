import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SAFARI_IOS_DEPLOYMENT_TARGET = '16.4';
export const SAFARI_MACOS_DEPLOYMENT_TARGET = '13.3';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function safariMarketingVersion(root = projectRoot) {
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const manifestVersion = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
  if (packageVersion !== manifestVersion) {
    throw new Error(
      `Safari marketing version mismatch: package.json=${packageVersion}, manifest.json=${manifestVersion}`
    );
  }
  if (!/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,2}$/.test(packageVersion)) {
    throw new Error(`Safari marketing version is not App Store compatible: ${packageVersion}`);
  }
  return packageVersion;
}

export function validateSafariBuildNumber(buildNumber) {
  const value = String(buildNumber ?? '');
  if (!/^[1-9][0-9]{0,17}$/.test(value)) {
    throw new Error('Safari build number must be a positive integer of at most 18 digits');
  }
  return value;
}

function replaceBuildSetting(source, key, value, minimumCount) {
  let count = 0;
  const pattern = new RegExp(`^([ \\t]*${key}[ \\t]*=[ \\t]*)[^;\\n]+;`, 'gm');
  const configured = source.replace(pattern, (_, prefix) => {
    count += 1;
    return `${prefix}${value};`;
  });
  if (count < minimumCount) {
    throw new Error(
      `generated Safari project has ${count} ${key} settings; expected at least ${minimumCount}`
    );
  }
  return configured;
}

export function configureSafariProjectText(
  source,
  {
    marketingVersion,
    buildNumber,
    iosDeploymentTarget = SAFARI_IOS_DEPLOYMENT_TARGET,
    macosDeploymentTarget = SAFARI_MACOS_DEPLOYMENT_TARGET
  }
) {
  const version = String(marketingVersion);
  if (!/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,2}$/.test(version)) {
    throw new Error(`Safari marketing version is not App Store compatible: ${version}`);
  }
  const build = validateSafariBuildNumber(buildNumber);
  let configured = replaceBuildSetting(source, 'MARKETING_VERSION', version, 8);
  configured = replaceBuildSetting(configured, 'CURRENT_PROJECT_VERSION', build, 8);
  configured = replaceBuildSetting(configured, 'IPHONEOS_DEPLOYMENT_TARGET', iosDeploymentTarget, 4);
  return replaceBuildSetting(configured, 'MACOSX_DEPLOYMENT_TARGET', macosDeploymentTarget, 4);
}

export function configureSafariProject(projectFile, buildNumber, root = projectRoot) {
  const marketingVersion = safariMarketingVersion(root);
  const configured = configureSafariProjectText(readFileSync(projectFile, 'utf8'), {
    marketingVersion,
    buildNumber
  });
  writeFileSync(projectFile, configured);
  return { marketingVersion, buildNumber: validateSafariBuildNumber(buildNumber) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    if (process.argv[2] === '--print-version') {
      console.log(safariMarketingVersion());
    } else {
      const projectFile = resolve(process.argv[2]);
      const result = configureSafariProject(projectFile, process.argv[3]);
      console.log(
        `configured Safari project: marketing ${result.marketingVersion}, build ${result.buildNumber}`
      );
    }
  } catch (error) {
    console.error(`Safari project configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
