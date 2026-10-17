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

let koffiBindings = null;

function getKoffiBindings() {
  if (koffiBindings !== null) return koffiBindings;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const gdi32 = koffi.load('gdi32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    const EnumChildProc = koffi.proto('bool EnumChildProc(intptr_t childHwnd, intptr_t lParam)');
    koffiBindings = {
      GetWindowLongPtr: user32.func('GetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int']),
      SetWindowLongPtr: user32.func('SetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int', 'intptr_t']),
      SetClassLongPtr: user32.func('SetClassLongPtrW', 'intptr_t', ['intptr_t', 'int', 'intptr_t']),
      GetStockObject: gdi32.func('GetStockObject', 'intptr_t', ['int']),
      SetWindowPos: user32.func('SetWindowPos', 'bool', ['intptr_t', 'intptr_t', 'int', 'int', 'int', 'int', 'uint']),
      DwmSetWindowAttribute: dwmapi.func('DwmSetWindowAttribute', 'int', ['intptr_t', 'uint32', 'void *', 'uint32']),
      DwmExtendFrameIntoClientArea: dwmapi.func('DwmExtendFrameIntoClientArea', 'int', ['intptr_t', 'void *']),
      EnumChildWindows: user32.func('EnumChildWindows', 'bool', ['intptr_t', 'void *', 'intptr_t']),
      EnumChildProc,
    };
  } catch (err) {
    koffiBindings = false;
  }
  return koffiBindings;
}

/**
 * Apply native DWM styles to an Electron BrowserWindow instance asynchronously.
 * @param {import('electron').BrowserWindow} win
 */
function applyNativeDwmWindowStyles(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  // If window is actively being resized by the user, avoid SWP_FRAMECHANGED / style updates that tear backbuffers
  if (win.__hybridIsResizing) return;
  // Fullscreen windows must remain pure borderless popups and must never have WS_CAPTION applied.
  if (win.isFullScreen() || win.__hybridFullscreenState) return;

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

  // Direct synchronous in-process application via koffi (zero delay, zero flicker)
  const bindings = getKoffiBindings();
  if (bindings) {
    try {
      const hwnd = hwndDecimal;
      const WS_CAPTION = 0x00C00000n;
      const WS_THICKFRAME = 0x00040000n;
      const WS_MINIMIZEBOX = 0x00020000n;
      const WS_MAXIMIZEBOX = 0x00010000n;
      const WS_CLIPCHILDREN = 0x02000000n;
      const WS_CLIPSIBLINGS = 0x04000000n;

      const curStyle = BigInt(bindings.GetWindowLongPtr(hwnd, -16));
      const newStyle = curStyle | WS_THICKFRAME | WS_CAPTION | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
      bindings.SetWindowLongPtr(hwnd, -16, newStyle);

      // NULL_BRUSH (stock object 5) ensures Windows GDI never paints black or white over the window during move/drag
      const nullBrush = bindings.GetStockObject(5);
      bindings.SetClassLongPtr(hwnd, -10, nullBrush);

      // Style child surfaces (Intermediate D3D Window, Chrome_RenderWidgetHostHWND)
      // with WS_CLIPCHILDREN | WS_CLIPSIBLINGS and NULL_BRUSH to prevent GDI from erasing
      // over hardware-rendered DirectX swapchains during window resizing.
      if (typeof bindings.EnumChildWindows === 'function' && bindings.EnumChildProc) {
        const koffi = require('koffi');
        const childCallback = koffi.register((childHwnd) => {
          try {
            const cStyle = BigInt(bindings.GetWindowLongPtr(childHwnd, -16));
            bindings.SetWindowLongPtr(childHwnd, -16, cStyle | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
            bindings.SetClassLongPtr(childHwnd, -10, nullBrush);
          } catch (_) {}
          return true;
        }, koffi.pointer(bindings.EnumChildProc));
        try {
          bindings.EnumChildWindows(hwnd, childCallback, 0n);
        } finally {
          koffi.unregister(childCallback);
        }
      }

      const setAttr = (attr, val) => {
        const b = Buffer.alloc(4);
        b.writeInt32LE(val, 0);
        bindings.DwmSetWindowAttribute(hwnd, attr, b, 4);
      };

      setAttr(3, 0);   // DWMWA_TRANSITIONS_FORCEDISABLED = 0
      setAttr(2, 2);   // DWMWA_NCRENDERING_POLICY = 2 (DWMNCRP_ENABLED)
      setAttr(20, 1);  // DWMWA_USE_IMMERSIVE_DARK_MODE = 1
      setAttr(19, 1);  // Dark mode legacy = 1
      setAttr(33, 1);  // DWMWA_WINDOW_CORNER_PREFERENCE = 1 (DONOTROUND)
      setAttr(34, -2); // DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE (-2)
      setAttr(35, 0);  // Caption color = 0
      setAttr(36, 0);  // Text color = 0
      setAttr(38, 1);  // DWMWA_SYSTEMBACKDROP_TYPE = 1 (NONE)

      // Extend DWM frame by 1px on all 4 borders to preserve hardware composition on every resize edge
      const margins = Buffer.alloc(16);
      margins.writeInt32LE(1, 0);  // cxLeftWidth = 1
      margins.writeInt32LE(1, 4);  // cxRightWidth = 1
      margins.writeInt32LE(1, 8);  // cyTopHeight = 1
      margins.writeInt32LE(1, 12); // cyBottomHeight = 1
      bindings.DwmExtendFrameIntoClientArea(hwnd, margins);

      bindings.SetWindowPos(hwnd, 0n, 0, 0, 0, 0, 0x4237);
      setAttr(33, 1);  // Re-apply corner preference after frame change

      return;
    } catch (koffiErr) {
      console.warn('[native-dwm] in-process koffi call failed, falling back:', koffiErr?.message || koffiErr);
    }
  }

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
      '[StructLayout(LayoutKind.Sequential)]',
      'public struct MARGINS {',
      '  public int cxLeftWidth;',
      '  public int cxRightWidth;',
      '  public int cyTopHeight;',
      '  public int cyBottomHeight;',
      '}',
      'public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);',
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
      '  [DllImport("dwmapi.dll")]',
      '  public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS pMarInset);',
      '  [DllImport("user32.dll")]',
      '  public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc lpEnumFunc, IntPtr lParam);',
      '}',
      '\'@',
      'Add-Type -TypeDefinition $signature',
      `$hwnd = [IntPtr]::new(${hwndDecimal})`,
      '$WS_CAPTION = 0x00C00000L',
      '$WS_MINIMIZEBOX = 0x00020000L',
      '$WS_MAXIMIZEBOX = 0x00010000L',
      '$WS_CLIPCHILDREN = 0x02000000L',
      '$WS_CLIPSIBLINGS = 0x04000000L',
      '$curStyle = [Win32Dwm]::GetWindowLongPtr($hwnd, -16).ToInt64()',
      '$newStyle = $curStyle -bor 0x00040000L -bor ($WS_CAPTION -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX -bor $WS_CLIPCHILDREN -bor $WS_CLIPSIBLINGS)',
      '[Win32Dwm]::SetWindowLongPtr($hwnd, -16, [IntPtr]::new($newStyle))',
      '$nullBrush = [Win32Dwm]::GetStockObject(5)',
      '[Win32Dwm]::SetClassLongPtr($hwnd, -10, $nullBrush)',
      '[Win32Dwm]::EnumChildWindows($hwnd, [EnumProc]{ param($ch, $lp) $cs = [Win32Dwm]::GetWindowLongPtr($ch, -16).ToInt64(); [Win32Dwm]::SetWindowLongPtr($ch, -16, [IntPtr]::new($cs -bor 0x02000000L -bor 0x04000000L)); [Win32Dwm]::SetClassLongPtr($ch, -10, $nullBrush); return $true }, [IntPtr]::Zero)',
      '$forceDisabled = 0',
      '[Win32Dwm]::DwmSetWindowAttribute($hwnd, 3, [ref]$forceDisabled, 4)',
      '$ncPolicy = 2',
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
      '$margins = New-Object MARGINS',
      '$margins.cxLeftWidth = 1',
      '$margins.cxRightWidth = 1',
      '$margins.cyTopHeight = 1',
      '$margins.cyBottomHeight = 1',
      '[Win32Dwm]::DwmExtendFrameIntoClientArea($hwnd, [ref]$margins)',
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
      if (!win.__hybridIsResizing) {
        applyNativeDwmWindowStyles(win);
      }
    } else {
      setTimeout(() => {
        if (!win || win.isDestroyed() || win.__hybridIsResizing) return;
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
