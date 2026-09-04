// src/main/windows-shell-integration.js
// Registers Windows Shell metadata (AppUserModelId, Start Menu shortcut, and HKCU registry keys)
// so that Windows 11 Media Controls (SMTC) display "Hybrid Player" and the official logo
// instead of "Unknown app" and a blank icon.

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

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

/**
 * Registers HKCU keys and Start Menu shortcut for mpv / Hybrid Player.
 */
function registerShellMetadata(app) {
  try {
    const appDir = path.resolve(__dirname, '../..');
    const icoPath = path.join(appDir, 'assets', 'icons', 'icon.ico');
    const pngPath = path.join(appDir, 'assets', 'icons', 'icon.png');

    if (!fs.existsSync(icoPath)) {
      return;
    }

    const mpvPath = path.join(appDir, 'mpv', 'mpv.exe');
    const logoPng = fs.existsSync(pngPath) ? pngPath : icoPath;

    // 1. Configure HKCU registry keys via native reg.exe
    // Windows 11 WinUI 3 XAML requires PNG for IconUri/SmallLogo.
    const regCommands = [
      `reg.exe add "HKCU\\Software\\Classes\\Applications\\mpv.exe" /v "FriendlyAppName" /d "${APP_NAME}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\Applications\\mpv.exe" /v "ApplicationCompany" /d "${APP_NAME}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\Applications\\mpv.exe" /v "IconUri" /d "${logoPng}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\Applications\\mpv.exe\\DefaultIcon" /ve /d "${icoPath}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}" /v "DisplayName" /d "${APP_NAME}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}" /v "IconUri" /d "${logoPng}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}" /v "SmallLogo" /d "${logoPng}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}" /v "Square44x44Logo" /d "${logoPng}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}" /v "Square150x150Logo" /d "${logoPng}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\AppUserModelId\\mpv.exe" /v "DisplayName" /d "${APP_NAME}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\AppUserModelId\\mpv.exe" /v "IconUri" /d "${logoPng}" /f`,
      `reg.exe add "HKCU\\Software\\Classes\\AppUserModelId\\mpv.exe" /v "SmallLogo" /d "${logoPng}" /f`,
    ];

    const combinedRegCmd = regCommands.join(' && ');
    exec(combinedRegCmd, { windowsHide: true }, () => {
      // Clear ShellExperienceHost icon cache once so Windows 11 reloads the new PNG
      exec('taskkill.exe /F /IM ShellExperienceHost.exe', { windowsHide: true }, () => {});
    });

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
          `$Shortcut.Description = '${APP_NAME}';`,
          '$Shortcut.Save();',
        ].join(' ');

        exec(
          `powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`,
          { windowsHide: true },
          () => {
            // Apply explicit AppUserModelId to the Start Menu shortcut
            const setAppIdScript = path.join(__dirname, 'set-shortcut-appid.ps1');
            if (fs.existsSync(setAppIdScript)) {
              exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${setAppIdScript}"`, { windowsHide: true }, () => {});
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
