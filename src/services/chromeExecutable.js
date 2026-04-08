const fs = require('fs');

/**
 * On Linux servers, Puppeteer's bundled Chromium often misses system libraries (e.g. libasound).
 * Prefer Chrome/Chromium installed with apt — it links against the right .so files.
 *
 * 1) PUPPETE_EXECUTABLE_PATH or PUPPETEER_EXECUTABLE_PATH if set and the file exists
 * 2) Common paths for distro packages (chromium, google-chrome-stable, snap)
 * 3) undefined → Puppeteer uses its downloaded Chrome (OK for local macOS/Windows dev)
 */
function resolveChromeExecutablePath() {
  const fromEnv = (
    process.env.PUPPETE_EXECUTABLE_PATH ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    ''
  ).trim();
  if (fromEnv) {
    try {
      if (fs.existsSync(fromEnv)) return fromEnv;
    } catch (_) {
      /* ignore */
    }
  }

  if (process.platform === 'darwin' || process.platform === 'win32') {
    return undefined;
  }

  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {
      /* ignore */
    }
  }
  return undefined;
}

function puppeteerLaunchOptions() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
  ];
  const opts = {
    headless: true,
    args,
  };
  const exe = resolveChromeExecutablePath();
  if (exe) opts.executablePath = exe;
  return opts;
}

module.exports = {
  resolveChromeExecutablePath,
  puppeteerLaunchOptions,
};
