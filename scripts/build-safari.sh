#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  SELECTED_CONVERTER="$(xcrun --find safari-web-extension-converter 2>/dev/null || true)"
  SELECTED_XCODEBUILD="$(xcrun --find xcodebuild 2>/dev/null || true)"
  if [[ ! -x "$SELECTED_CONVERTER" || ! -x "$SELECTED_XCODEBUILD" ]]; then
    export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
  fi
fi
MODE="${1:-}"
MARKETING_VERSION="$(node "$ROOT/scripts/configure-safari-project.mjs" --print-version)"
SAFARI_BUILD_NUMBER="${BYEBAR_SAFARI_BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"
IOS_DEPLOYMENT_TARGET="16.4"
MACOS_DEPLOYMENT_TARGET="13.3"

if [[ "${BYEBAR_SAFARI_RELEASE:-0}" != "0" && "${BYEBAR_SAFARI_RELEASE:-0}" != "1" ]]; then
  echo "BYEBAR_SAFARI_RELEASE must be 0 or 1." >&2
  exit 1
fi
if [[ "${BYEBAR_SAFARI_RELEASE:-0}" == "1" && -z "${BYEBAR_SAFARI_BUILD_NUMBER:-}" ]]; then
  echo "Release builds require an explicit BYEBAR_SAFARI_BUILD_NUMBER." >&2
  exit 1
fi
if [[ ! "$SAFARI_BUILD_NUMBER" =~ ^[1-9][0-9]{0,17}$ ]]; then
  echo "BYEBAR_SAFARI_BUILD_NUMBER must be a positive integer of at most 18 digits." >&2
  exit 1
fi

if [[ -z "$MODE" ]]; then
  exec node "$ROOT/scripts/build-safari.mjs"
fi
if [[ "$MODE" != "--internal-convert" && "$MODE" != "--internal-validate" ]]; then
  echo "Unknown Safari build mode: $MODE" >&2
  exit 1
fi

SAFARI_ROOT="${BYEBAR_SAFARI_OUTPUT:-}"
if [[ -z "$SAFARI_ROOT" ]]; then
  echo "Internal Safari builds require BYEBAR_SAFARI_OUTPUT." >&2
  exit 1
fi
OUT="$SAFARI_ROOT/ByeBar"
PROJECT="$OUT/ByeBar.xcodeproj"

if [[ "$MODE" == "--internal-convert" ]]; then
  STAGE="${BYEBAR_SAFARI_STAGE:-}"
  if [[ -z "$STAGE" ]]; then
    echo "Internal Safari conversion requires BYEBAR_SAFARI_STAGE." >&2
    exit 1
  fi

  CONVERTER="$(xcrun --find safari-web-extension-converter 2>/dev/null || true)"
  if [[ ! -x "$CONVERTER" ]]; then
    echo "Full Xcode is required. Set DEVELOPER_DIR or select Xcode with xcode-select." >&2
    exit 1
  fi

  if [[ -e "$SAFARI_ROOT" || -L "$SAFARI_ROOT" ]]; then
    echo "Safari candidate already exists: $SAFARI_ROOT" >&2
    exit 1
  fi
  mkdir "$SAFARI_ROOT"

  echo "Converting the pinned Safari extension stage..."
  "$CONVERTER" "$STAGE" \
    --project-location "$SAFARI_ROOT" \
    --app-name "ByeBar" \
    --bundle-identifier "dev.neuralnexus.byebar" \
    --swift \
    --copy-resources \
    --no-open \
    --no-prompt \
    --force

  if [[ ! -d "$PROJECT" ]]; then
    echo "Safari conversion failed: expected project not found at $PROJECT" >&2
    exit 1
  fi

  node "$ROOT/scripts/configure-safari-project.mjs" \
    "$PROJECT/project.pbxproj" \
    "$SAFARI_BUILD_NUMBER"
  exit 0
fi

if [[ ! -d "$PROJECT" ]]; then
  echo "Safari validation failed: expected project not found at $PROJECT" >&2
  exit 1
fi
DERIVED_DATA="${BYEBAR_SAFARI_DERIVED_DATA:-}"
if [[ -z "$DERIVED_DATA" ]]; then
  echo "Internal Safari validation requires BYEBAR_SAFARI_DERIVED_DATA." >&2
  exit 1
fi

build_setting_value() {
  local settings="$1"
  local key="$2"
  local line
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    if [[ "$line" == "$key = "* ]]; then
      printf '%s\n' "${line#"$key = "}"
      return 0
    fi
  done <<< "$settings"
  return 1
}

assert_build_setting() {
  local settings="$1"
  local target="$2"
  local configuration="$3"
  local key="$4"
  local expected="$5"
  local actual
  actual="$(build_setting_value "$settings" "$key" || true)"
  if [[ "$actual" != "$expected" ]]; then
    echo "$target $configuration has $key=${actual:-<missing>}; expected $expected" >&2
    exit 1
  fi
}

assert_target_settings() {
  local target="$1"
  local configuration="$2"
  local deployment_key="$3"
  local deployment_target="$4"
  local settings
  settings="$(xcodebuild \
    -project "$PROJECT" \
    -target "$target" \
    -configuration "$configuration" \
    OBJROOT="$DERIVED_DATA/BuildSettings/Intermediates.noindex" \
    SYMROOT="$DERIVED_DATA/BuildSettings/Products" \
    SHARED_PRECOMPS_DIR="$DERIVED_DATA/BuildSettings/PrecompiledHeaders" \
    CLANG_MODULE_CACHE_PATH="$DERIVED_DATA/BuildSettings/ModuleCache.noindex" \
    SWIFT_MODULE_CACHE_PATH="$DERIVED_DATA/BuildSettings/ModuleCache.noindex" \
    -showBuildSettings)"
  assert_build_setting "$settings" "$target" "$configuration" MARKETING_VERSION "$MARKETING_VERSION"
  assert_build_setting "$settings" "$target" "$configuration" CURRENT_PROJECT_VERSION "$SAFARI_BUILD_NUMBER"
  assert_build_setting "$settings" "$target" "$configuration" "$deployment_key" "$deployment_target"
}

for configuration in Debug Release; do
  assert_target_settings "ByeBar (iOS)" "$configuration" IPHONEOS_DEPLOYMENT_TARGET "$IOS_DEPLOYMENT_TARGET"
  assert_target_settings "ByeBar Extension (iOS)" "$configuration" IPHONEOS_DEPLOYMENT_TARGET "$IOS_DEPLOYMENT_TARGET"
  assert_target_settings "ByeBar (macOS)" "$configuration" MACOSX_DEPLOYMENT_TARGET "$MACOS_DEPLOYMENT_TARGET"
  assert_target_settings "ByeBar Extension (macOS)" "$configuration" MACOSX_DEPLOYMENT_TARGET "$MACOS_DEPLOYMENT_TARGET"
done
echo "Verified Safari app and extension settings for Debug and Release."

if [[ "${BYEBAR_SAFARI_VALIDATE:-0}" == "1" ]]; then
  echo "Building the generated macOS Release project without code signing..."
  xcodebuild \
    -project "$PROJECT" \
    -scheme "ByeBar (macOS)" \
    -configuration Release \
    -derivedDataPath "$DERIVED_DATA" \
    CODE_SIGNING_ALLOWED=NO \
    build
  echo "Building the generated iOS Release project without code signing..."
  xcodebuild \
    -project "$PROJECT" \
    -scheme "ByeBar (iOS)" \
    -configuration Release \
    -sdk iphoneos \
    -destination "generic/platform=iOS" \
    -derivedDataPath "$DERIVED_DATA" \
    CODE_SIGNING_ALLOWED=NO \
    build
fi
