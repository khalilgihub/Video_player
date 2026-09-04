const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('LIFO Screenshot Deletion (D), Undo Restoration (Z), and Alternating Cycles', () => {
  let electronApp;
  let window;
  let userDataDir;
  let tempScreenshotDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-shot-undo-test-'));
    tempScreenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-shots-'));

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
    if (tempScreenshotDir) {
      fs.rmSync(tempScreenshotDir, { recursive: true, force: true });
    }
  });

  test('Scenario 1: Single capture -> Delete (Key D) -> Restore (Key Z)', async () => {
    const file1 = path.join(tempScreenshotDir, 'shot_restore_1.png');
    fs.writeFileSync(file1, 'fake-image-data-1');

    const result = await window.evaluate(async (testFilePath) => {
      const messages = [];
      window.HybridToast = {
        show: (msg) => messages.push(msg),
      };

      // Reset stacks
      window.HybridApp.player._singleScreenshotStack = [testFilePath];
      window.HybridApp.player._deletedScreenshotStack = [];

      // 1. Delete with D
      await window.HybridApp.player.deleteLatestScreenshot();
      const stackAfterDel = window.HybridApp.player._singleScreenshotStack.length;
      const undoAfterDel = window.HybridApp.player._deletedScreenshotStack.length;

      // 2. Restore with Z
      await window.HybridApp.player.restoreLatestScreenshot();
      const stackAfterRestore = window.HybridApp.player._singleScreenshotStack.length;
      const undoAfterRestore = window.HybridApp.player._deletedScreenshotStack.length;

      return {
        stackAfterDel,
        undoAfterDel,
        stackAfterRestore,
        undoAfterRestore,
        messages,
      };
    }, file1);

    expect(result.stackAfterDel).toBe(0);
    expect(result.undoAfterDel).toBe(1);
    expect(result.stackAfterRestore).toBe(1);
    expect(result.undoAfterRestore).toBe(0);
    expect(result.messages.some(m => m.includes('Deleted screenshot'))).toBe(true);
    expect(result.messages.some(m => m.includes('Restored screenshot'))).toBe(true);
    // File must be back on disk!
    expect(fs.existsSync(file1)).toBe(true);
  });

  test('Scenario 2: Alternating Z and D Sequence', async () => {
    const fileA = path.join(tempScreenshotDir, 'single_alt_A.png');
    const fileB = path.join(tempScreenshotDir, 'single_alt_B.png');

    fs.writeFileSync(fileA, 'data-A');
    fs.writeFileSync(fileB, 'data-B');

    const runResult = await window.evaluate(async ({ pathA, pathB }) => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Reset stacks
      window.HybridApp.player._singleScreenshotStack = [pathA, pathB];
      window.HybridApp.player._deletedScreenshotStack = [];

      // Step 1: D -> Deletes B
      await window.HybridApp.player.deleteLatestScreenshot();
      const step1Stack = [...window.HybridApp.player._singleScreenshotStack];
      const step1Toast = toasts[toasts.length - 1];

      // Step 2: Z -> Restores B
      await window.HybridApp.player.restoreLatestScreenshot();
      const step2Stack = [...window.HybridApp.player._singleScreenshotStack];
      const step2Toast = toasts[toasts.length - 1];

      // Step 3: D -> Deletes B again!
      await window.HybridApp.player.deleteLatestScreenshot();
      const step3Stack = [...window.HybridApp.player._singleScreenshotStack];

      // Step 4: D -> Deletes A!
      await window.HybridApp.player.deleteLatestScreenshot();
      const step4Stack = [...window.HybridApp.player._singleScreenshotStack];

      // Step 5: Z -> Restores A!
      await window.HybridApp.player.restoreLatestScreenshot();
      const step5Stack = [...window.HybridApp.player._singleScreenshotStack];

      // Step 6: Z -> Restores B!
      await window.HybridApp.player.restoreLatestScreenshot();
      const step6Stack = [...window.HybridApp.player._singleScreenshotStack];

      // Step 7: Z -> Nothing to restore
      await window.HybridApp.player.restoreLatestScreenshot();
      const step7Toast = toasts[toasts.length - 1];

      return {
        step1Stack,
        step1Toast,
        step2Stack,
        step2Toast,
        step3Stack,
        step4Stack,
        step5Stack,
        step6Stack,
        step7Toast,
      };
    }, { pathA: fileA, pathB: fileB });

    expect(runResult.step1Stack).toEqual([fileA]);
    expect(runResult.step1Toast).toContain('single_alt_B.png');

    expect(runResult.step2Stack).toEqual([fileA, fileB]);
    expect(runResult.step2Toast).toContain('single_alt_B.png');

    expect(runResult.step3Stack).toEqual([fileA]);
    expect(runResult.step4Stack).toEqual([]);

    expect(runResult.step5Stack).toEqual([fileA]);
    expect(runResult.step6Stack).toEqual([fileA, fileB]);
    expect(runResult.step7Toast).toContain('No deleted screenshots to restore');

    // Both files must exist on disk after final restorations!
    expect(fs.existsSync(fileA)).toBe(true);
    expect(fs.existsSync(fileB)).toBe(true);
  });

  test('Scenario 3: Video Switching Isolation for both Active and Undo Stacks', async () => {
    const video1Shot = path.join(tempScreenshotDir, 'v1_shot.png');
    const video2Shot = path.join(tempScreenshotDir, 'v2_shot.png');
    fs.writeFileSync(video1Shot, 'v1-data');
    fs.writeFileSync(video2Shot, 'v2-data');

    const result = await window.evaluate(async ({ v1Path, v2Path }) => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Video 1 active: take screenshot and delete it
      window.HybridApp.player.currentFilePath = 'C:\\videos\\video1.mp4';
      window.HybridApp.player._singleScreenshotStack = [v1Path];
      window.HybridApp.player._deletedScreenshotStack = [];
      await window.HybridApp.player.deleteLatestScreenshot();

      // Switch to Video 2: loadFile / loadUrl resets both stacks
      window.HybridApp.player._singleScreenshotStack = [];
      window.HybridApp.player._deletedScreenshotStack = [];
      window.HybridApp.player.currentFilePath = 'C:\\videos\\video2.mp4';

      // Press Z on Video 2 -> Should say "No deleted screenshots to restore"
      await window.HybridApp.player.restoreLatestScreenshot();
      const toastOnNewVideoZ = toasts[toasts.length - 1];

      // Press D on Video 2 -> Should say "No recent screenshots to delete"
      await window.HybridApp.player.deleteLatestScreenshot();
      const toastOnNewVideoD = toasts[toasts.length - 1];

      return {
        toastOnNewVideoZ,
        toastOnNewVideoD,
      };
    }, { v1Path: video1Shot, v2Path: video2Shot });

    expect(result.toastOnNewVideoZ).toContain('No deleted screenshots to restore');
    expect(result.toastOnNewVideoD).toContain('No recent screenshots to delete');
  });

  test('Scenario 4: In-Card Badge & Deletion Animation on Preview Card', async () => {
    const shotPath = path.join(tempScreenshotDir, 'card_test_shot.png');
    fs.writeFileSync(shotPath, 'card-data');

    const cardResult = await window.evaluate(async (testPath) => {
      window.HybridApp.player._singleScreenshotStack = [testPath];
      window.HybridApp.player._deletedScreenshotStack = [];

      // Trigger deletion
      await window.HybridApp.player.deleteLatestScreenshot();

      const preview = document.getElementById('screenshotPreview');
      const hasDeletingClass = preview && preview.classList.contains('deleting');
      const badge = preview ? preview.querySelector('.screenshot-preview-badge') : null;
      const badgeText = badge ? badge.textContent : '';
      const badgeHasDeletedClass = badge ? badge.classList.contains('deleted') : false;

      // Trigger restoration
      await window.HybridApp.player.restoreLatestScreenshot();
      const badgeAfterRestore = preview ? preview.querySelector('.screenshot-preview-badge') : null;
      const restoreBadgeText = badgeAfterRestore ? badgeAfterRestore.textContent : '';
      const badgeHasRestoredClass = badgeAfterRestore ? badgeAfterRestore.classList.contains('restored') : false;

      return {
        hasDeletingClass,
        badgeText,
        badgeHasDeletedClass,
        restoreBadgeText,
        badgeHasRestoredClass,
      };
    }, shotPath);

    expect(cardResult.badgeText).toContain('Deleted');
    expect(cardResult.badgeHasDeletedClass).toBe(true);
    expect(cardResult.restoreBadgeText).toContain('Restored');
    expect(cardResult.badgeHasRestoredClass).toBe(true);
  });
});
