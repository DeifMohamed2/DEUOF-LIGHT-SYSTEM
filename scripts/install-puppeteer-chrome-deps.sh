#!/bin/bash
# Install OS libraries required by Puppeteer's bundled Chromium on Debian/Ubuntu.
#
# Ubuntu 24.04+ renamed many packages to *t64 (e.g. libasound2 → libasound2t64).
# This script picks the name that exists in apt.
#
# Prefer this (works even if the file is not chmod +x):
#   sudo bash scripts/install-puppeteer-chrome-deps.sh
#
# Easier on servers: install system Chromium instead — full dependency chain from apt:
#   sudo bash scripts/install-system-chromium.sh
#
# Fixes errors like: libasound.so.2: cannot open shared object file

set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script is for apt-based systems (Debian/Ubuntu)." >&2
  echo "Alpine: apk add --no-cache chromium && export PUPPETE_EXECUTABLE_PATH=/usr/bin/chromium" >&2
  exit 1
fi

add_one_of() {
  local p
  for p in "$@"; do
    if apt-cache show --no-all-versions "$p" &>/dev/null 2>&1; then
      PKGS+=("$p")
      return 0
    fi
  done
  echo "Warning: none of: $* (skipping)" >&2
  return 1
}

export DEBIAN_FRONTEND=noninteractive
apt-get update

PKGS=(
  ca-certificates
  fonts-liberation
  libcairo2
  libdbus-1-3
  libdrm2
  libexpat1
  libgbm1
  libnspr4
  libnss3
  libpango-1.0-0
  libpangocairo-1.0-0
  libx11-6
  libx11-xcb1
  libxcb1
  libxcomposite1
  libxdamage1
  libxext6
  libxfixes3
  libxkbcommon0
  libxrandr2
  wget
  xdg-utils
)

# Ubuntu 24.04+ / Debian trixie: prefer t64 package names when present
add_one_of libasound2t64 libasound2 || true
add_one_of libatk-bridge2.0-0t64 libatk-bridge2.0-0 || true
add_one_of libatk1.0-0t64 libatk1.0-0 || true
add_one_of libcups2t64 libcups2 || true
add_one_of libglib2.0-0t64 libglib2.0-0 || true
add_one_of libgtk-3-0t64 libgtk-3-0 || true

apt-get install -y --no-install-recommends "${PKGS[@]}"

echo "Done. Restart the Node app and try PDF again."
echo "If it still fails, run: sudo bash scripts/install-system-chromium.sh"
