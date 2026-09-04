const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Screenshot Restore Carousel (Ctrl + Z)', () => {
  let electronApp;
  let window;
  let userDataDir;
  let tempScreenshotDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-restore-carousel-test-'));
    tempScreenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-restore-shots-'));

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

  async function setupDeletedItems(win, dir, count = 3) {
    const filePaths = [];
    for (let i = 1; i <= count; i++) {
      const fp = path.join(dir, `item_${i}.png`);
      fs.writeFileSync(fp, `data-${i}`);
      filePaths.push(fp);
    }

    return await win.evaluate(async ({ filePaths }) => {
      window.HybridApp.player.closeScreenshotCarousel?.();
      window.HybridApp.player._sessionScreenshots = [];
      window.HybridApp.player._singleScreenshotStack = [];
      window.HybridApp.player._deletedScreenshotStack = [];

      for (const filePath of filePaths) {
        const fileName = filePath.split(/[/\\]/).pop();
        window.HybridApp.player._recordSingleScreenshot({
          filePath,
          fileName,
          previewDataUrl: `data:image/png;base64,data_${fileName}`,
        });
      }

      for (let i = 0; i < filePaths.length; i++) {
        await window.HybridApp.player.deleteLatestScreenshot();
      }

      return window.HybridApp.player._deletedScreenshotStack.length;
    }, { filePaths });
  }

  test('Scenario 1: Ctrl + Z with empty deleted stack shows warning notice & toast and does not open carousel', async () => {
    await window.waitForFunction(() => !!window.HybridApp?.player, null, { timeout: 10000 });
    const result = await window.evaluate(async () => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Reset stacks
      window.HybridApp.player._deletedScreenshotStack = [];
      window.HybridApp.player.closeScreenshotCarousel?.();

      // Trigger Ctrl + Z via shortcuts module
      const e = new KeyboardEvent('keydown', {
        code: 'KeyZ',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(e);

      const isOpen = window.HybridApp.player.isScreenshotCarouselOpen?.();
      const notice = document.getElementById('screenshotNotice');
      return {
        toasts,
        isOpen,
        noticeText: notice?.innerText,
      };
    });

    expect(result.isOpen).toBe(false);
    expect(result.toasts).toContain('⚠️ No deleted screenshots to restore');
    expect(result.noticeText).toContain('No screenshots to restore');
  });

  test('Scenario 2: Delete 3 screenshots -> open restore carousel with Ctrl + Z -> defaults to newest (3 / 3)', async () => {
    const count = await setupDeletedItems(window, tempScreenshotDir, 3);
    expect(count).toBe(3);

    const result = await window.evaluate(async () => {
      // Open restore carousel via Ctrl + Z
      const e = new KeyboardEvent('keydown', {
        code: 'KeyZ',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(e);

      const isOpen = window.HybridApp.player.isScreenshotCarouselOpen();
      const mode = window.HybridApp.player.getCarouselMode();
      const carouselEl = document.getElementById('screenshotCarousel');
      const counterText = carouselEl?.querySelector('.carousel-counter')?.textContent;
      const fileNameText = carouselEl?.querySelector('.carousel-filename')?.textContent;

      return {
        isOpen,
        mode,
        counterText,
        fileNameText,
        deletedCount: window.HybridApp.player._deletedScreenshotStack.length,
      };
    });

    expect(result.isOpen).toBe(true);
    expect(result.mode).toBe('restore');
    expect(result.deletedCount).toBe(3);
    expect(result.counterText).toContain('3 / 3');
  });

  test('Scenario 3: Navigate with ArrowLeft and ArrowRight cycles through deleted items', async () => {
    const navResult = await window.evaluate(async () => {
      // Press ArrowLeft
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true, cancelable: true }));
      const carouselEl = document.getElementById('screenshotCarousel');
      const counterAfterLeft = carouselEl?.querySelector('.carousel-counter')?.textContent;

      // Press ArrowRight
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true, cancelable: true }));
      const counterAfterRight = carouselEl?.querySelector('.carousel-counter')?.textContent;

      return {
        counterAfterLeft,
        counterAfterRight,
      };
    });

    expect(navResult.counterAfterLeft).toContain('2 / 3');
    expect(navResult.counterAfterRight).toContain('3 / 3');
  });

  test('Scenario 4: Pressing Z in restore carousel restores selected screenshot and plays green animation', async () => {
    const restoreResult = await window.evaluate(async () => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Press Z inside restore carousel
      const e = new KeyboardEvent('keydown', {
        code: 'KeyZ',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(e);

      const carouselEl = document.getElementById('screenshotCarousel');
      const hasRestoringClass = carouselEl?.classList.contains('restoring');
      const badge = carouselEl?.querySelector('.screenshot-preview-badge');
      const badgeText = badge?.textContent;
      const isRestoredBadge = badge?.classList.contains('restored');
      const isOpenImmediately = window.HybridApp.player.isScreenshotCarouselOpen();

      // Wait 550ms for restore animation and IPC completion
      await new Promise(r => setTimeout(r, 600));

      const remainingStackCount = window.HybridApp.player._deletedScreenshotStack.length;
      const sessionCount = window.HybridApp.player._sessionScreenshots.length;

      return {
        hasRestoringClass,
        badgeText,
        isRestoredBadge,
        isOpenImmediately,
        toasts,
        remainingStackCount,
        sessionCount,
      };
    });

    expect(restoreResult.hasRestoringClass).toBe(true);
    expect(restoreResult.badgeText).toBe('Restored');
    expect(restoreResult.isRestoredBadge).toBe(true);
    expect(restoreResult.isOpenImmediately).toBe(false);
    expect(restoreResult.remainingStackCount).toBe(2);
    expect(restoreResult.sessionCount).toBe(1);
    expect(restoreResult.toasts.some(t => t.includes('Restored screenshot'))).toBe(true);
  });

  test('Scenario 5: Pressing Escape closes restore carousel without side effects', async () => {
    const escResult = await window.evaluate(async () => {
      // Re-open restore carousel with Ctrl + Z
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      const openBeforeEsc = window.HybridApp.player.isScreenshotCarouselOpen();

      // Press Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));

      await new Promise((r) => setTimeout(r, 400));
      const openAfterEsc = window.HybridApp.player.isScreenshotCarouselOpen();

      return {
        openBeforeEsc,
        openAfterEsc,
      };
    });

    expect(escResult.openBeforeEsc).toBe(true);
    expect(escResult.openAfterEsc).toBe(false);
  });

  test('Scenario 6: Toggle between Ctrl + D and Ctrl + Z switches modes seamlessly', async () => {
    const toggleResult = await window.evaluate(async () => {
      // 1. Open delete carousel with Ctrl + D (session has 1 restored shot from Scenario 4)
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', ctrlKey: true, bubbles: true, cancelable: true }));
      const mode1 = window.HybridApp.player.getCarouselMode();
      const open1 = window.HybridApp.player.isScreenshotCarouselOpen();

      // 2. Switch to restore carousel with Ctrl + Z
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      const mode2 = window.HybridApp.player.getCarouselMode();
      const open2 = window.HybridApp.player.isScreenshotCarouselOpen();

      // 3. Close with Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300));
      const open3 = window.HybridApp.player.isScreenshotCarouselOpen();

      return {
        mode1,
        open1,
        mode2,
        open2,
        open3,
      };
    });

    expect(toggleResult.open1).toBe(true);
    expect(toggleResult.mode1).toBe('delete');
    expect(toggleResult.open2).toBe(true);
    expect(toggleResult.mode2).toBe('restore');
    expect(toggleResult.open3).toBe(false);
  });

  test('Scenario 7: Restore middle screenshot with Enter key', async () => {
    // Current deleted stack has 2 items left (item_1 and item_2)
    const enterResult = await window.evaluate(async () => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Open restore carousel
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      
      const carouselEl = document.getElementById('screenshotCarousel');
      const counterInitial = carouselEl?.querySelector('.carousel-counter')?.textContent;

      // Navigate left
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true, cancelable: true }));
      const counterAfterLeft = carouselEl?.querySelector('.carousel-counter')?.textContent;

      // Press Enter to restore
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }));

      // Wait for restore animation and IPC
      await new Promise((r) => setTimeout(r, 600));

      const remainingStackCount = window.HybridApp.player._deletedScreenshotStack.length;
      const sessionCount = window.HybridApp.player._sessionScreenshots.length;

      return {
        counterInitial,
        counterAfterLeft,
        remainingStackCount,
        sessionCount,
        toasts,
      };
    });

    expect(enterResult.counterInitial).toContain('2 / 2');
    expect(enterResult.counterAfterLeft).toContain('1 / 2');
    expect(enterResult.remainingStackCount).toBe(1);
    expect(enterResult.sessionCount).toBe(2);
    expect(enterResult.toasts.some(t => t.includes('Restored screenshot'))).toBe(true);
  });

  test('Scenario 8: Mouse interaction (< > navigation and close button)', async () => {
    // 1 item left in deleted stack
    const mouseResult = await window.evaluate(async () => {
      // Open restore carousel
      window.HybridApp.player.openRestoreCarousel();
      const carouselEl = document.getElementById('screenshotCarousel');

      const prevBtn = carouselEl.querySelector('.carousel-nav-btn.prev');
      const nextBtn = carouselEl.querySelector('.carousel-nav-btn.next');
      const closeBtn = carouselEl.querySelector('.carousel-close-btn');

      // Click nav buttons
      prevBtn.click();
      const counterPrev = carouselEl.querySelector('.carousel-counter')?.textContent;
      nextBtn.click();
      const counterNext = carouselEl.querySelector('.carousel-counter')?.textContent;

      const openBeforeClose = window.HybridApp.player.isScreenshotCarouselOpen();

      // Click close button
      closeBtn.click();

      await new Promise((r) => setTimeout(r, 350));
      const openAfterClose = window.HybridApp.player.isScreenshotCarouselOpen();

      return {
        counterPrev,
        counterNext,
        openBeforeClose,
        openAfterClose,
      };
    });

    expect(mouseResult.counterPrev).toContain('1 / 1');
    expect(mouseResult.counterNext).toContain('1 / 1');
    expect(mouseResult.openBeforeClose).toBe(true);
    expect(mouseResult.openAfterClose).toBe(false);
  });

  test('Scenario 9: Rapid Ctrl + Z toggle open/close consistency', async () => {
    const rapidResult = await window.evaluate(async () => {
      // Toggle 1: Open
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      const open1 = window.HybridApp.player.isScreenshotCarouselOpen();

      // Toggle 2: Close
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      const open2 = window.HybridApp.player.isScreenshotCarouselOpen();

      // Toggle 3: Open again
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      const open3 = window.HybridApp.player.isScreenshotCarouselOpen();

      // Clean close with Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 300));
      const open4 = window.HybridApp.player.isScreenshotCarouselOpen();

      return {
        open1,
        open2,
        open3,
        open4,
      };
    });

    expect(rapidResult.open1).toBe(true);
    expect(rapidResult.open2).toBe(false);
    expect(rapidResult.open3).toBe(true);
    expect(rapidResult.open4).toBe(false);
  });

  test('Scenario 10: Full lifecycle: Take -> Delete (D) -> Restore Carousel (Ctrl + Z) -> Delete Carousel (Ctrl + D) -> Quick Undo (Z)', async () => {
    const testFile = path.join(tempScreenshotDir, 'lifecycle_test.png');
    fs.writeFileSync(testFile, 'lifecycle-data');

    const cycleResult = await window.evaluate(async ({ filePath }) => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // 1. Take / Record screenshot
      window.HybridApp.player.closeScreenshotCarousel?.();
      window.HybridApp.player._sessionScreenshots = [];
      window.HybridApp.player._singleScreenshotStack = [];
      window.HybridApp.player._deletedScreenshotStack = [];
      window.HybridApp.player._recordSingleScreenshot({ filePath, fileName: 'lifecycle_test.png', previewDataUrl: 'data:image/png;base64,lifecycle' });

      // 2. Delete with single tap D
      await window.HybridApp.player.deleteLatestScreenshot();
      const deleted1 = window.HybridApp.player._deletedScreenshotStack.length;

      // 3. Open Restore Carousel with Ctrl + Z and restore with Z
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 600));
      const activeAfterRestore = window.HybridApp.player._sessionScreenshots.length;

      // 4. Open Delete Carousel with Ctrl + D and delete with Enter
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', ctrlKey: true, bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 600));
      const deletedAfterCarousel = window.HybridApp.player._deletedScreenshotStack.length;

      // 5. Quick restore with single tap Z
      await window.HybridApp.player.restoreLatestScreenshot();
      const finalActive = window.HybridApp.player._sessionScreenshots.length;
      const finalDeleted = window.HybridApp.player._deletedScreenshotStack.length;

      return {
        deleted1,
        activeAfterRestore,
        deletedAfterCarousel,
        finalActive,
        finalDeleted,
        toasts,
      };
    }, { filePath: testFile });

    expect(cycleResult.deleted1).toBe(1);
    expect(cycleResult.activeAfterRestore).toBe(1);
    expect(cycleResult.deletedAfterCarousel).toBe(1);
    expect(cycleResult.finalActive).toBe(1);
    expect(cycleResult.finalDeleted).toBe(0);
    expect(fs.existsSync(testFile)).toBe(true);
  });
});
