/**
 * Native DWM Window Style Enabler for Windows Frameless / Transparent Windows
 * Invokes the precompiled native helper binary or PowerShell fallback to set
 * Win32 styles (WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX) and enable
 * hardware-accelerated DWM taskbar zoom/scale animations without white flashes.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let cachedHelperPath = undefined;

function resolveDwmHelperBinary() {
  if (cachedHelperPath !== undefined) {
    return cachedHelperPath;
  }

  const candidates = [
    path.join(__dirname, 'bin', 'hybrid-dwm-helper.exe').replace('app.asar', 'app.asar.unpacked'),
    path.join(__dirname, 'bin', 'hybrid-dwm-helper.exe'),
    path.join(__dirname, '..', '..', 'src', 'main', 'bin', 'hybrid-dwm-helper.exe'),
    path.join(process.resourcesPath || '', 'bin', 'hybrid-dwm-helper.exe'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'main', 'bin', 'hybrid-dwm-helper.exe'),
    path.join(path.dirname(process.execPath), 'resources', 'bin', 'hybrid-dwm-helper.exe'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cachedHelperPath = p;
        return p;
      }
    } catch {}
  }

  cachedHelperPath = null;
  return null;
}

/**
 * Apply native DWM styles to an Electron BrowserWindow instance asynchronously.
 * @param {import('electron').BrowserWindow} win
 */
function applyNativeDwmWindowStyles(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;

  const handleBuffer = win.getNativeWindowHandle();
  if (!handleBuffer || !Buffer.isBuffer(handleBuffer)) return;

  let hwndDecimal = 0n;
  try {
    if (handleBuffer.length === 8) {
      hwndDecimal = handleBuffer.readBigUInt64LE(0);
    } else if (handleBuffer.length === 4) {
      hwndDecimal = BigInt(handleBuffer.readUInt32LE(0));
    }
  } catch (err) {
    console.error('[native-dwm] failed to parse HWND buffer:', err?.message || err);
    return;
  }

  if (!hwndDecimal || hwndDecimal <= 0n) return;

  const hwndStr = '0x' + hwndDecimal.toString(16);
  const helperBin = resolveDwmHelperBinary();

  if (helperBin) {
    execFile(helperBin, [hwndStr], { windowsHide: true, timeout: 2000 }, (err) => {
      if (err) {
        console.error('[native-dwm] binary helper error:', err?.message || err);
      }
    });
    return;
  }

  // Fallback via PowerShell if binary not present
  try {
    const psScript = [
      '$signature = @\'',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class Win32Dwm {',
      '  [DllImport("user32.dll")]',
      '  public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);',
      '  [DllImport("user32.dll")]',
      '  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);',
      '  [DllImport("user32.dll")]',
      '  public static extern IntPtr SetClassLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);',
      '  [DllImport("gdi32.dll")]',
      '  public static extern IntPtr GetStockObject(int fnObject);',
      '  [DllImport("user32.dll")]',
      '  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
      '  [DllImport("dwmapi.dll")]',
      '  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);',
      '}',
      '\'@',
      'Add-Type -TypeDefinition $signature',
      `$hwnd = [IntPtr]::new(${hwndDecimal})`,
      '$WS_CAPTION = 0x00C00000L',
      '$WS_MINIMIZEBOX = 0x00020000L',
      '$WS_MAXIMIZEBOX = 0x00010000L',
      '$curStyle = [Win32Dwm]::GetWindowLongPtr($hwnd, -16).ToInt64()',
      '$newStyle = ($curStyle -band (-bnot 0x00040000L)) -bor ($WS_CAPTION -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX)',
      '[Win32Dwm]::SetWindowLongPtr($hwnd, -16, [IntPtr]::new($newStyle))',
      '$blackBrush = [Win32Dwm]::GetStockObject(4)',
      '[Win32Dwm]::SetClassLongPtr($hwnd, -10, $blackBrush)',
      '$forceDisabled = 0',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 3, [ref]$forceDisabled, 4)',
      '$ncPolicy = 1',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 2, [ref]$ncPolicy, 4)',
      '$darkMode = 1',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 20, [ref]$darkMode, 4)',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 19, [ref]$darkMode, 4)',
      '$cornerPref = 1',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 33, [ref]$cornerPref, 4)',
      '$noBorder = [int]-2',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 34, [ref]$noBorder, 4)',
      '$blackColor = 0',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 35, [ref]$blackColor, 4)',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 36, [ref]$blackColor, 4)',
      '$backdropNone = 1',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 38, [ref]$backdropNone, 4)',
      '[Win32Dwm]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, 0x4237)',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 33, [ref]$cornerPref, 4)',
    ].join('\n');

    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      windowsHide: true,
      timeout: 3000
    }, () => {});
  } catch (psErr) {
    console.error('[native-dwm] PowerShell fallback warning:', psErr?.message || psErr);
  }
}

function scheduleNativeDwmWindowStyles(win, delays = [0, 80, 200, 350]) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  for (const delay of delays) {
    if (delay === 0) {
      applyNativeDwmWindowStyles(win);
    } else {
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        applyNativeDwmWindowStyles(win);
      }, delay);
    }
  }
}

module.exports = {
  applyNativeDwmWindowStyles,
  scheduleNativeDwmWindowStyles,
  resolveDwmHelperBinary,
};
