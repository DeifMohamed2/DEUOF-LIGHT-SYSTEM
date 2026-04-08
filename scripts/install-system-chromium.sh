#!/bin/bash
# Install Chromium from apt (recommended on Ubuntu 24.04+ servers).
# The app auto-detects /usr/bin/chromium and uses it instead of Puppeteer's
# bundled Chrome — avoids missing libasound.so.2 and similar library mismatches.
#
#   sudo bash scripts/install-system-chromium.sh

set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script requires apt (Debian/Ubuntu)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update

if apt-cache show --no-all-versions chromium &>/dev/null 2>&1; then
  apt-get install -y --no-install-recommends chromium
elif apt-cache show --no-all-versions chromium-browser &>/dev/null 2>&1; then
  apt-get install -y --no-install-recommends chromium-browser
else
  echo "No chromium or chromium-browser package found in apt." >&2
  exit 1
fi

echo ""
echo "Chromium installed. The app will use it automatically when /usr/bin/chromium exists."
echo "Optional override: PUPPETE_EXECUTABLE_PATH=/usr/bin/chromium"
if command -v chromium &>/dev/null; then
  echo "Binary: $(command -v chromium)"
fi
if command -v chromium-browser &>/dev/null; then
  echo "Binary: $(command -v chromium-browser)"
fi
