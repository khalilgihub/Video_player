const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Hybrid Player Launch', () => {
  let electronApp;
  let window;
  let userDataDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-test-'));
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env,
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (userDataDir) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('should launch and render the welcome screen', async () => {
    const isVisible = await window.locator('#welcomeScreen').isVisible();
    expect(isVisible).toBe(true);
  });

  test('should load welcome background modules', async () => {
    await window.waitForFunction(() => {
      return Boolean(window.HybridDitherWaves) && document.querySelectorAll('#ditherMount canvas').length > 0;
    });

    await window.locator('#welcomeBackgroundSelect').selectOption('particles');
    await expect.poll(async () => {
      return window.evaluate(() => document.querySelectorAll('#particlesMount canvas').length);
    }).toBeGreaterThan(0);
  });

  test('should expose startup diagnostics without rendering errors', async () => {
    const diagnostics = await window.evaluate(() => window.hybridAPI.app.getStartupDiagnostics());
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  test('should use native-feeling titlebar hover colors', async () => {
    await window.evaluate(() => window.HybridApp.controlsModule._showControlsNow());

    await window.locator('#btnMinimize').hover();
    await expect.poll(async () => {
      return window.locator('#btnMinimize').evaluate((el) => getComputedStyle(el).backgroundColor);
    }).toBe('rgba(255, 255, 255, 0.16)');

    await window.locator('#btnMaximize').hover();
    await expect.poll(async () => {
      return window.locator('#btnMaximize').evaluate((el) => getComputedStyle(el).backgroundColor);
    }).toBe('rgba(255, 255, 255, 0.16)');

    await window.locator('#btnClose').hover();
    await expect.poll(async () => {
      return window.locator('#btnClose').evaluate((el) => getComputedStyle(el).backgroundColor);
    }).toBe('rgb(232, 17, 35)');

    await window.mouse.move(400, 240);
    await window.evaluate(() => {
      window.HybridApp.controlsModule._mouseOverControls = false;
      window.HybridApp.controlsModule._showControlsNow();
    });
  });

  test('should hide titlebar with controls while playback is idle', async () => {
    const state = await window.evaluate(() => {
      window.HybridApp.controlsModule._mouseOverControls = false;
      window.HybridApp.player.isPlaying = true;
      window.HybridApp.controlsModule._hideControlsNow();
      return {
        controlsHidden: document.getElementById('controlsWrapper').classList.contains('hidden'),
        titlebarHidden: document.getElementById('titlebar').classList.contains('hidden'),
      };
    });

    expect(state.controlsHidden).toBe(true);
    expect(state.titlebarHidden).toBe(true);

    await window.evaluate(() => {
      window.HybridApp.player.isPlaying = false;
      window.HybridApp.controlsModule._showControlsNow();
    });
  });

  test('should capture a basic welcome background performance snapshot', async () => {
    await window.locator('#welcomeBackgroundSelect').selectOption('dither');
    await window.waitForTimeout(750);

    const report = await window.evaluate(() => window.HybridPerfMonitor.flush({ force: true }));
    expect(report).toBeTruthy();
    expect(report.scopes.length).toBeGreaterThan(0);
    expect(report.scopes.some((scope) => scope.scope.startsWith('welcome:') && scope.fps > 1)).toBe(true);
  });

  test('should expose documented UI keyboard shortcuts', async () => {
    await window.keyboard.press('Control+,');
    await expect(window.locator('#settingsModal')).toBeVisible();

    await window.evaluate(() => {
      document.getElementById('settingsModal').hidden = true;
    });

    await window.keyboard.press('Control+L');
    await expect(window.locator('#sidebarPlaylist')).not.toHaveClass(/collapsed/);

    await window.keyboard.press('Control+N');
    await expect(window.locator('#networkStreamModal')).toBeVisible();
  });
});
