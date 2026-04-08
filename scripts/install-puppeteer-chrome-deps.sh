#!/usr/bin/env bash
# Install OS libraries required by Puppeteer's bundled Chromium on Debian/Ubuntu.
# Run on the server or inside the image as root, e.g.:
#   chmod +x scripts/install-puppeteer-chrome-deps.sh && sudo ./scripts/install-puppeteer-chrome-deps.sh
#
# Fixes errors like: libasound.so.2: cannot open shared object file

set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script is for apt-based systems (Debian/Ubuntu)." >&2
  echo "Alpine: apk add --no-cache chromium && export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libexpat1 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  wget \
  xdg-utils

echo "Done. Restart the Node app and try PDF download again."
