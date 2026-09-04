const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

test('should preserve maximized state and lock edge resizing after fullscreen and un-fullscreen', async () => {
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);

  const initialMaximized = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.isMaximized();
  });
  expect(initialMaximized).toBe(true);

  // Toggle fullscreen ON via renderer controls
  await window.evaluate(async () => {
    await window.HybridApp.controlsModule.toggleFullscreen();
  });
  await window.waitForTimeout(800);

  const duringFs = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      preMaximized: win.__hybridPreFullscreenMaximized,
      isFullScreen: win.isFullScreen(),
    };
  });
  expect(duringFs.preMaximized).toBe(true);

  // Toggle fullscreen OFF via renderer controls
  await window.evaluate(async () => {
    await window.HybridApp.controlsModule.toggleFullscreen();
  });
  await window.waitForTimeout(1200);

  const afterFs = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
    };
  });
  expect(afterFs.isMaximized).toBe(true);
  expect(afterFs.isFullScreen).toBe(false);

  // Check UI visual state
  const isMaxUi = await window.evaluate(() => {
    return document.body.classList.contains('is-maximized');
  });
  expect(isMaxUi).toBe(true);

  await electronApp.close();
});

test('should restore windowed mode and bounds after fullscreen and un-fullscreen when initially unmaximized', async () => {
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);

  // Unmaximize first to get into windowed mode
  await window.evaluate(async () => {
    await window.hybridAPI.window.toggleMaximize();
  });
  await window.waitForTimeout(800);

  const windowedState = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      isMax: win.isMaximized(),
      bounds: win.getBounds(),
    };
  });
  expect(windowedState.isMax).toBe(false);

  // Toggle fullscreen ON
  await window.evaluate(async () => {
    await window.HybridApp.controlsModule.toggleFullscreen();
  });
  await window.waitForTimeout(800);

  const fsState = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      preMax: win.__hybridPreFullscreenMaximized,
      preBounds: win.__hybridPreFullscreenBounds,
    };
  });
  expect(fsState.preMax).toBe(false);

  // Toggle fullscreen OFF
  await window.evaluate(async () => {
    await window.HybridApp.controlsModule.toggleFullscreen();
  });
  await window.waitForTimeout(1200);

  const finalState = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
      bounds: win.getBounds(),
    };
  });

  expect(finalState.isMaximized).toBe(false);
  expect(finalState.isFullScreen).toBe(false);
  expect(Math.abs(finalState.bounds.width - windowedState.bounds.width)).toBeLessThanOrEqual(5);
  expect(Math.abs(finalState.bounds.height - windowedState.bounds.height)).toBeLessThanOrEqual(5);

  await electronApp.close();
});

test('should update adaptive titlebar button across all 3 states and exit fullscreen safely when clicked', async () => {
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);

  // 1. Initial launch is maximized
  const maxBtn1 = await window.evaluate(() => {
    const btn = document.getElementById('btnMaximize');
    return {
      title: btn.title,
      ariaLabel: btn.getAttribute('aria-label'),
      hasSvg: !!btn.querySelector('svg'),
    };
  });
  expect(maxBtn1.title).toBe('Restore Down');
  expect(maxBtn1.ariaLabel).toBe('Restore window');

  // 2. Unmaximize to Windowed
  await window.evaluate(() => window.hybridAPI.window.toggleMaximize());
  await window.waitForTimeout(800);

  const windowedBtn = await window.evaluate(() => {
    const btn = document.getElementById('btnMaximize');
    return {
      title: btn.title,
      ariaLabel: btn.getAttribute('aria-label'),
    };
  });
  expect(windowedBtn.title).toBe('Maximize (F11)');
  expect(windowedBtn.ariaLabel).toBe('Maximize window');

  // 3. Enter Fullscreen
  await window.evaluate(() => window.hybridAPI.window.fullscreen(true));
  await window.waitForTimeout(800);

  const fsBtn = await window.evaluate(() => {
    const btn = document.getElementById('btnMaximize');
    return {
      title: btn.title,
      ariaLabel: btn.getAttribute('aria-label'),
      html: btn.innerHTML,
    };
  });
  expect(fsBtn.title).toBe('Exit Fullscreen (F / Esc)');
  expect(fsBtn.ariaLabel).toBe('Exit Fullscreen');
  expect(fsBtn.html).toContain('x1="3.5" y1="10.5" x2="8.5" y2="10.5"');

  // 4. Click the adaptive button WHILE IN FULLSCREEN
  await window.evaluate(() => {
    document.getElementById('btnMaximize').click();
  });
  await window.waitForTimeout(1200);

  // 5. Confirm clean restore without visual bug
  const afterClickState = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      isFullScreen: win.isFullScreen(),
      isMaximized: win.isMaximized(),
    };
  });
  expect(afterClickState.isFullScreen).toBe(false);
  expect(afterClickState.isMaximized).toBe(false);

  await electronApp.close();
});
