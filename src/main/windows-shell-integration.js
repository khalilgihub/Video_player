// src/main/windows-shell-integration.js
// Registers Windows Shell metadata (AppUserModelId, Start Menu shortcut, and HKCU registry keys)
// so that Windows 11 Media Controls (SMTC) display "Hybrid Player" and the official logo
// instead of "Unknown app" and a blank icon.

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const APP_ID = 'com.hybridplayer.app';
const APP_NAME = 'Hybrid Player';

/**
 * Sets up Windows Shell integration (AUMID, Registry, and Start Menu shortcut).
 * Fully non-blocking and safe; errors are caught gracefully.
 *
 * @param {import('electron').App} app - The Electron app instance
 */
function setupWindowsShellIntegration(app) {
  if (process.platform !== 'win32' || !app) return;

  try {
    app.setAppUserModelId(APP_ID);
  } catch (err) {
    // Non-fatal
  }

  // Defer shell registry and shortcut operations to keep startup instantaneous
  setTimeout(() => {
    registerShellMetadata(app);
  }, 1000);
}

function resolveUnpackedPath(targetPath) {
  if (!targetPath) return targetPath;
  if (targetPath.includes('app.asar') && !targetPath.includes('app.asar.unpacked')) {
    return targetPath.replace('app.asar', 'app.asar.unpacked');
  }
  return targetPath;
}

/**
 * Registers HKCU keys and Start Menu shortcut for mpv / Hybrid Player.
 */
function registerShellMetadata(app) {
  try {
    const appDir = path.resolve(__dirname, '../..');
    const icoPath = resolveUnpackedPath(path.join(appDir, 'assets', 'icons', 'icon.ico'));
    const pngPath = resolveUnpackedPath(path.join(appDir, 'assets', 'icons', 'icon.png'));

    if (!fs.existsSync(icoPath)) {
      return;
    }

    const mpvCandidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'mpv', 'mpv.exe') : null,
      path.join(appDir, 'mpv', 'mpv.exe'),
    ].filter(Boolean);
    const mpvPath = mpvCandidates.find((candidate) => fs.existsSync(candidate)) || mpvCandidates[mpvCandidates.length - 1];
    const logoPng = fs.existsSync(pngPath) ? pngPath : icoPath;

    // 1. Configure HKCU registry keys via native reg.exe
    // Windows 11 WinUI 3 XAML requires PNG for IconUri/SmallLogo.
    const regEntries = [
      ['HKCU\\Software\\Classes\\Applications\\mpv.exe', '/v', 'FriendlyAppName', '/d', APP_NAME, '/f'],
      ['HKCU\\Software\\Classes\\Applications\\mpv.exe', '/v', 'ApplicationCompany', '/d', APP_NAME, '/f'],
      ['HKCU\\Software\\Classes\\Applications\\mpv.exe', '/v', 'IconUri', '/d', logoPng, '/f'],
      ['HKCU\\Software\\Classes\\Applications\\mpv.exe\\DefaultIcon', '/ve', '/d', icoPath, '/f'],
      [`HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/v', 'DisplayName', '/d', APP_NAME, '/f'],
      [`HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/v', 'IconUri', '/d', logoPng, '/f'],
      [`HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/v', 'SmallLogo', '/d', logoPng, '/f'],
      [`HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/v', 'Square44x44Logo', '/d', logoPng, '/f'],
      [`HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/v', 'Square150x150Logo', '/d', logoPng, '/f'],
      ['HKCU\\Software\\Classes\\AppUserModelId\\mpv.exe', '/v', 'DisplayName', '/d', APP_NAME, '/f'],
      ['HKCU\\Software\\Classes\\AppUserModelId\\mpv.exe', '/v', 'IconUri', '/d', logoPng, '/f'],
      ['HKCU\\Software\\Classes\\AppUserModelId\\mpv.exe', '/v', 'SmallLogo', '/d', logoPng, '/f'],
    ];

    for (const entry of regEntries) {
      execFile('reg.exe', ['add', ...entry], { windowsHide: true }, () => {});
    }

    // 2. Ensure Start Menu shortcut exists so Windows 11 Shell Link resolver
    // maps mpv.exe and the AUMID to the official app name and icon.
    const appData = process.env.APPDATA;
    if (appData) {
      const programsDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      if (fs.existsSync(programsDir)) {
        const targetPath = fs.existsSync(mpvPath) ? mpvPath : process.execPath;
        const shortcutPath = path.join(programsDir, `${APP_NAME}.lnk`);

        const psScript = [
          '$WshShell = New-Object -ComObject WScript.Shell;',
          `$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}');`,
          `$Shortcut.TargetPath = '${targetPath.replace(/'/g, "''")}';`,
          `$Shortcut.IconLocation = '${icoPath.replace(/'/g, "''")},0';`,
          `$Shortcut.Description = '${APP_NAME.replace(/'/g, "''")}';`,
          '$Shortcut.Save();',
        ].join(' ');

        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psScript],
          { windowsHide: true },
          (error) => {
            if (error) return;
            // Apply explicit AppUserModelId to the Start Menu shortcut
            const setAppIdScript = resolveUnpackedPath(path.join(__dirname, 'set-shortcut-appid.ps1'));
            if (fs.existsSync(setAppIdScript)) {
              execFile(
                'powershell.exe',
                ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', setAppIdScript],
                { windowsHide: true },
                () => {}
              );
            }
          }
        );
      }
    }
  } catch (error) {
    // Fail silently — never disrupt player functionality
  }
}

module.exports = {
  setupWindowsShellIntegration,
  APP_ID,
  APP_NAME,
};
