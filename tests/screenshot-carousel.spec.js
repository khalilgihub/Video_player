const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Screenshot Delete Carousel (Ctrl + D) — Choice C', () => {
  let electronApp;
  let window;
  let userDataDir;
  let tempScreenshotDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-carousel-test-'));
    tempScreenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-carousel-shots-'));

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

  test('Scenario 1: Ctrl + D with empty session shows warning toast and does not open carousel', async () => {
    await window.waitForFunction(() => !!window.HybridApp?.player, null, { timeout: 10000 });
    const result = await window.evaluate(async () => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Reset stacks
      window.HybridApp.player._singleScreenshotStack = [];
      window.HybridApp.player._sessionScreenshots = [];
      window.HybridApp.player.closeScreenshotCarousel?.();

      // Trigger Ctrl + D via shortcuts module
      const e = new KeyboardEvent('keydown', {
        code: 'KeyD',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(e);

      const isOpen = window.HybridApp.player.isScreenshotCarouselOpen?.();
      return {
        toasts,
        isOpen,
      };
    });

    expect(result.isOpen).toBe(false);
    expect(result.toasts).toContain('⚠️ No session screenshots to delete');
  });

  test('Scenario 2: Open carousel with 3 session screenshots -> default to newest (3 / 3)', async () => {
    const file1 = path.join(tempScreenshotDir, 'shot_s1.png');
    const file2 = path.join(tempScreenshotDir, 'shot_s2.png');
    const file3 = path.join(tempScreenshotDir, 'shot_s3.png');
    fs.writeFileSync(file1, 'fake-1');
    fs.writeFileSync(file2, 'fake-2');
    fs.writeFileSync(file3, 'fake-3');

    const result = await window.evaluate(async ({ f1, f2, f3 }) => {
      // Record 3 single screenshots
      window.HybridApp.player._sessionScreenshots = [];
      window.HybridApp.player._singleScreenshotStack = [];

      window.HybridApp.player._recordSingleScreenshot({ filePath: f1, fileName: 'shot_s1.png', previewDataUrl: 'data:image/png;base64,111' });
      window.HybridApp.player._recordSingleScreenshot({ filePath: f2, fileName: 'shot_s2.png', previewDataUrl: 'data:image/png;base64,222' });
      window.HybridApp.player._recordSingleScreenshot({ filePath: f3, fileName: 'shot_s3.png', previewDataUrl: 'data:image/png;base64,333' });

      // Open carousel via Ctrl + D
      const e = new KeyboardEvent('keydown', {
        code: 'KeyD',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(e);

      const isOpen = window.HybridApp.player.isScreenshotCarouselOpen();
      const carouselEl = document.getElementById('screenshotCarousel');
      const counterText = carouselEl?.querySelector('.carousel-counter')?.textContent;
      const fileNameText = carouselEl?.querySelector('.carousel-filename')?.textContent;
      const imgSource = carouselEl?.querySelector('img')?.src;

      return {
        isOpen,
        counterText,
        fileNameText,
        imgSource,
      };
    }, { f1: file1, f2: file2, f3: file3 });

    expect(result.isOpen).toBe(true);
    expect(result.counterText).toContain('3 / 3');
    expect(result.fileNameText).toBe('shot_s3.png');
    expect(result.imgSource).toContain('333');
  });

  test('Scenario 3: Navigate with ArrowLeft and ArrowRight without triggering video seek', async () => {
    const navResult = await window.evaluate(async () => {
      let seekCalled = false;
      const origSeek = window.HybridApp.player.seekRelative;
      window.HybridApp.player.seekRelative = () => { seekCalled = true; };

      // Press ArrowLeft
      const leftEvent = new KeyboardEvent('keydown', {
        code: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(leftEvent);

      const carouselEl = document.getElementById('screenshotCarousel');
      const step1Counter = carouselEl?.querySelector('.carousel-counter')?.textContent;
      const step1File = carouselEl?.querySelector('.carousel-filename')?.textContent;

      // Press ArrowLeft again
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true, cancelable: true }));
      const step2Counter = carouselEl?.querySelector('.carousel-counter')?.textContent;
      const step2File = carouselEl?.querySelector('.carousel-filename')?.textContent;

      // Press ArrowRight to move back to s2
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true, cancelable: true }));
      const step3Counter = carouselEl?.querySelector('.carousel-counter')?.textContent;
      const step3File = carouselEl?.querySelector('.carousel-filename')?.textContent;

      // Restore original seek
      window.HybridApp.player.seekRelative = origSeek;

      return {
        seekCalled,
        step1Counter,
        step1File,
        step2Counter,
        step2File,
        step3Counter,
        step3File,
      };
    });

    expect(navResult.seekCalled).toBe(false);
    expect(navResult.step1Counter).toContain('2 / 3');
    expect(navResult.step1File).toBe('shot_s2.png');
    expect(navResult.step2Counter).toContain('1 / 3');
    expect(navResult.step2File).toBe('shot_s1.png');
    expect(navResult.step3Counter).toContain('2 / 3');
    expect(navResult.step3File).toBe('shot_s2.png');
  });

  test('Scenario 4: Choice C: Delete selected screenshot (shot_s2) -> immediate close, toast, file removed', async () => {
    const file2 = path.join(tempScreenshotDir, 'shot_s2.png');
    fs.writeFileSync(file2, 'fake-2');
    expect(fs.existsSync(file2)).toBe(true);

    const delResult = await window.evaluate(async () => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Press Enter to delete selected
      const enterEvent = new KeyboardEvent('keydown', {
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(enterEvent);

      // Wait for deletion execution and close timer
      await new Promise((r) => setTimeout(r, 550));

      const isOpen = window.HybridApp.player.isScreenshotCarouselOpen();
      const remainingShots = window.HybridApp.player._sessionScreenshots.map((s) => s.fileName);
      const remainingStack = [...window.HybridApp.player._singleScreenshotStack];
      const undoCount = window.HybridApp.player._deletedScreenshotStack.length;

      return {
        isOpen,
        toasts,
        remainingShots,
        remainingStack,
        undoCount,
      };
    });

    // Carousel must be immediately closed
    expect(delResult.isOpen).toBe(false);
    // Toast must confirm deletion
    expect(delResult.toasts.some((t) => t.includes('shot_s2.png'))).toBe(true);
    // shot_s2 removed from session list and stack
    expect(delResult.remainingShots).toEqual(['shot_s1.png', 'shot_s3.png']);
    expect(delResult.remainingStack.some((p) => p.includes('shot_s2.png'))).toBe(false);
    expect(delResult.undoCount).toBe(1);

    // File on disk must be moved to undo staging
    expect(fs.existsSync(file2)).toBe(false);
  });

  test('Scenario 5: Undo restoration (Key Z) restores shot_s2 to disk and back into session list', async () => {
    const file2 = path.join(tempScreenshotDir, 'shot_s2.png');

    const restoreResult = await window.evaluate(async () => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Press KeyZ
      await window.HybridApp.player.restoreLatestScreenshot();

      const sessionShots = window.HybridApp.player._sessionScreenshots.map((s) => s.fileName);
      const singleStack = [...window.HybridApp.player._singleScreenshotStack];
      const undoCount = window.HybridApp.player._deletedScreenshotStack.length;

      return {
        toasts,
        sessionShots,
        singleStack,
        undoCount,
      };
    });

    // File must be restored to disk
    expect(fs.existsSync(file2)).toBe(true);
    expect(restoreResult.toasts.some((t) => t.includes('Restored screenshot: shot_s2.png'))).toBe(true);
    expect(restoreResult.sessionShots).toContain('shot_s2.png');
    expect(restoreResult.undoCount).toBe(0);
  });

  test('Scenario 6: Escape key cancels and closes carousel without deleting any files', async () => {
    const escResult = await window.evaluate(async () => {
      // Re-open carousel with Ctrl + D
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', ctrlKey: true, bubbles: true, cancelable: true }));
      const openBeforeEsc = window.HybridApp.player.isScreenshotCarouselOpen();

      // Press Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true }));

      // Wait for closing animation
      await new Promise((r) => setTimeout(r, 400));
      const openAfterEsc = window.HybridApp.player.isScreenshotCarouselOpen();

      const sessionCount = window.HybridApp.player._sessionScreenshots.length;

      return {
        openBeforeEsc,
        openAfterEsc,
        sessionCount,
      };
    });

    expect(escResult.openBeforeEsc).toBe(true);
    expect(escResult.openAfterEsc).toBe(false);
    expect(escResult.sessionCount).toBe(3); // None were deleted
  });

  test('Scenario 7: Mouse navigation (< > buttons) and KeyD delete', async () => {
    const mouseResult = await window.evaluate(async () => {
      const toasts = [];
      window.HybridToast = {
        show: (msg) => toasts.push(msg),
      };

      // Open carousel
      window.HybridApp.player.openScreenshotCarousel();
      const carouselEl = document.getElementById('screenshotCarousel');

      // Click < (previous) button
      const prevBtn = carouselEl.querySelector('.carousel-nav-btn.prev');
      prevBtn.click();
      const afterPrevCounter = carouselEl.querySelector('.carousel-counter').textContent;

      // Click > (next) button
      const nextBtn = carouselEl.querySelector('.carousel-nav-btn.next');
      nextBtn.click();
      const afterNextCounter = carouselEl.querySelector('.carousel-counter').textContent;

      // Press KeyD to delete selected screenshot
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true, cancelable: true }));

      await new Promise((r) => setTimeout(r, 550));
      const isOpen = window.HybridApp.player.isScreenshotCarouselOpen();

      return {
        afterPrevCounter,
        afterNextCounter,
        isOpen,
        toasts,
      };
    });

    expect(mouseResult.afterPrevCounter).toContain('2 / 3');
    expect(mouseResult.afterNextCounter).toContain('3 / 3');
    expect(mouseResult.isOpen).toBe(false);
    expect(mouseResult.toasts.some((t) => t.includes('Deleted screenshot'))).toBe(true);
  });

  test('Scenario 8: Top-left notice on Z, D, and Ctrl+D when empty, plus redesigned SVG chevrons', async () => {
    const noticeResult = await window.evaluate(async () => {
      // 1. Reset stacks
      window.HybridApp.player._singleScreenshotStack = [];
      window.HybridApp.player._deletedScreenshotStack = [];
      window.HybridApp.player._sessionScreenshots = [];
      window.HybridApp.player.closeScreenshotCarousel?.();

      // Test D (delete empty)
      await window.HybridApp.player.deleteLatestScreenshot();
      const dNoticeEl = document.getElementById('screenshotNotice');
      const dNoticeText = dNoticeEl?.textContent || '';
      const dNoticeVisible = dNoticeEl && dNoticeEl.style.display !== 'none';

      // Test Z (restore empty)
      await window.HybridApp.player.restoreLatestScreenshot();
      const zNoticeEl = document.getElementById('screenshotNotice');
      const zNoticeText = zNoticeEl?.textContent || '';
      const zNoticeVisible = zNoticeEl && zNoticeEl.style.display !== 'none';

      // Test Ctrl + D (carousel empty)
      window.HybridApp.player.openScreenshotCarousel();
      const ctrlDNoticeEl = document.getElementById('screenshotNotice');
      const ctrlDNoticeText = ctrlDNoticeEl?.textContent || '';
      const ctrlDNoticeVisible = ctrlDNoticeEl && ctrlDNoticeEl.style.display !== 'none';

      // Test redesigned < > SVG icons
      window.HybridApp.player._recordSingleScreenshot({
        filePath: 'C:/fake/sample.png',
        fileName: 'sample.png',
        previewDataUrl: 'data:image/png;base64,aaa',
      });
      window.HybridApp.player.openScreenshotCarousel();
      const carouselEl = document.getElementById('screenshotCarousel');
      const prevSvg = carouselEl?.querySelector('.carousel-nav-btn.prev svg');
      const nextSvg = carouselEl?.querySelector('.carousel-nav-btn.next svg');
      const hasSvgChevrons = !!prevSvg && !!nextSvg;

      window.HybridApp.player.closeScreenshotCarousel();

      return {
        dNoticeText,
        dNoticeVisible,
        zNoticeText,
        zNoticeVisible,
        ctrlDNoticeText,
        ctrlDNoticeVisible,
        hasSvgChevrons,
      };
    });

    expect(noticeResult.dNoticeVisible).toBe(true);
    expect(noticeResult.dNoticeText).toContain('No screenshots to delete');
    expect(noticeResult.zNoticeVisible).toBe(true);
    expect(noticeResult.zNoticeText).toContain('No screenshots to restore');
    expect(noticeResult.ctrlDNoticeVisible).toBe(true);
    expect(noticeResult.ctrlDNoticeText).toContain('No screenshots to delete');
    expect(noticeResult.hasSvgChevrons).toBe(true);
  });

  test('Scenario 9: Pressing Escape while carousel is open in fullscreen mode closes carousel without exiting fullscreen', async () => {
    const fsResult = await window.evaluate(async () => {
      // Simulate fullscreen active
      let exitFullscreenCalled = false;
      const origExit = window.hybridAPI.window.fullscreen;
      window.hybridAPI.window.fullscreen = async (state) => {
        if (!state) exitFullscreenCalled = true;
        return state;
      };

      // Ensure 1 screenshot in session and open carousel
      window.HybridApp.player._sessionScreenshots = [];
      window.HybridApp.player._recordSingleScreenshot({
        filePath: 'C:/fake/sample_fs.png',
        fileName: 'sample_fs.png',
        previewDataUrl: 'data:image/png;base64,aaa',
      });
      window.HybridApp.player.openScreenshotCarousel();

      const openBefore = window.HybridApp.player.isScreenshotCarouselOpen();

      // Dispatch Escape keydown
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));

      // Wait for carousel close animation
      await new Promise((r) => setTimeout(r, 300));
      const openAfter = window.HybridApp.player.isScreenshotCarouselOpen();

      // Restore mock
      window.hybridAPI.window.fullscreen = origExit;

      return {
        openBefore,
        openAfter,
        exitFullscreenCalled,
      };
    });

    expect(fsResult.openBefore).toBe(true);
    expect(fsResult.openAfter).toBe(false);
    expect(fsResult.exitFullscreenCalled).toBe(false);
  });
});
