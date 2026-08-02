#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/dist/stage/safari"
OUT="$ROOT/safari/ByeBar"

CONVERTER="$(xcrun --find safari-web-extension-converter 2>/dev/null || true)"
if [[ ! -x "$CONVERTER" && -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
  CONVERTER="$(xcrun --find safari-web-extension-converter 2>/dev/null || true)"
fi
if [[ ! -x "$CONVERTER" ]]; then
  echo "Full Xcode is required. Set DEVELOPER_DIR or select Xcode with xcode-select." >&2
  exit 1
fi

node "$ROOT/scripts/build-runtime.mjs"
node "$ROOT/scripts/generate-icons.mjs"
node "$ROOT/scripts/stage-extension.mjs" safari

rm -rf "$ROOT/safari"
mkdir -p "$ROOT/safari"

echo "Converting the validated Safari extension stage..."
"$CONVERTER" "$STAGE" \
  --project-location "$ROOT/safari" \
  --app-name "ByeBar" \
  --bundle-identifier "dev.neuralnexus.byebar" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

PROJECT="$OUT/ByeBar.xcodeproj"
if [[ ! -d "$PROJECT" ]]; then
  echo "Safari conversion failed: expected project not found at $PROJECT" >&2
  exit 1
fi

if [[ "${BYEBAR_SAFARI_VALIDATE:-0}" == "1" ]]; then
  echo "Building the generated macOS project without code signing..."
  xcodebuild \
    -project "$PROJECT" \
    -scheme "ByeBar (macOS)" \
    -configuration Debug \
    -derivedDataPath "$ROOT/safari/DerivedData" \
    CODE_SIGNING_ALLOWED=NO \
    build
  echo "Building the generated iOS project without code signing..."
  xcodebuild \
    -project "$PROJECT" \
    -scheme "ByeBar (iOS)" \
    -configuration Debug \
    -sdk iphoneos \
    -destination "generic/platform=iOS" \
    -derivedDataPath "$ROOT/safari/DerivedData" \
    CODE_SIGNING_ALLOWED=NO \
    build
fi

echo "Safari project created at: $OUT"
echo "Open $PROJECT in Xcode to run the macOS or iOS scheme and create signed archives."
