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

  async function openBackgroundSettings() {
    const modal = window.locator('#bgSettingsModal');
    if (!(await modal.isVisible())) {
      await window.locator('#bgSettingsToggle').click();
    }
    await expect(modal).toBeVisible();
  }

  async function closeBackgroundSettings() {
    await window.evaluate(() => {
      const modal = document.getElementById('bgSettingsModal');
      if (modal) modal.hidden = true;
    });
    await expect(window.locator('#bgSettingsModal')).toBeHidden();
  }

  test('should launch and render the welcome screen', async () => {
    const isVisible = await window.locator('#welcomeScreen').isVisible();
    expect(isVisible).toBe(true);
  });

  test('should load welcome background modules', async () => {
    await window.waitForFunction(() => {
      return Boolean(window.HybridDitherWaves) && document.querySelectorAll('#ditherMount canvas').length > 0;
    });

    await openBackgroundSettings();
    
    await window.locator('#welcomeBackgroundSelect').selectOption('particles');
    await expect.poll(async () => {
      return window.evaluate(() => document.querySelectorAll('#particlesMount canvas').length);
    }).toBeGreaterThan(0);

    await window.locator('#welcomeBackgroundSelect').selectOption('dotgrid');
    await expect.poll(async () => {
      return window.evaluate(() => document.querySelectorAll('#dotGridMount canvas').length);
    }).toBeGreaterThan(0);

    await closeBackgroundSettings();
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

  test('should not cover video when a fullscreen transition starts', async () => {
    await window.waitForFunction(() => Boolean(window.HybridApp?.controlsModule));
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('window-fullscreen-transition-start', true);
    });

    await expect.poll(() => window.evaluate(() => document.body.classList.contains('fs-transition'))).toBe(true);
    await expect(window.locator('#video-curtain')).not.toHaveClass(/visible/);
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
    await openBackgroundSettings();
    await window.locator('#welcomeBackgroundSelect').selectOption('dither');
    await window.waitForTimeout(750);

    const report = await window.evaluate(() => window.HybridPerfMonitor.flush({ force: true }));
    expect(report).toBeTruthy();
    expect(report.scopes.length).toBeGreaterThan(0);
    expect(report.scopes.some((scope) => scope.scope.startsWith('welcome:') && scope.fps > 1)).toBe(true);
    await closeBackgroundSettings();
  });

  test('should expose documented UI keyboard shortcuts', async () => {
    await window.evaluate(() => {
      document.querySelectorAll('.modal-overlay').forEach((modal) => {
        modal.hidden = true;
      });
    });

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

  test('should remove missing local files from recently played', async () => {
    const missingPath = path.join(userDataDir, 'deleted-video.mp4');
    await window.evaluate(async (filePath) => {
      await window.hybridAPI.history.add({
        path: filePath,
        name: 'Deleted video',
        duration: 10,
        timestamp: Date.now(),
      });
    }, missingPath);

    const recent = await window.evaluate(() => window.hybridAPI.history.getRecent(20));
    expect(recent.some((entry) => entry.path === missingPath)).toBe(false);
  });

  test('should keep playback loaded when history persistence fails', async () => {
    await window.waitForFunction(() => Boolean(window.HybridApp?.player));
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mpv:set-property');
      ipcMain.handle('mpv:set-property', async () => true);
      ipcMain.removeHandler('mpv:load-file');
      ipcMain.handle('mpv:load-file', async () => true);
      ipcMain.removeHandler('history:add');
      ipcMain.handle('history:add', async () => {
        throw new Error('forced history persistence failure');
      });
    });

    const state = await window.evaluate(async () => {
      const messages = [];
      window.HybridToast.show = (message) => messages.push(String(message));
      await window.HybridApp.player.loadFile('C:\\test-media\\sample.mp4');
      return {
        currentFilePath: window.HybridApp.player.currentFilePath,
        welcomeHidden: document.getElementById('welcomeScreen')?.classList.contains('hidden'),
        messages,
      };
    });

    expect(state.currentFilePath).toBe('C:\\test-media\\sample.mp4');
    expect(state.welcomeHidden).toBe(true);
    expect(state.messages.some((message) => message.startsWith('Failed to load:'))).toBe(false);
  });

  test('should recover when a missing recent file is followed by an existing one', async () => {
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('history:getRecent');
      ipcMain.handle('history:getRecent', async () => [
        { path: 'C:\\missing\\deleted.mp4', name: 'Deleted video' },
        { path: 'C:\\media\\existing.mp4', name: 'Existing video' },
      ]);
      ipcMain.removeHandler('mpv:set-property');
      ipcMain.handle('mpv:set-property', async () => true);
      ipcMain.removeHandler('mpv:load-file');
      ipcMain.handle('mpv:load-file', async (_, filePath) => filePath.endsWith('existing.mp4'));
    });

    await window.evaluate(async () => {
      document.querySelectorAll('.modal-overlay').forEach((modal) => {
        modal.hidden = true;
      });
      document.getElementById('welcomeScreen')?.classList.remove('hidden');
      await window.HybridApp._loadRecentFiles();
    });

    const recentItems = window.locator('#recentFiles .recent-item');
    await expect(recentItems).toHaveCount(2);
    await recentItems.nth(0).click();
    await expect.poll(() => window.evaluate(() => window.HybridApp.playlistModule.currentIndex)).toBe(-1);

    await recentItems.nth(1).click();
    await expect.poll(() => window.evaluate(() => window.HybridApp.player.currentFilePath)).toBe('C:\\media\\existing.mp4');
    await expect.poll(() => window.evaluate(() => window.HybridApp.playlistModule.currentIndex)).toBe(0);
    await expect(window.locator('#welcomeScreen')).toHaveClass(/hidden/);
  });
});
