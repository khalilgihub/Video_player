const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Real Video Playback & mpv Engine Test', () => {
  let electronApp;
  let window;
  let userDataDir;
  const sampleVideoPath = path.resolve(__dirname, '..', 'test-sample.mp4');

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-playback-test-'));
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

  test('should successfully load real video file and start mpv playback', async () => {
    expect(fs.existsSync(sampleVideoPath)).toBe(true);

    const loaded = await window.evaluate(async (filePath) => {
      return await window.HybridApp.player.loadFile(filePath);
    }, sampleVideoPath);

    expect(loaded).toBe(true);

    // Welcome screen should be hidden
    const welcome = window.locator('#welcomeScreen');
    await expect(welcome).toHaveClass(/hidden/);

    // Active file path should match
    await expect.poll(async () => {
      return await window.evaluate(() => window.HybridApp.player.currentFilePath);
    }).toBe(sampleVideoPath);

    // Duration should be positive
    await expect.poll(async () => {
      return await window.evaluate(() => window.HybridApp.player.duration);
    }).toBeGreaterThan(0);
  });

  test('should show skip indicator without green loading spinner ring during seek', async () => {
    const skipIndicator = window.locator('#skip-indicator');
    const loadingSpinner = window.locator('#networkLoadingSpinner');

    // Trigger seek forward 5s
    await window.evaluate(() => {
      window.HybridApp.shortcutModule.handleAction('seek-forward-5');
    });

    // Skip indicator should be visible with +5s
    await expect(skipIndicator).toBeVisible();
    await expect(skipIndicator).toContainText('+5s');

    // Network loading spinner (green circle) must remain hidden
    await expect(loadingSpinner).toHaveClass(/hidden/);

    // Trigger seek back 5s
    await window.evaluate(() => {
      window.HybridApp.shortcutModule.handleAction('seek-back-5');
    });

    await expect(skipIndicator).toBeVisible();
    await expect(skipIndicator).toContainText('-5s');
    await expect(loadingSpinner).toHaveClass(/hidden/);
  });
});
