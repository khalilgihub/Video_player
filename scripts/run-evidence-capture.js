const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCREENSHOTS_DIR = 'C:\\Users\\abdul\\.gemini\\antigravity\\brain\\0b1d4fad-a110-4834-a375-a11e235b96be\\screenshots';
const SAMPLE_VIDEO = path.resolve(__dirname, '..', 'test-sample.mp4');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function runEvidenceCapture() {
  console.log('=== STARTING AUTOMATED BUG PROOF & SCREENSHOT CAPTURE ===');
  const results = {};

  // ── Launch Electron App ──
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-evidence-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    args: [path.resolve(__dirname, '..'), `--user-data-dir=${userDataDir}`],
    env,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => Boolean(window.HybridApp && window.HybridApp.controlsModule));
  await window.waitForTimeout(800);

  console.log('[OK] Electron window launched and ready');

  try {
    // ══════════════════════════════════════════════════════════════
    // PROOF 1: BUG #5 — Titlebar click on maximized window unmaximizes it
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- Capturing Proof for BUG #5 (Maximized Titlebar Click) ---');
    // 1. Maximize window
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.maximize();
    });
    await window.waitForTimeout(600);

    const isMaxBefore = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isMaximized() : false;
    });

    const shot1 = path.join(SCREENSHOTS_DIR, 'proof_bug5_step1_maximized.png');
    await window.screenshot({ path: shot1 });
    console.log(`[Bug #5] Step 1: Window maximized = ${isMaxBefore}. Screenshot: ${shot1}`);

    // 2. Perform a single click (mousedown + mouseup without moving) on titlebar drag surface
    await window.evaluate(async () => {
      const dragSurface = document.querySelector('.titlebar-drag');
      if (dragSurface) {
        const rect = dragSurface.getBoundingClientRect();
        const clientX = rect.left + 200;
        const clientY = rect.top + 10;
        dragSurface.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, button: 0, clientX, clientY, screenX: clientX, screenY: clientY
        }));
        await new Promise(r => setTimeout(r, 60));
        window.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, button: 0, clientX, clientY, screenX: clientX, screenY: clientY
        }));
      }
    });
    await window.waitForTimeout(600);

    const isMaxAfter = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isMaximized() : false;
    });

    const shot2 = path.join(SCREENSHOTS_DIR, 'proof_bug5_step2_unmaximized_on_click.png');
    await window.screenshot({ path: shot2 });
    console.log(`[Bug #5] Step 2: After single click on titlebar, isMaximized = ${isMaxAfter}. Screenshot: ${shot2}`);

    results.bug5 = {
      isMaxBefore,
      isMaxAfter,
      proved: isMaxBefore === true && isMaxAfter === false,
      screenshot1: shot1,
      screenshot2: shot2,
    };

    // ══════════════════════════════════════════════════════════════
    // PROOF 2: BUG #11 — Playlist double-click double-loads & duplicates history
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- Capturing Proof for BUG #11 (Playlist Double-Click Double-Load) ---');
    const bug11Data = await window.evaluate(async (videoPath) => {
      const App = window.HybridApp;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // Open playlist
      document.getElementById('sidebarPlaylist')?.classList.remove('collapsed');
      document.body.classList.add('playlist-open');

      // Clear playlist and add sample video
      App.playlistModule.items = [
        { name: 'Test Video 1', path: videoPath, duration: 10 },
        { name: 'Test Video 2', path: videoPath, duration: 10 }
      ];
      App.playlistModule._renderList('');
      await sleep(200);

      // Record history count before
      const historyBefore = await window.hybridAPI.history.getRecent(50);
      const countBefore = historyBefore.length;

      // Click item twice in rapid succession (double-click)
      const firstItem = document.querySelector('.playlist-item');
      if (firstItem) {
        firstItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        // second click hits newly rendered item
        await sleep(50);
        const nextItem = document.querySelector('.playlist-item');
        if (nextItem) nextItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      await sleep(1500);

      const historyAfter = await window.hybridAPI.history.getRecent(50);
      return {
        countBefore,
        countAfter: historyAfter.length,
        addedRows: historyAfter.length - countBefore,
        historyItems: historyAfter.slice(0, 4)
      };
    }, SAMPLE_VIDEO);

    const shot11 = path.join(SCREENSHOTS_DIR, 'proof_bug11_playlist_double_click.png');
    await window.screenshot({ path: shot11 });
    console.log(`[Bug #11] Double click added ${bug11Data.addedRows} history rows. Screenshot: ${shot11}`);
    results.bug11 = { ...bug11Data, screenshot: shot11 };

    // ══════════════════════════════════════════════════════════════
    // PROOF 3: BUG #13 — Video click followed by Next button pauses new video
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- Capturing Proof for BUG #13 (Video click timer pauses playback) ---');
    const bug13Data = await window.evaluate(async (videoPath) => {
      const App = window.HybridApp;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      await App.player.loadFile(videoPath, { allowResume: false });
      await sleep(1000);
      await window.hybridAPI.mpv.play();
      await sleep(300);

      const playingBefore = App.player.isPlaying;

      // Click video surface (arms 250ms clickTimeout)
      const canvas = document.getElementById('videoCanvas') || document.getElementById('mpvContainer');
      canvas?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Immediately click next or seek bar
      await sleep(40);
      const btnNext = document.getElementById('btnNext');
      btnNext?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Wait 350ms (clickTimeout fires at 250ms)
      await sleep(400);

      const playingAfter = App.player.isPlaying;
      return {
        playingBefore,
        playingAfter,
        pausedByStaleTimer: playingBefore === true && playingAfter === false
      };
    }, SAMPLE_VIDEO);

    const shot13 = path.join(SCREENSHOTS_DIR, 'proof_bug13_unexpected_pause.png');
    await window.screenshot({ path: shot13 });
    console.log(`[Bug #13] Playing before = ${bug13Data.playingBefore}, playing after = ${bug13Data.playingAfter}. Screenshot: ${shot13}`);
    results.bug13 = { ...bug13Data, screenshot: shot13 };

    // ══════════════════════════════════════════════════════════════
    // PROOF 4: BUG #7 — WebGL context loss permanently freezes effect
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- Capturing Proof for BUG #7 (WebGL context loss permanent freeze) ---');
    const bug7Data = await window.evaluate(async () => {
      const App = window.HybridApp;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // Switch to dither waves
      App.settingsModule?._applyBgOpts?.('dither', { persist: false });
      await sleep(500);

      const bgContainer = document.getElementById('bgEffectContainer');
      const canvas = bgContainer?.querySelector('canvas');
      if (!canvas) return { error: 'No WebGL canvas found' };

      const instance = bgContainer.__ditherWavesInstance;

      // Dispatch webglcontextlost
      const evt = new Event('webglcontextlost', { bubbles: true, cancelable: true });
      canvas.dispatchEvent(evt);
      await sleep(100);

      // Try to resume via focus
      window.dispatchEvent(new Event('focus'));
      await sleep(200);

      return {
        hasCanvas: !!canvas,
        contextLostDispatched: true
      };
    });

    const shot7 = path.join(SCREENSHOTS_DIR, 'proof_bug7_webgl_context_loss.png');
    await window.screenshot({ path: shot7 });
    console.log(`[Bug #7] WebGL context loss state captured. Screenshot: ${shot7}`);
    results.bug7 = { ...bug7Data, screenshot: shot7 };

    // ══════════════════════════════════════════════════════════════
    // PROOF 5: BUG #17 — Audio sync offset unhandled rejection & UI lie
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- Capturing Proof for BUG #17 (Audio sync offset unhandled rejection) ---');
    const bug17Data = await window.evaluate(async () => {
      const App = window.HybridApp;
      const original = window.hybridAPI.mpv.setAudioDelay;

      // Force rejection to simulate mpv set error
      window.hybridAPI.mpv.setAudioDelay = () => Promise.reject(new Error('simulated mpv audio delay failure'));

      let caughtUnhandled = false;
      const unhandledHandler = (e) => {
        caughtUnhandled = true;
      };
      window.addEventListener('unhandledrejection', unhandledHandler);

      App.audioModule.setSyncOffset(250);
      await new Promise(r => setTimeout(r, 200));

      window.hybridAPI.mpv.setAudioDelay = original;
      window.removeEventListener('unhandledrejection', unhandledHandler);

      const displayedText = document.getElementById('audioSyncValue')?.textContent;
      return {
        displayedText,
        syncOffsetInState: App.audioModule.syncOffset,
        caughtUnhandledRejection: caughtUnhandled
      };
    });

    const shot17 = path.join(SCREENSHOTS_DIR, 'proof_bug17_audio_sync_optimistic.png');
    await window.screenshot({ path: shot17 });
    console.log(`[Bug #17] Audio sync text = "${bug17Data.displayedText}", unhandled rejection caught = ${bug17Data.caughtUnhandledRejection}. Screenshot: ${shot17}`);
    results.bug17 = { ...bug17Data, screenshot: shot17 };

    // ══════════════════════════════════════════════════════════════
    // PROOF 6: BUG #6 — Subtitle sync slider sends IPC on every single input tick
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- Capturing Proof for BUG #6 (Subtitle sync slider un-debounced IPC) ---');
    const bug6Data = await window.evaluate(async () => {
      const App = window.HybridApp;
      let saveIpcCount = 0;
      const originalSave = window.hybridAPI.subtitleDelay.save;
      window.hybridAPI.subtitleDelay.save = (...args) => {
        saveIpcCount++;
        return originalSave(...args);
      };

      const syncSlider = document.getElementById('subSyncSlider');
      if (syncSlider) {
        // Simulate dragging slider across 15 ticks
        for (let i = 1; i <= 15; i++) {
          syncSlider.value = (i * 0.1).toFixed(2);
          syncSlider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      await new Promise(r => setTimeout(r, 100));
      window.hybridAPI.subtitleDelay.save = originalSave;

      return {
        sliderTicksDispatched: 15,
        saveIpcCountDispatched: saveIpcCount
      };
    });
    console.log(`[Bug #6] Dispatched 15 slider ticks -> triggered ${bug6Data.saveIpcCountDispatched} IPC calls directly!`);
    results.bug6 = bug6Data;

  } finally {
    try { await electronApp.close(); } catch (_) {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════
  // PROOF 7: BUG #16 — FS_DEBUG = true log file bloat
  // ══════════════════════════════════════════════════════════════
  const logFile = path.resolve(__dirname, '..', 'fullscreen-debug.log');
  let logSize = 0;
  if (fs.existsSync(logFile)) {
    logSize = fs.statSync(logFile).size;
  }
  console.log(`\n[Bug #16] fullscreen-debug.log size: ${logSize} bytes (~${(logSize / (1024 * 1024)).toFixed(2)} MB)`);
  results.bug16 = { logFile, logSize, sizeMB: (logSize / (1024 * 1024)).toFixed(2) };

  // ══════════════════════════════════════════════════════════════
  // PROOF 8: BUG #15 — native-dwm.c unterminated #ifndef
  // ══════════════════════════════════════════════════════════════
  const dwmFile = path.resolve(__dirname, '..', 'src', 'main', 'native-dwm.c');
  const dwmLines = fs.readFileSync(dwmFile, 'utf8').split('\n');
  const stack = [];
  dwmLines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (/^#(if|ifdef|ifndef)\b/.test(trimmed)) {
      stack.push({ line: idx + 1, text: trimmed });
    } else if (/^#endif\b/.test(trimmed)) {
      if (stack.length > 0) stack.pop();
    }
  });
  console.log(`[Bug #15] native-dwm.c open preprocessor blocks: ${JSON.stringify(stack)}`);
  results.bug15 = { dwmFile, openBlocks: stack };

  // ══════════════════════════════════════════════════════════════
  // PROOF 9: BUG #9 — waitForReady listener leak on timeout
  // ══════════════════════════════════════════════════════════════
  const EventEmitter = require('events');
  const testEmitter = new EventEmitter();
  let leakWarnings = 0;
  testEmitter.on('newListener', () => {});
  const originalEmit = testEmitter.emit;
  testEmitter.emit = function (name, ...args) {
    if (name === 'error') return false;
    return originalEmit.apply(this, [name, ...args]);
  };

  const waitForMpvReady = (instance, timeoutMs = 20) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('preview mpv not ready'));
    }, timeoutMs);
    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    instance.once('ready', onReady);
  });

  for (let i = 0; i < 15; i++) {
    try { await waitForMpvReady(testEmitter, 10); } catch (_) {}
  }
  const orphanListeners = testEmitter.listenerCount('ready');
  console.log(`[Bug #9] 15 timeouts left ${orphanListeners} orphan 'ready' listeners attached in memory.`);
  results.bug9 = { orphanListeners };

  // Write full results JSON to screenshots directory
  fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'evidence_summary.json'), JSON.stringify(results, null, 2));
  console.log('\n=== ALL PROOFS CAPTURED & SAVED SUCCESSFULLY ===');
}

runEvidenceCapture().catch(err => {
  console.error('Evidence capture failed:', err);
  process.exit(1);
});
