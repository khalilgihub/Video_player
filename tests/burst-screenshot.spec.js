const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Burst Frame Screenshot System and Zero Collision Generator', () => {
  let electronApp;
  let window;
  let userDataDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-burst-test-'));
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

  test('should trigger single screenshot execution on screenshot button click', async () => {
    const executed = await window.evaluate(async () => {
      let called = false;
      const orig = window.HybridApp.player.takeScreenshot;
      window.HybridApp.player.takeScreenshot = async () => {
        called = true;
      };
      document.getElementById('btnScreenshot')?.click();
      window.HybridApp.player.takeScreenshot = orig;
      return called;
    });
    expect(executed).toBe(true);
  });

  test('should engage burst capture when holding S and pace in-flight frames', async () => {
    const burstResult = await window.evaluate(async () => {
      const capturedFrames = [];
      const hudUpdates = [];
      const messages = [];

      window.HybridToast = {
        show: (msg) => messages.push(msg),
      };

      // Intercept screenshotBurstFrame
      window.hybridAPI.mpv.screenshotBurstFrame = async (sessionId, seqNum, mode) => {
        capturedFrames.push({ sessionId, seqNum, mode });
        return { framePath: `C:\\dummy\\burst_${sessionId}\\frame-${String(seqNum).padStart(5, '0')}.jpg`, burstFolder: `burst_${sessionId}`, seqNum };
      };

      window.hybridAPI.mpv.finalizeBurstSession = async (sessionId, total) => {
        return total >= 20
          ? { inSubfolder: true, count: total, folderName: `burst_${sessionId}` }
          : { inSubfolder: false, count: total, folderName: '' };
      };

      // 1. Simulate keydown for S (holding down with e.repeat)
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', repeat: false }));
      
      // Wait 250ms for hold timer to trigger burst capture
      await new Promise(r => setTimeout(r, 260));

      // Emulate repeat keydown events during hold
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', repeat: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', repeat: true }));

      // Wait 150ms for burst frames to stream
      await new Promise(r => setTimeout(r, 150));

      const activeState = window.HybridApp.player._isBurstCapturing;
      const countBeforeRelease = window.HybridApp.player._burstFrameCount;
      const indicatorText = document.getElementById('recordingIndicatorText')?.textContent;

      // 2. Release S key
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's' }));

      // Wait for async finalize and toast emission
      const startWait = Date.now();
      while (messages.length === 0 && Date.now() - startWait < 500) {
        await new Promise(r => setTimeout(r, 20));
      }

      const stoppedState = window.HybridApp.player._isBurstCapturing;
      const finalCount = window.HybridApp.player._burstFrameCount;
      const lastToast = messages[messages.length - 1];

      return {
        activeState,
        countBeforeRelease,
        indicatorText,
        stoppedState,
        finalCount,
        capturedFrames,
        lastToast,
      };
    });

    expect(burstResult.activeState).toBe(true);
    expect(burstResult.countBeforeRelease).toBeGreaterThan(0);
    expect(burstResult.indicatorText).toContain('Burst capturing');
    expect(burstResult.stoppedState).toBe(false);
    expect(burstResult.finalCount).toBeGreaterThanOrEqual(burstResult.countBeforeRelease);
    expect(burstResult.lastToast).toContain('Saved');

    // Verify sequential indexing (frame 1, frame 2, frame 3...)
    for (let i = 0; i < burstResult.capturedFrames.length; i++) {
      expect(burstResult.capturedFrames[i].seqNum).toBe(i + 1);
    }
  });

  test('should trigger standard single screenshot on short tap of S (< 200ms)', async () => {
    const tapResult = await window.evaluate(async () => {
      let singleShotCalled = false;
      window.HybridApp.player.takeScreenshot = async () => {
        singleShotCalled = true;
      };

      // Press and immediately release within 50ms
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', repeat: false }));
      await new Promise(r => setTimeout(r, 50));
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's' }));

      // Wait 100ms
      await new Promise(r => setTimeout(r, 100));

      return {
        singleShotCalled,
        isBurst: window.HybridApp.player._isBurstCapturing,
      };
    });

    expect(tapResult.singleShotCalled).toBe(true);
    expect(tapResult.isBurst).toBe(false);
  });

  test('should allow configuring, persisting, and resetting custom screenshot directory', async () => {
    const testDirResult = await window.evaluate(async () => {
      const defaultDir = await window.hybridAPI.app.getDefaultScreenshotDir();
      const initialMpvDir = await window.hybridAPI.mpv.getScreenshotDir();

      // Set custom directory
      const customDir = 'C:\\CustomScreenshotsTestFolder';
      await window.hybridAPI.db.setPreference('screenshotDir', customDir);
      await window.hybridAPI.mpv.setScreenshotDir(customDir);

      const savedPref = await window.hybridAPI.db.getPreference('screenshotDir');
      const updatedMpvDir = await window.hybridAPI.mpv.getScreenshotDir();

      // Trigger UI reset
      document.getElementById('settResetScreenshotDir')?.click();
      await new Promise(r => setTimeout(r, 50));

      const resetPref = await window.hybridAPI.db.getPreference('screenshotDir');
      const resetMpvDir = await window.hybridAPI.mpv.getScreenshotDir();

      return {
        defaultDir,
        initialMpvDir,
        savedPref,
        updatedMpvDir,
        resetPref,
        resetMpvDir,
      };
    });

    expect(testDirResult.defaultDir).toBeTruthy();
    expect(testDirResult.savedPref).toBe('C:\\CustomScreenshotsTestFolder');
    expect(testDirResult.updatedMpvDir).toBe('C:\\CustomScreenshotsTestFolder');
    expect(testDirResult.resetPref).toBe('');
    expect(testDirResult.resetMpvDir).toBe(testDirResult.defaultDir);
  });

  test('should synchronize custom select UI when screenshot format preference is set to webp', async () => {
    const result = await window.evaluate(async () => {
      // 1. Simulate persisted preference as webp
      await window.hybridAPI.db.setPreference('screenshotFormat', 'webp');

      // 2. Trigger settings sync as happens when opening settings
      await window.HybridApp.settingsModule.syncFormState();

      const container = document.getElementById('settScreenshotFormatContainer');
      const triggerTextBeforeClick = container?.querySelector('.custom-select-value')?.textContent?.trim();
      const activeOptionBeforeClick = container?.querySelector('.custom-select-option.active')?.dataset?.value;

      // 3. Test programmatic value assignment
      const nativeSelect = document.getElementById('settScreenshotFormat');
      nativeSelect.value = 'png';
      const triggerTextAfterPng = container?.querySelector('.custom-select-value')?.textContent?.trim();

      // Reset back to webp via _setValue
      window.HybridApp.settingsModule._setValue('settScreenshotFormat', 'webp');
      const triggerTextAfterWebp = container?.querySelector('.custom-select-value')?.textContent?.trim();

      return {
        triggerTextBeforeClick,
        activeOptionBeforeClick,
        triggerTextAfterPng,
        triggerTextAfterWebp,
      };
    });

    expect(result.triggerTextBeforeClick).toBe('WebP (.webp)');
    expect(result.activeOptionBeforeClick).toBe('webp');
    expect(result.triggerTextAfterPng).toBe('PNG (.png)');
    expect(result.triggerTextAfterWebp).toBe('WebP (.webp)');
  });
});
