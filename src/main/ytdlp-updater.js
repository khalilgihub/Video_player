const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { app, ipcMain } = require('electron');
const { resolveYtDlpBinary } = require('./binary-resolver');

let isUpdating = false;

function getYtDlpPath() {
  return resolveYtDlpBinary(process.resourcesPath, process.execPath, __dirname, {
    allowPathLookup: !app.isPackaged
  });
}

function getYtDlpVersion(binPath = null) {
  const binary = binPath || getYtDlpPath();
  if (!binary) return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(binary, ['--version'], { windowsHide: true, timeout: 10000 }, (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function getLatestYtDlpReleaseTag() {
  try {
    const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest', {
      redirect: 'manual',
      headers: { 'User-Agent': 'HybridPlayer' }
    });
    const location = res.headers.get('location');
    if (location) {
      const match = location.match(/tag\/([^/?#]+)/);
      if (match && match[1]) {
        return match[1].replace(/^v/, '');
      }
    }
  } catch (_) {}

  try {
    const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'User-Agent': 'HybridPlayer' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.tag_name) {
        return String(data.tag_name).replace(/^v/, '');
      }
    }
  } catch (_) {}

  return null;
}

async function checkForYtDlpUpdate() {
  const binary = getYtDlpPath();
  if (!binary) {
    return {
      available: false,
      currentVersion: null,
      latestVersion: null,
      error: 'yt-dlp executable not found'
    };
  }

  const [currentVersion, latestVersion] = await Promise.all([
    getYtDlpVersion(binary),
    getLatestYtDlpReleaseTag()
  ]);

  if (!currentVersion) {
    return {
      available: false,
      currentVersion: null,
      latestVersion: latestVersion || null,
      error: 'Could not determine installed yt-dlp version'
    };
  }

  const hasUpdate = Boolean(latestVersion && currentVersion !== latestVersion);

  return {
    available: hasUpdate,
    currentVersion,
    latestVersion: latestVersion || currentVersion,
    error: null
  };
}

async function runYtDlpSelfUpdate() {
  if (isUpdating) {
    return { success: false, error: 'Update is already in progress' };
  }

  const binary = getYtDlpPath();
  if (!binary) {
    return { success: false, error: 'yt-dlp executable not found' };
  }

  isUpdating = true;
  try {
    const oldVersion = await getYtDlpVersion(binary);

    const updateOutput = await new Promise((resolve, reject) => {
      execFile(binary, ['-U'], { windowsHide: true, timeout: 90000 }, (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim();
          reject(new Error(detail || 'Update command failed'));
          return;
        }
        resolve(String(stdout || '').trim());
      });
    });

    const newVersion = await getYtDlpVersion(binary);

    // Sync to unpacked dist in development if present
    try {
      const unpackedCandidate = path.join(__dirname, '../../dist/win-unpacked/resources/mpv/yt-dlp.exe');
      if (fs.existsSync(unpackedCandidate) && fs.existsSync(binary)) {
        fs.copyFileSync(binary, unpackedCandidate);
      }
    } catch (_) {}

    return {
      success: true,
      oldVersion,
      newVersion: newVersion || oldVersion,
      message: updateOutput || 'Update completed successfully'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Failed to update yt-dlp'
    };
  } finally {
    isUpdating = false;
  }
}

function setupYtDlpUpdaterIpc(win) {
  ipcMain.handle('ytdlp:get-status', async () => {
    const binary = getYtDlpPath();
    const currentVersion = await getYtDlpVersion(binary);
    return {
      installed: Boolean(binary),
      path: binary,
      currentVersion,
      isUpdating
    };
  });

  ipcMain.handle('ytdlp:check-update', async () => {
    return await checkForYtDlpUpdate();
  });

  ipcMain.handle('ytdlp:update', async () => {
    const result = await runYtDlpSelfUpdate();
    if (result.success && win && !win.isDestroyed()) {
      win.webContents.send('ytdlp:updated', result);
    }
    return result;
  });
}

function startYtDlpBackgroundCheck(win, { delayMs = 6000, shouldCheck = null } = {}) {
  setTimeout(async () => {
    try {
      if (!win || win.isDestroyed()) return;
      if (typeof shouldCheck === 'function' && !shouldCheck()) return;
      const info = await checkForYtDlpUpdate();
      if (info && info.available && win && !win.isDestroyed()) {
        win.webContents.send('ytdlp:update-available', info);
      }
    } catch (_) {}
  }, delayMs);
}

module.exports = {
  getYtDlpPath,
  getYtDlpVersion,
  getLatestYtDlpReleaseTag,
  checkForYtDlpUpdate,
  runYtDlpSelfUpdate,
  setupYtDlpUpdaterIpc,
  startYtDlpBackgroundCheck
};
