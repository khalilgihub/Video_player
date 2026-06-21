const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const productName = 'Hybrid Player';

function candidateExecutables() {
  if (process.env.HYBRID_PACKAGED_APP) {
    return [process.env.HYBRID_PACKAGED_APP];
  }

  if (process.platform === 'win32') {
    return [
      path.join(root, 'dist', 'win-unpacked', `${productName}.exe`),
      path.join(root, 'dist', 'win-unpacked', 'hybrid-player.exe'),
    ];
  }

  if (process.platform === 'darwin') {
    return [
      path.join(root, 'dist', 'mac', `${productName}.app`, 'Contents', 'MacOS', productName),
      path.join(root, 'dist', 'mac-arm64', `${productName}.app`, 'Contents', 'MacOS', productName),
    ];
  }

  return [
    path.join(root, 'dist', 'linux-unpacked', 'hybrid-player'),
    path.join(root, 'dist', 'linux-unpacked', productName),
  ];
}

function findExecutable() {
  const found = candidateExecutables().find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Packaged app executable not found. Run the platform build first or set HYBRID_PACKAGED_APP.');
  }
  return found;
}

async function waitForMpvReady(window, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const ready = await window.evaluate(() => window.hybridAPI?.mpv?.isReady?.());
      if (ready) return true;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (lastError) {
    throw lastError;
  }
  return false;
}

async function main() {
  const executablePath = findExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-packaged-smoke-'));
  let app = null;

  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;

    app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userDataDir}`],
      env,
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('#welcomeScreen').waitFor({ state: 'visible', timeout: 10000 });

    const mpvReady = await waitForMpvReady(window);
    if (!mpvReady) {
      throw new Error('Packaged app launched, but mpv did not become ready.');
    }

    console.log(`Packaged smoke test passed: ${executablePath}`);
  } finally {
    if (app) {
      await app.close();
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
