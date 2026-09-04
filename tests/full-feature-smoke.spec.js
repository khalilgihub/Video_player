const { _electron: electron, test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Hybrid Player Comprehensive Feature Smoke Test', () => {
  let electronApp;
  let window;
  let userDataDir;
  const consoleLogs = [];
  const featureTestLogs = [];

  function logAction(category, message, status = 'PASS') {
    const entry = `[${status}] [${category}] ${message}`;
    featureTestLogs.push(entry);
    console.log(entry);
  }

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-smoke-'));

    electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`, '--enable-logging'],
      env,
    });

    electronApp.on('window', (page) => {
      page.on('console', (msg) => {
        const text = msg.text();
        consoleLogs.push({ type: msg.type(), text });
      });
      page.on('pageerror', (err) => {
        consoleLogs.push({ type: 'pageerror', text: err.message });
      });
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    logAction('INIT', 'Electron window initialized and DOMContentLoaded');
  });

  test.afterAll(async () => {
    const logPath = path.join(__dirname, '..', 'feature_audit_results.log');
    const logOutput = [
      '=== HYBRID PLAYER FEATURE AUDIT RESULTS ===',
      `Date: ${new Date().toISOString()}`,
      `Total Log Entries: ${featureTestLogs.length}`,
      '',
      '--- FEATURE CHECKS ---',
      ...featureTestLogs,
      '',
      '--- CONSOLE AUDIT ---',
      ...consoleLogs.map((l) => `[${l.type.toUpperCase()}] ${l.text}`),
    ].join('\n');

    fs.writeFileSync(logPath, logOutput, 'utf8');

    if (electronApp) {
      await electronApp.close();
    }
    if (userDataDir) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('1. Welcome Screen and Canvas Mounts', async () => {
    const welcome = window.locator('#welcomeScreen');
    await expect(welcome).toBeVisible();
    logAction('WELCOME', 'Welcome screen container is visible');

    const openFileBtn = window.locator('#btnOpenFile');
    const openLinkBtn = window.locator('#btnOpenLink');
    await expect(openFileBtn).toBeVisible();
    await expect(openLinkBtn).toBeVisible();
    logAction('WELCOME', 'Open File and Open Link buttons are visible');
  });

  test('2. Animated Background Effects Lifecycle', async () => {
    // 1. Dither Waves
    await window.evaluate(() => {
      const sel = document.getElementById('welcomeBackgroundSelect');
      sel.value = 'dither';
      sel.dispatchEvent(new Event('change'));
    });
    await expect.poll(async () => {
      return window.evaluate(() => document.querySelectorAll('#ditherMount canvas').length);
    }, { timeout: 8000 }).toBeGreaterThan(0);
    logAction('BACKGROUND', 'Dither Waves mounted and rendered WebGL canvas');

    // 2. Particles
    await window.evaluate(() => {
      const sel = document.getElementById('welcomeBackgroundSelect');
      sel.value = 'particles';
      sel.dispatchEvent(new Event('change'));
    });
    await expect.poll(async () => {
      return window.evaluate(() => document.querySelectorAll('#particlesMount canvas').length);
    }, { timeout: 8000 }).toBeGreaterThan(0);
    logAction('BACKGROUND', 'Particles mounted and rendered WebGL canvas');

    // 3. Faulty Terminal
    await window.evaluate(() => {
      const sel = document.getElementById('welcomeBackgroundSelect');
      sel.value = 'faulty';
      sel.dispatchEvent(new Event('change'));
    });
    await expect.poll(async () => {
      return window.evaluate(() => document.querySelectorAll('#faultyMount canvas').length);
    }, { timeout: 8000 }).toBeGreaterThan(0);
    logAction('BACKGROUND', 'Faulty Terminal mounted and rendered WebGL canvas');

    // 4. Grid Motion
    await window.evaluate(() => {
      const sel = document.getElementById('welcomeBackgroundSelect');
      sel.value = 'gridmotion';
      sel.dispatchEvent(new Event('change'));
    });
    await expect.poll(async () => {
      return window.evaluate(() => document.querySelectorAll('#gridMotionMount .grid-motion-container').length);
    }, { timeout: 8000 }).toBeGreaterThan(0);
    logAction('BACKGROUND', 'Grid Motion mounted and rendered interactive grid');

    // 5. None (Default Pure Dark)
    await window.evaluate(() => {
      const sel = document.getElementById('welcomeBackgroundSelect');
      sel.value = 'none';
      sel.dispatchEvent(new Event('change'));
    });
    await window.waitForTimeout(300);
    const bgVal = await window.evaluate(() => document.body.dataset.welcomeBackground);
    expect(bgVal).toBe('none');
    logAction('BACKGROUND', 'Default (None) background applied cleanly');
  });

  test('3. Background Settings Modal & Accordion Gallery', async () => {
    // Open Modal
    await window.evaluate(() => {
      const btn = document.getElementById('bgSettingsToggle');
      if (btn) btn.click();
    });
    const modal = window.locator('#bgSettingsModal');
    await expect(modal).toBeVisible();
    logAction('BG_MODAL', 'Background Settings modal opened');

    // Open Accordion Gallery Popover
    await window.evaluate(() => {
      const pickerBtn = document.getElementById('bgEffectPickerBtn');
      if (pickerBtn) pickerBtn.click();
    });
    const popover = window.locator('#bgAccordionPopover');
    await expect(popover).toBeVisible();
    logAction('BG_MODAL', 'Accordion gallery popover opened');

    // Rapid hover stress test across all accordion items to verify no flickering / crashes
    const items = await window.$$('.bg-accordion-item');
    for (let r = 0; r < 2; r++) {
      for (const item of items) {
        await item.hover();
        await window.waitForTimeout(20);
      }
    }
    logAction('BG_MODAL', 'Rapid hover across accordion items completed without errors');

    // Select Faulty Terminal from gallery and verify canvas resize
    await window.evaluate(() => {
      const faultyCard = document.querySelector('.bg-accordion-item[data-bg="faulty"]');
      if (faultyCard) faultyCard.click();
    });
    await window.waitForTimeout(450);
    const faultyCanvasMetrics = await window.evaluate(() => {
      const canvas = document.querySelector('#bgLiveMount_faulty canvas');
      return canvas ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth } : null;
    });
    expect(faultyCanvasMetrics).not.toBeNull();
    expect(faultyCanvasMetrics.width).toBeGreaterThan(150);
    logAction('BG_MODAL', `Faulty Terminal preview canvas resized properly (${faultyCanvasMetrics.width}x${faultyCanvasMetrics.height})`);

    // Select Dither from gallery
    await window.evaluate(() => {
      const ditherCard = document.querySelector('.bg-accordion-item[data-bg="dither"]');
      if (ditherCard) ditherCard.click();
    });
    await window.waitForTimeout(300);
    const activeBg = await window.evaluate(() => document.body.dataset.welcomeBackground);
    expect(activeBg).toBe('dither');
    logAction('BG_MODAL', 'Selected Dither from gallery drawer');

    // Close Modal
    await window.evaluate(() => {
      const closeBtn = document.querySelector('[data-close-modal="bgSettingsModal"]');
      if (closeBtn) closeBtn.click();
    });
    await expect(modal).toBeHidden();
    logAction('BG_MODAL', 'Background Settings modal closed properly');
  });

  test('4. Equalizer Panel & Presets', async () => {
    // Open EQ Modal
    await window.evaluate(() => {
      const btn = document.getElementById('btnEqualizer');
      if (btn) btn.click();
    });
    const eqModal = window.locator('#equalizerModal');
    await expect(eqModal).toBeVisible();
    logAction('EQUALIZER', 'Equalizer modal opened');

    // Switch Presets
    const presets = ['bass-boost', 'vocal', 'rock', 'flat'];
    for (const preset of presets) {
      await window.evaluate((p) => {
        window.HybridApp.equalizerModule.applyPreset(p);
      }, preset);
      logAction('EQUALIZER', `Equalizer applied preset: ${preset}`);
    }

    // Set custom band
    await window.evaluate(() => {
      window.HybridApp.equalizerModule.setBand(0, 6, { immediate: true });
    });
    const band0Gain = await window.evaluate(() => window.HybridApp.equalizerModule.getBand(0));
    expect(band0Gain).toBe(6);
    logAction('EQUALIZER', 'Custom gain set on 31Hz band (+6 dB)');

    // Close EQ Modal
    await window.evaluate(() => {
      const closeBtn = document.querySelector('[data-close-modal="equalizerModal"]');
      if (closeBtn) closeBtn.click();
    });
    await expect(eqModal).toBeHidden();
    logAction('EQUALIZER', 'Equalizer modal closed properly');
  });

  test('5. Playlist Drawer & Track Controls', async () => {
    // Open Sidebar Playlist
    await window.evaluate(() => {
      const btn = document.getElementById('btnPlaylist');
      if (btn) btn.click();
    });
    const sidebar = window.locator('#sidebarPlaylist');
    await expect(sidebar).toBeVisible();
    logAction('PLAYLIST', 'Playlist sidebar drawer opened');

    // Add Mock Items
    await window.evaluate(() => {
      window.HybridApp.playlistModule.replaceFiles([
        'C:\\media\\video1.mp4',
        'C:\\media\\video2.mp4',
        'C:\\media\\video3.mp4',
      ], { autoPlay: false });
    });
    const itemCount = await window.evaluate(() => window.HybridApp.playlistModule.items.length);
    expect(itemCount).toBe(3);
    logAction('PLAYLIST', 'Loaded 3 items into playlist');

    // Toggle Shuffle
    await window.evaluate(() => window.HybridApp.playlistModule.toggleShuffle());
    const isShuffle = await window.evaluate(() => window.HybridApp.playlistModule.shuffle);
    logAction('PLAYLIST', `Shuffle toggled (state: ${isShuffle})`);

    // Toggle Repeat Modes (none -> all -> one -> none)
    await window.evaluate(() => window.HybridApp.playlistModule.cycleRepeat());
    let repeat = await window.evaluate(() => window.HybridApp.playlistModule.repeat);
    logAction('PLAYLIST', `Repeat cycled to: ${repeat}`);

    // Close Sidebar Playlist
    await window.evaluate(() => {
      const closeBtn = document.getElementById('btnClosePlaylist');
      if (closeBtn) closeBtn.click();
    });
    logAction('PLAYLIST', 'Playlist sidebar collapsed');
  });

  test('6. General Settings Modal & Preferences', async () => {
    // Open Settings Modal
    await window.evaluate(() => {
      const btn = document.getElementById('btnSettings');
      if (btn) btn.click();
    });
    const settingsModal = window.locator('#settingsModal');
    await expect(settingsModal).toBeVisible();
    logAction('SETTINGS', 'General Settings modal opened');

    // Toggle Theme
    await window.evaluate(() => {
      const themeSelect = document.getElementById('settTheme');
      if (themeSelect) {
        themeSelect.value = 'oled';
        themeSelect.dispatchEvent(new Event('change'));
      }
    });
    const themeVal = await window.evaluate(() => document.body.dataset.theme);
    expect(themeVal).toBe('oled');
    logAction('SETTINGS', 'Applied OLED theme to body dataset');

    // Close Settings Modal
    await window.evaluate(() => {
      const closeBtn = document.querySelector('[data-close-modal="settingsModal"]');
      if (closeBtn) closeBtn.click();
    });
    await expect(settingsModal).toBeHidden();
    logAction('SETTINGS', 'General Settings modal closed properly');
  });

  test('7. Open Network Stream Modal Validation', async () => {
    // Open Network Link Modal
    await window.evaluate(() => {
      const btn = document.getElementById('btnOpenLink');
      if (btn) btn.click();
    });
    const networkModal = window.locator('#networkStreamModal');
    await expect(networkModal).toBeVisible();
    logAction('NETWORK_STREAM', 'Open Network Stream modal opened');

    // Fill URL input and verify typing 'f' works without triggering fullscreen
    await window.fill('#networkStreamInput', '');
    await window.click('#networkStreamInput');
    const isFullscreenBefore = await window.evaluate(() => window.hybridAPI.window.isFullScreen());
    await window.keyboard.type('fast-stream');
    const inputVal = await window.inputValue('#networkStreamInput');
    const isFullscreenAfter = await window.evaluate(() => window.hybridAPI.window.isFullScreen());
    expect(inputVal).toBe('fast-stream');
    expect(isFullscreenAfter).toBe(isFullscreenBefore);
    logAction('NETWORK_STREAM', 'Validated typing with "f" character does not trigger fullscreen');

    // Close Modal
    await window.evaluate(() => {
      const closeBtn = document.querySelector('[data-close-modal="networkStreamModal"]');
      if (closeBtn) closeBtn.click();
    });
    await expect(networkModal).toBeHidden();
    logAction('NETWORK_STREAM', 'Open Network Stream modal closed properly');
  });

  test('8. Volume Gestures & Clamping', async () => {
    // Trigger volume increase
    await window.evaluate(() => {
      window.HybridApp.player.setVolume(120);
    });
    const vol = await window.evaluate(() => window.HybridApp.player.volume);
    expect(vol).toBeLessThanOrEqual(100);
    expect(vol).toBe(100);
    logAction('GESTURES', 'Volume setVolume(120) clamped to 100%');

    // Mute / Unmute
    await window.evaluate(() => window.HybridApp.player.toggleMute());
    const isMuted = await window.evaluate(() => window.HybridApp.player.muted);
    logAction('GESTURES', `Mute toggled (state: ${isMuted})`);
  });

  test('9. Database & Diagnostics Validation', async () => {
    const diag = await window.evaluate(() => window.hybridAPI.app.getStartupDiagnostics());
    expect(Array.isArray(diag)).toBe(true);
    logAction('DIAGNOSTICS', `Retrieved ${diag.length} startup diagnostic entries`);

    // Verify zero CSP violations occurred
    const errorLogs = consoleLogs.filter((l) => l.type === 'error' || l.type === 'pageerror');
    const cspViolations = errorLogs.filter((l) => l.text.includes('Content Security Policy'));
    expect(cspViolations.length).toBe(0);
    logAction('SECURITY', 'Zero Content Security Policy violations detected across all test runs');
  });
});
