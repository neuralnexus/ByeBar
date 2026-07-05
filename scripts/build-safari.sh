#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/safari/ByeBar"
CONVERTER="$(xcrun --find safari-web-extension-converter)"

echo "Validating extension..."
node "$ROOT/scripts/validate-manifest.mjs"

if [[ ! -x "$CONVERTER" ]]; then
  echo "safari-web-extension-converter not found. Install Xcode command line tools." >&2
  exit 1
fi

rm -rf "$ROOT/safari"
mkdir -p "$ROOT/safari"

echo "Converting to Safari Web Extension..."
"$CONVERTER" "$ROOT" \
  --project-location "$ROOT/safari" \
  --app-name "ByeBar" \
  --bundle-identifier "dev.neuralnexus.byebar" \
  --swift \
  --copy-resources \
  --force

echo "Safari project created at: $OUT"
echo "Open $OUT/ByeBar.xcodeproj in Xcode, then:"
echo "  1. Select the ByeBar (macOS) scheme and Run to test in Safari."
echo "  2. Select the ByeBar (iOS) scheme to run on iPhone/iPad simulator or device."
echo "  3. Archive for distribution via App Store Connect (macOS + iOS extensions)."