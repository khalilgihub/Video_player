/**
 * Comprehensive Visual and System QA Audit Script
 * Executes end-to-end audit scenarios, forces defects to manifest,
 * computes exact metrics (bounding boxes, contrast ratios, state flags),
 * and saves screenshot evidence to test-results/bug-evidence/.
 */
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ROOT_DIR, '..');
const EVIDENCE_DIRS = [
  path.resolve(ROOT_DIR, 'test-results', 'bug-evidence'),
  path.resolve(REPO_ROOT, 'test-results', 'bug-evidence'),
];

for (const dir of EVIDENCE_DIRS) {
  fs.mkdirSync(dir, { recursive: true });
}

function saveScreenshot(sourcePath, filename) {
  for (const dir of EVIDENCE_DIRS) {
    const dest = path.join(dir, filename);
    fs.copyFileSync(sourcePath, dest);
  }
}

async function captureScreen(window, filename, opts = {}) {
  const tempPath = path.join(os.tmpdir(), `temp-${Date.now()}-${filename}`);
  await window.screenshot({ path: tempPath, fullPage: true, ...opts });
  saveScreenshot(tempPath, filename);
  try { fs.unlinkSync(tempPath); } catch (_) {}
  console.log(`[CAPTURED] ${filename}`);
  return path.join('test-results', 'bug-evidence', filename);
}

async function captureElement(locator, filename) {
  const tempPath = path.join(os.tmpdir(), `temp-${Date.now()}-${filename}`);
  await locator.screenshot({ path: tempPath });
  saveScreenshot(tempPath, filename);
  try { fs.unlinkSync(tempPath); } catch (_) {}
  console.log(`[CAPTURED ELEMENT] ${filename}`);
  return path.join('test-results', 'bug-evidence', filename);
}

function writeEvidenceJson(filename, data) {
  for (const dir of EVIDENCE_DIRS) {
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
  }
}

// Contrast ratio utilities
function parseRgb(str) {
  if (!str) return null;
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (parts.length < 3 || parts.some(isNaN)) return null;
  return parts.slice(0, 3);
}

function srgbToLinear(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(rgbA, rgbB) {
  if (!rgbA || !rgbB) return null;
  const la = relativeLuminance(rgbA);
  const lb = relativeLuminance(rgbB);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

async function runAudit() {
  console.log('=== STARTING EXHAUSTIVE HYBRID PLAYER AUDIT ===');
  const SAMPLE_VIDEO = path.join(ROOT_DIR, 'test-sample.mp4');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-audit-full-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    args: [ROOT_DIR, `--user-data-dir=${userDataDir}`],
    env,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);

  const resize = async (w, h) => {
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      win.setSize(size.w, size.h);
    }, { w, h });
    await window.waitForTimeout(400);
  };

  // -------------------------------------------------------------
  // BUG-01: Control Bar Collision & Progress Scrubber Squeeze at 640x360 & 800x480 with Playlist Open
  // -------------------------------------------------------------
  console.log('--- Testing BUG-01: Control Bar Collision ---');
  await resize(640, 360);
  await window.evaluate(() => {
    const sidebar = document.getElementById('sidebarPlaylist');
    sidebar?.classList.remove('collapsed');
    document.body.classList.add('playlist-open');
    document.getElementById('welcomeScreen')?.classList.add('hidden');
    window.HybridApp.controlsModule.updateToolbarVisibility();
    window.HybridApp.controlsModule._showControlsNow();
  });
  await window.waitForTimeout(300);

  const metrics640 = await window.evaluate(() => {
    const left = document.querySelector('.controls-left')?.getBoundingClientRect();
    const right = document.querySelector('.controls-right')?.getBoundingClientRect();
    const bar = document.querySelector('.controls-bar')?.getBoundingClientRect();
    const progress = document.querySelector('#progressContainer')?.getBoundingClientRect();
    const time = document.querySelector('.time-display')?.getBoundingClientRect();
    return {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      barWidth: bar ? Math.round(bar.width) : null,
      leftWidth: left ? Math.round(left.width) : null,
      rightWidth: right ? Math.round(right.width) : null,
      controlsOverlap: (left && right) ? Math.max(0, left.right - right.left) : 0,
      progressWidth: progress ? Math.round(progress.width) : null,
      timeWidth: time ? Math.round(time.width) : null,
    };
  });
  await captureScreen(window, 'BUG-01-controlbar-640x360-playlist-repro.png');
  await captureElement(window.locator('#controlsWrapper'), 'BUG-01-controls-640x360-component-broken.png');

  await resize(800, 480);
  await window.waitForTimeout(300);
  const metrics800 = await window.evaluate(() => {
    const left = document.querySelector('.controls-left')?.getBoundingClientRect();
    const right = document.querySelector('.controls-right')?.getBoundingClientRect();
    const bar = document.querySelector('.controls-bar')?.getBoundingClientRect();
    const progress = document.querySelector('#progressContainer')?.getBoundingClientRect();
    return {
      windowWidth: window.innerWidth,
      barWidth: bar ? Math.round(bar.width) : null,
      leftWidth: left ? Math.round(left.width) : null,
      rightWidth: right ? Math.round(right.width) : null,
      controlsOverlap: (left && right) ? Math.max(0, left.right - right.left) : 0,
      progressWidth: progress ? Math.round(progress.width) : null,
    };
  });
  await captureScreen(window, 'BUG-01-controlbar-800x480-playlist-repro.png');
  writeEvidenceJson('BUG-01-metrics.json', { metrics640, metrics800 });

  // Reset playlist
  await window.evaluate(() => {
    document.body.classList.remove('playlist-open');
    document.getElementById('sidebarPlaylist')?.classList.add('collapsed');
    document.getElementById('welcomeScreen')?.classList.remove('hidden');
    window.HybridApp.controlsModule.updateToolbarVisibility();
  });
  await resize(1150, 720);

  // -------------------------------------------------------------
  // BUG-02: Light Theme Contrast: Settings Panel & Volume OSD Pill
  // -------------------------------------------------------------
  console.log('--- Testing BUG-02: Light Theme Contrast Failures ---');
  await window.evaluate(() => {
    document.body.dataset.theme = 'light';
    window.HybridApp.controlsModule.toggleModal('settingsModal');
    // Ensure yt-dlp status elements are populated
    const status = document.getElementById('settYtdlpStatus');
    const version = document.getElementById('settYtdlpVersion');
    if (status) status.textContent = 'Installed';
    if (version) version.textContent = '2026.10.01';
  });
  await window.waitForTimeout(400);

  const lightSettingsMetrics = await window.evaluate(() => {
    const modal = document.querySelector('.settings-modal');
    const status = document.getElementById('settYtdlpStatus');
    const version = document.getElementById('settYtdlpVersion');
    const modalCs = modal ? getComputedStyle(modal) : null;
    const statusCs = status ? getComputedStyle(status) : null;
    const versionCs = version ? getComputedStyle(version) : null;
    return {
      modalBg: modalCs?.backgroundColor,
      statusColor: statusCs?.color,
      versionColor: versionCs?.color,
    };
  });
  await captureScreen(window, 'BUG-02-light-theme-settings-repro.png');
  await captureElement(window.locator('#settingsModal'), 'BUG-02-settings-modal-component-broken.png');

  // Also check volume OSD pill under light theme
  await window.evaluate(() => {
    window.HybridApp.controlsModule.closeAllModals();
    window.HybridApp.player.currentFilePath = 'C:\\audit\\sample.mp4';
    window.HybridApp.controlsModule._showControlsNow();
    window.HybridApp.controlsModule.showVolumeOsd(45);
  });
  await window.waitForTimeout(300);

  const osdMetrics = await window.evaluate(() => {
    const osd = document.getElementById('volumeOsd');
    const val = document.getElementById('volumeOsdVal');
    const cs = osd ? getComputedStyle(osd) : null;
    const valCs = val ? getComputedStyle(val) : null;
    return {
      osdVisible: osd?.classList.contains('visible'),
      textColor: cs?.color,
      valColor: valCs?.color,
      shadow: cs?.textShadow,
      rect: osd ? osd.getBoundingClientRect() : null,
    };
  });
  await captureScreen(window, 'BUG-02-volume-osd-light-repro.png');
  await captureElement(window.locator('#volumeOsd'), 'BUG-02-volume-osd-component-broken.png');
  writeEvidenceJson('BUG-02-metrics.json', { lightSettingsMetrics, osdMetrics });

  await window.evaluate(() => {
    document.body.dataset.theme = 'dark';
    window.HybridApp.player.currentFilePath = null;
  });

  // -------------------------------------------------------------
  // BUG-03: OLED Theme Border & Divider Invisibility
  // -------------------------------------------------------------
  console.log('--- Testing BUG-03: OLED Theme Border Invisibility ---');
  await window.evaluate(() => {
    document.body.dataset.theme = 'oled';
    window.HybridApp.controlsModule.toggleModal('settingsModal');
  });
  await window.waitForTimeout(400);

  const oledMetrics = await window.evaluate(() => {
    const group = document.querySelector('#settingsModal .setting-group');
    const modal = document.querySelector('.settings-modal');
    const groupCs = group ? getComputedStyle(group) : null;
    const modalCs = modal ? getComputedStyle(modal) : null;
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      modalBg: modalCs?.backgroundColor,
      groupBorderColor: groupCs?.borderColor,
      groupBg: groupCs?.backgroundColor,
    };
  });
  const oledBorderRatio = contrastRatio(parseRgb(oledMetrics.groupBorderColor), parseRgb(oledMetrics.modalBg) || [0, 0, 0]);
  oledMetrics.borderVsBgContrast = oledBorderRatio;
  await captureScreen(window, 'BUG-03-oled-theme-dividers-repro.png');
  await captureElement(window.locator('#settingsModal'), 'BUG-03-oled-settings-component-broken.png');
  writeEvidenceJson('BUG-03-metrics.json', oledMetrics);

  await window.evaluate(() => {
    window.HybridApp.controlsModule.closeAllModals();
    document.body.dataset.theme = 'dark';
  });

  // -------------------------------------------------------------
  // BUG-04: Esc Key Resolution Hierarchy Collapse in Fullscreen
  // -------------------------------------------------------------
  console.log('--- Testing BUG-04: Esc Key Hierarchy Collapse in Fullscreen ---');
  // Load real video for playback tests
  await window.evaluate(async (p) => {
    await window.HybridApp.player.loadFile(p, { allowResume: false });
    await window.hybridAPI.mpv.pause();
  }, SAMPLE_VIDEO);
  await window.waitForTimeout(800);

  // Enter Fullscreen
  await window.evaluate(() => window.hybridAPI.window.fullscreen(true));
  await window.waitForTimeout(800);

  // Open Settings Modal
  await window.evaluate(() => {
    window.HybridApp.controlsModule._showControlsNow();
    window.HybridApp.controlsModule.toggleModal('settingsModal');
  });
  await window.waitForTimeout(500);

  // Populate session screenshots and open carousel (Ctrl+D)
  await window.evaluate(() => {
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    window.HybridApp.player._sessionScreenshots = [
      { filePath: 'C:/shot1.png', fileName: 'shot1.png', previewDataUrl: tinyPng, timestamp: Date.now(), timePos: 1 },
      { filePath: 'C:/shot2.png', fileName: 'shot2.png', previewDataUrl: tinyPng, timestamp: Date.now(), timePos: 2 },
    ];
    window.HybridApp.player.openScreenshotCarousel();
  });
  await window.waitForTimeout(500);

  const stateBothOpen = await window.evaluate(() => ({
    isFullscreenClass: document.body.classList.contains('is-fullscreen'),
    isSettingsOpen: !document.getElementById('settingsModal').hidden,
    isCarouselOpen: window.HybridApp.player.isScreenshotCarouselOpen(),
  }));
  const mainBothOpen = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { isFullScreen: win.isFullScreen(), preventFlag: !!win.__hybridPreventExitFullscreen };
  });

  await captureScreen(window, 'BUG-04-esc-both-open-fullscreen-repro.png');

  // Press Esc FIRST time: Carousel should close, settings should remain open
  await window.keyboard.press('Escape');
  await window.waitForTimeout(600);

  const stateAfterEsc1 = await window.evaluate(() => ({
    isFullscreenClass: document.body.classList.contains('is-fullscreen'),
    isSettingsOpen: !document.getElementById('settingsModal').hidden,
    isCarouselOpen: window.HybridApp.player.isScreenshotCarouselOpen(),
  }));
  const mainAfterEsc1 = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { isFullScreen: win.isFullScreen(), preventFlag: !!win.__hybridPreventExitFullscreen };
  });

  // Note: mainAfterEsc1.preventFlag is now FALSE because closeScreenshotCarousel() cleared it,
  // even though settingsModal is still open!
  await captureScreen(window, 'BUG-04-esc-after-carousel-closed-modal-remains-repro.png');

  // Press Esc SECOND time: BUG MANIFESTS!
  // Expected: Settings modal closes, fullscreen is retained.
  // Actual bug: Main process sees preventFlag=false and instantly exits fullscreen while modal is STUCK open!
  await window.keyboard.press('Escape');
  await window.waitForTimeout(800);

  const stateAfterEsc2 = await window.evaluate(() => ({
    isFullscreenClass: document.body.classList.contains('is-fullscreen'),
    isSettingsOpen: !document.getElementById('settingsModal').hidden,
    isCarouselOpen: window.HybridApp.player.isScreenshotCarouselOpen(),
  }));
  const mainAfterEsc2 = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { isFullScreen: win.isFullScreen(), preventFlag: !!win.__hybridPreventExitFullscreen };
  });

  await captureScreen(window, 'BUG-04-esc-exited-fullscreen-with-modal-stuck-repro.png');
  writeEvidenceJson('BUG-04-metrics.json', {
    bothOpen: { stateBothOpen, mainBothOpen },
    afterEsc1: { stateAfterEsc1, mainAfterEsc1 },
    afterEsc2: { stateAfterEsc2, mainAfterEsc2 },
    defectConfirmed: stateAfterEsc2.isSettingsOpen && !mainAfterEsc2.isFullScreen,
  });

  // Clean up
  await window.evaluate(() => {
    window.HybridApp.controlsModule.closeAllModals();
    window.hybridAPI.window.fullscreen(false);
  });
  await window.waitForTimeout(600);

  // -------------------------------------------------------------
  // BUG-05: Modal Page Inert Trapping of Screenshot Carousel
  // -------------------------------------------------------------
  console.log('--- Testing BUG-05: Page Inert Trapping of Carousel ---');
  await window.evaluate(() => {
    const app = window.HybridApp;
    app.controlsModule.toggleModal('settingsModal');
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    app.player._sessionScreenshots = [
      { filePath: 'C:/shot1.png', fileName: 'shot1.png', previewDataUrl: tinyPng, timestamp: Date.now(), timePos: 1 }
    ];
    app.player.openScreenshotCarousel();
  });
  await window.waitForTimeout(400);

  const inertMetrics = await window.evaluate(() => {
    const carousel = document.querySelector('.screenshot-preview.carousel-mode');
    return {
      carouselExists: !!carousel,
      isInert: carousel?.inert,
      ariaHidden: carousel?.getAttribute('aria-hidden'),
      hasModalInertAttr: carousel?.dataset?.hybridModalInert,
      pointerEvents: carousel ? getComputedStyle(carousel).pointerEvents : null,
    };
  });
  await captureScreen(window, 'BUG-05-carousel-inert-trapped-repro.png');
  if (await window.locator('.screenshot-preview.carousel-mode').count()) {
    await captureElement(window.locator('.screenshot-preview.carousel-mode'), 'BUG-05-carousel-component-broken.png');
  }
  writeEvidenceJson('BUG-05-metrics.json', inertMetrics);

  await window.evaluate(() => {
    window.HybridApp.player.closeScreenshotCarousel();
    window.HybridApp.controlsModule.closeAllModals();
  });

  // -------------------------------------------------------------
  // BUG-06: Regression: applyFsTransition Dead Code
  // -------------------------------------------------------------
  console.log('--- Testing BUG-06: applyFsTransition Dead Code ---');
  const transitionResult = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('window-fullscreen-transition-start', true);
  });
  await window.waitForTimeout(200);

  const fsTransitionMetrics = await window.evaluate(() => {
    return {
      bodyHasFsTransition: document.body.classList.contains('fs-transition'),
      curtainVisible: document.getElementById('video-curtain')?.classList.contains('visible'),
    };
  });
  await captureScreen(window, 'BUG-06-applyFsTransition-deadcode-repro.png');
  writeEvidenceJson('BUG-06-metrics.json', fsTransitionMetrics);

  // -------------------------------------------------------------
  // BUG-07: 10-Band Graphic Equalizer Extreme Gains (+12dB) & Visual Thumb Alignment
  // -------------------------------------------------------------
  console.log('--- Testing BUG-07: Graphic Equalizer Sliders at +12dB ---');
  await window.evaluate(() => {
    window.HybridApp.controlsModule.toggleModal('equalizerModal');
    // Set all bands to +12dB
    for (let i = 0; i < 10; i++) {
      window.HybridApp.equalizerModule.setBand(i, 12, { immediate: true });
    }
    window.HybridApp.equalizerModule._updateSliders(new Array(10).fill(12));
  });
  await window.waitForTimeout(400);

  const eqMetrics = await window.evaluate(() => {
    const panel = document.querySelector('#equalizerModal .equalizer-panel')?.getBoundingClientRect();
    const values = Array.from(document.querySelectorAll('.eq-band-value')).map((el) => el.getBoundingClientRect());
    const labels = Array.from(document.querySelectorAll('.eq-band-label')).map((el) => el.getBoundingClientRect());
    const sliderWraps = Array.from(document.querySelectorAll('.eq-slider-wrap')).map((el) => el.getBoundingClientRect());
    const sliders = Array.from(document.querySelectorAll('.eq-slider')).map((el) => el.getBoundingClientRect());

    return {
      panelHeight: panel ? Math.round(panel.height) : 0,
      sliderWrapHeight: sliderWraps[0] ? Math.round(sliderWraps[0].height) : 0,
      value0Bottom: values[0] ? Math.round(values[0].bottom) : 0,
      sliderWrap0Top: sliderWraps[0] ? Math.round(sliderWraps[0].top) : 0,
      slider0Top: sliders[0] ? Math.round(sliders[0].top) : 0,
      bandValues: window.HybridApp.equalizerModule.getCurrentValues(),
    };
  });
  await captureScreen(window, 'BUG-07-equalizer-extreme-gain-repro.png');
  await captureElement(window.locator('#equalizerModal .equalizer-panel'), 'BUG-07-equalizer-panel-component-broken.png');
  writeEvidenceJson('BUG-07-metrics.json', eqMetrics);

  // Reset EQ
  await window.evaluate(() => {
    document.getElementById('eqReset')?.click();
    window.HybridApp.controlsModule.closeAllModals();
  });

  // -------------------------------------------------------------
  // BUG-08: Accordion Gallery Drawer: 5th Card Void & Live Mount Geometry
  // -------------------------------------------------------------
  console.log('--- Testing BUG-08: Accordion Gallery Drawer ---');
  await window.evaluate(() => {
    window.HybridApp.player.stop();
    window.HybridApp.player.currentFilePath = null;
    document.getElementById('welcomeScreen')?.classList.remove('hidden');
    document.body.classList.add('welcome-active');
    window.HybridApp.controlsModule.toggleModal('bgSettingsModal');
    document.getElementById('bgEffectPickerBtn')?.click();
  });
  await window.waitForTimeout(500);

  const accordionMetrics = await window.evaluate(() => {
    const popover = document.getElementById('bgAccordionPopover');
    const cards = Array.from(document.querySelectorAll('#bgAccordionGallery .bg-accordion-item'));
    return {
      popoverRect: popover?.getBoundingClientRect(),
      cardCount: cards.length,
      cards: cards.map((c, i) => {
        const r = c.getBoundingClientRect();
        const liveCanvas = c.querySelector('canvas');
        return {
          index: i,
          bg: c.dataset.bg,
          hasLiveCanvas: !!liveCanvas,
          canvasRect: liveCanvas ? liveCanvas.getBoundingClientRect() : null,
          cardWidth: Math.round(r.width),
          cardHeight: Math.round(r.height),
        };
      }),
    };
  });
  await captureScreen(window, 'BUG-08-accordion-gallery-drawer-repro.png');
  await captureElement(window.locator('#bgAccordionPopover'), 'BUG-08-accordion-popover-component-broken.png');
  writeEvidenceJson('BUG-08-metrics.json', accordionMetrics);

  await window.evaluate(() => {
    document.getElementById('bgAccordionPopover').hidden = true;
    window.HybridApp.controlsModule.closeAllModals();
  });

  // -------------------------------------------------------------
  // BUG-09: A-B Loop Logic: Point A >= Point B Ordering & Indicator
  // -------------------------------------------------------------
  console.log('--- Testing BUG-09: A-B Loop Indicator ---');
  await window.evaluate(async (p) => {
    await window.HybridApp.player.loadFile(p, { allowResume: false });
    await window.hybridAPI.mpv.pause();
    window.HybridApp.player.currentTime = 2.0;
    window.HybridApp.player.setABLoop();
    window.HybridApp.player.currentTime = 6.0;
    window.HybridApp.player.setABLoop();
  }, SAMPLE_VIDEO);
  await window.waitForTimeout(400);

  const abLoopMetrics = await window.evaluate(() => {
    const indicator = document.getElementById('abLoopIndicator');
    const textEl = document.getElementById('abLoopText');
    const cs = indicator ? getComputedStyle(indicator) : null;
    return {
      abLoop: window.HybridApp.player.abLoop,
      hidden: indicator?.hidden,
      display: cs?.display,
      text: textEl?.textContent?.trim(),
      color: cs?.color,
      backgroundColor: cs?.backgroundColor,
    };
  });
  await captureScreen(window, 'BUG-09-ab-loop-indicator-repro.png');
  await captureElement(window.locator('#abLoopIndicator'), 'BUG-09-ab-loop-component-broken.png');
  writeEvidenceJson('BUG-09-metrics.json', abLoopMetrics);

  // -------------------------------------------------------------
  // BUG-10: Dropdown Drop-Up Containment at Bottom Edge
  // -------------------------------------------------------------
  console.log('--- Testing BUG-10: Dropdown Bottom Edge Overflow ---');
  await resize(1000, 620);
  await window.evaluate(() => {
    window.HybridApp.controlsModule.toggleModal('settingsModal');
    const modal = document.querySelector('#settingsModal .settings-modal');
    if (modal) modal.scrollTop = modal.scrollHeight;
  });
  await window.waitForTimeout(300);

  // Click the lowest dropdown trigger
  const dropdownMetrics = await window.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('#settingsModal .custom-select-container'));
    let best = null;
    let maxBottom = -Infinity;
    for (const c of containers) {
      const r = c.getBoundingClientRect();
      if (r.bottom > maxBottom && r.bottom < window.innerHeight) {
        maxBottom = r.bottom;
        best = c;
      }
    }
    if (best) {
      const trigger = best.querySelector('.custom-select-trigger');
      trigger?.click();
      const dropdown = best.querySelector('.custom-select-dropdown');
      const dr = dropdown?.getBoundingClientRect();
      const modal = document.querySelector('#settingsModal .settings-modal')?.getBoundingClientRect();
      return {
        selectId: best.querySelector('select')?.id,
        dropUp: dropdown?.classList.contains('drop-up'),
        dropdownRect: dr ? { top: Math.round(dr.top), bottom: Math.round(dr.bottom), height: Math.round(dr.height) } : null,
        modalRect: modal ? { top: Math.round(modal.top), bottom: Math.round(modal.bottom) } : null,
        overflowsBottom: dr && modal ? dr.bottom > modal.bottom : false,
      };
    }
    return null;
  });
  await captureScreen(window, 'BUG-10-dropdown-bottom-edge-repro.png');
  writeEvidenceJson('BUG-10-metrics.json', dropdownMetrics);

  // -------------------------------------------------------------
  // BUG-11: Window Bounds Restoration Cycle
  // -------------------------------------------------------------
  console.log('--- Testing BUG-11: Window Bounds Restoration Cycle ---');
  const boundsMetrics = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    win.setBounds({ x: 120, y: 120, width: 1000, height: 640 }, false);
    await wait(200);

    const initial = win.getBounds();
    win.maximize();
    await wait(300);
    const maximized = win.getBounds();

    win.setFullScreen(true);
    await wait(400);
    const fullscreen = win.getBounds();

    win.setFullScreen(false);
    await wait(400);
    const exitFs = win.getBounds();

    win.unmaximize();
    await wait(300);
    const restored = win.getBounds();

    return {
      initial,
      maximized,
      fullscreen,
      exitFs,
      restored,
      restoredMatchesInitial: restored.width === initial.width && restored.height === initial.height,
    };
  });
  await captureScreen(window, 'BUG-11-window-bounds-restoration-repro.png');
  writeEvidenceJson('BUG-11-metrics.json', boundsMetrics);

  // Close app & cleanup
  console.log('--- Cleaning Up ---');
  await electronApp.close();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('=== AUDIT COMPLETE: ALL EVIDENCE SAVED TO disk ===');
}

runAudit().catch((err) => {
  console.error('[AUDIT RUNNER FATAL ERROR]', err);
  process.exit(1);
});
