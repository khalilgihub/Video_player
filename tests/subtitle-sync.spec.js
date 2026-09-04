const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Subtitle Sync Slider and Seconds Adjustment', () => {
  let electronApp;
  let window;
  let userDataDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-subtitlesync-test-'));
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

  test('should render subtitle sync slider, seconds badge, and steppers in Subtitle Modal', async () => {
    const btnSubtitles = window.locator('#btnSubtitles');
    await expect(btnSubtitles).toBeAttached();

    // Open Subtitle Modal (emulate media loaded)
    await window.evaluate(() => {
      const welcome = document.getElementById('welcomeScreen');
      if (welcome) welcome.classList.add('hidden');
      window.HybridApp.controlsModule.toggleModal('subtitleModal');
    });

    const modal = window.locator('#subtitleModal');
    await expect(modal).toBeVisible();

    const slider = window.locator('#subSyncSlider');
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute('min', '-10');
    await expect(slider).toHaveAttribute('max', '10');
    await expect(slider).toHaveAttribute('step', '0.1');

    const valueBadge = window.locator('#subSyncValue');
    await expect(valueBadge).toHaveText('0.0s');

    await expect(window.locator('#subSyncMinusLarge')).toBeVisible();
    await expect(window.locator('#subSyncMinus')).toBeVisible();
    await expect(window.locator('#subSyncReset')).toBeVisible();
    await expect(window.locator('#subSyncPlus')).toBeVisible();
    await expect(window.locator('#subSyncPlusLarge')).toBeVisible();
  });

  test('should adjust subtitle sync delay in seconds and update slider', async () => {
    const result = await window.evaluate(() => {
      const subModule = window.HybridApp.subtitleModule;
      subModule.setSyncOffset(0);

      // +0.5s
      subModule.adjustSync(0.5);
      const val1 = document.getElementById('subSyncValue')?.textContent;
      const slider1 = document.getElementById('subSyncSlider')?.value;

      // -0.1s twice (+0.3s)
      subModule.adjustSync(-0.2);
      const val2 = document.getElementById('subSyncValue')?.textContent;
      const slider2 = document.getElementById('subSyncSlider')?.value;

      // -1.0s (-0.7s total)
      subModule.adjustSync(-1.0);
      const val3 = document.getElementById('subSyncValue')?.textContent;
      const slider3 = document.getElementById('subSyncSlider')?.value;

      // Reset to 0.0s
      subModule.setSyncOffset(0);
      const val4 = document.getElementById('subSyncValue')?.textContent;
      const slider4 = document.getElementById('subSyncSlider')?.value;

      return { val1, slider1, val2, slider2, val3, slider3, val4, slider4 };
    });

    expect(result.val1).toBe('+0.5s');
    expect(result.slider1).toBe('0.5');
    expect(result.val2).toBe('+0.3s');
    expect(result.slider2).toBe('0.3');
    expect(result.val3).toBe('-0.7s');
    expect(result.slider3).toBe('-0.7');
    expect(result.val4).toBe('0.0s');
    expect(result.slider4).toBe('0');
  });

  test('should handle slider input events directly and update display in seconds', async () => {
    const result = await window.evaluate(() => {
      const slider = document.getElementById('subSyncSlider');
      slider.value = '1.4';
      slider.dispatchEvent(new Event('input', { bubbles: true }));

      const val = document.getElementById('subSyncValue')?.textContent;
      const currentOffset = window.HybridApp.subtitleModule.syncOffset;

      return { val, currentOffset };
    });

    expect(result.val).toBe('+1.4s');
    expect(result.currentOffset).toBe(1.4);
  });

  test('should adjust subtitle sync via quick step buttons and reset button', async () => {
    const result = await window.evaluate(() => {
      const subModule = window.HybridApp.subtitleModule;
      subModule.setSyncOffset(0);

      const btnPlusLarge = document.getElementById('subSyncPlusLarge');
      const btnMinus = document.getElementById('subSyncMinus');
      const btnReset = document.getElementById('subSyncReset');

      btnPlusLarge.click();
      const valAfterPlusLarge = document.getElementById('subSyncValue')?.textContent;

      btnMinus.click();
      const valAfterMinus = document.getElementById('subSyncValue')?.textContent;

      btnReset.click();
      const valAfterReset = document.getElementById('subSyncValue')?.textContent;

      return { valAfterPlusLarge, valAfterMinus, valAfterReset };
    });

    expect(result.valAfterPlusLarge).toBe('+0.5s');
    expect(result.valAfterMinus).toBe('+0.4s');
    expect(result.valAfterReset).toBe('0.0s');
  });

  test('should handle legacy ms offset inputs and convert to seconds properly', async () => {
    const result = await window.evaluate(() => {
      const subModule = window.HybridApp.subtitleModule;
      // Pass 750ms
      subModule.setSyncOffset(750, { isMs: true });
      const val = document.getElementById('subSyncValue')?.textContent;
      const offset = subModule.syncOffset;

      // Pass -1500 (legacy > 20)
      subModule.setSyncOffset(-1500);
      const val2 = document.getElementById('subSyncValue')?.textContent;
      const offset2 = subModule.syncOffset;

      return { val, offset, val2, offset2 };
    });

    expect(result.val).toBe('+0.75s');
    expect(result.offset).toBe(0.75);
    expect(result.val2).toBe('-1.5s');
    expect(result.offset2).toBe(-1.5);
  });

  test('should trigger subtitle sync adjustment on G and H shortcut keys', async () => {
    const result = await window.evaluate(() => {
      const subModule = window.HybridApp.subtitleModule;
      subModule.setSyncOffset(0);

      // Close modals so shortcuts can fire
      document.querySelectorAll('.modal-overlay').forEach(m => { m.hidden = true; });

      // Dispatch KeyH (delay up +0.1s)
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', bubbles: true }));
      const val1 = subModule.syncOffset;

      // Dispatch KeyG (delay down -0.1s) twice (-0.1s total)
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }));
      const val2 = subModule.syncOffset;

      return { val1, val2 };
    });

    expect(result.val1).toBe(0.1);
    expect(result.val2).toBe(-0.1);
  });
});
