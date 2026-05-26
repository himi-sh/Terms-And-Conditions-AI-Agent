#!/usr/bin/env bash
#
# Converts the shared Chrome MV3 source into a Safari Web Extension Xcode project.
#
# REQUIREMENTS: macOS with Xcode + Command Line Tools installed.
# This cannot run on Windows/Linux — safari-web-extension-converter ships with Xcode.
#
# Usage:
#   ./scripts/build-safari.sh [output-dir]
#
# Default output dir: ./safari (gitignored).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/safari}"

APP_NAME="Terms and Conditions Agent"
BUNDLE_ID="com.mission-embedded.tca"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found. Install Xcode + Command Line Tools (this step is macOS-only)." >&2
  exit 1
fi

# Stage a clean folder containing ONLY the extension files (manifest.json + src/),
# so the converter doesn't pull in .git, docs, scripts, or your local config.js.
STAGE="$(mktemp -d)/tca-ext"
mkdir -p "$STAGE"
cp "$ROOT/manifest.json" "$STAGE/"
cp -R "$ROOT/src" "$STAGE/"

# Do NOT ship your personal OpenAI key inside the app bundle — users enter their own
# in the panel settings at runtime. Drop the gitignored config.js from the staged copy.
rm -f "$STAGE/src/shared/config.js"

echo "Staged extension at: $STAGE"
echo "Generating Xcode project at: $OUT"

rm -rf "$OUT"
xcrun safari-web-extension-converter "$STAGE" \
  --project-location "$OUT" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --no-open \
  --force

cat <<EOF

Done. Next steps (in Xcode):
  1. open "$OUT/Terms and Conditions Agent/Terms and Conditions Agent.xcodeproj"
  2. Select the macOS app target and press Run (Cmd+R) to build + launch the host app.
  3. Safari > Settings > Advanced > enable "Show features for web developers".
  4. Safari > Settings > Developer > enable "Allow unsigned extensions".
  5. Safari > Settings > Extensions > enable "Terms and Conditions Agent" and grant
     "Allow on Every Website" so it can fetch policy documents.

Notes:
  - The converter will WARN about the unsupported "sidePanel" permission / "side_panel"
    key — that is expected and harmless. The extension opens its panel in a tab on Safari.
  - "Allow unsigned extensions" resets each time Safari restarts. For a persistent build,
    sign the app with your Apple Developer team in the Xcode target's Signing settings.
EOF
