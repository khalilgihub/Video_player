const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Audio & Voice Settings Modal and Anime Subs/Dubs', () => {
  let electronApp;
  let window;
  let userDataDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-audiomodal-test-'));
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

  test('should verify pause indicator is removed from DOM', async () => {
    const indicator = await window.evaluate(() => {
      return document.getElementById('playPauseIndicator');
    });
    expect(indicator).toBeNull();
  });

  test('should render Audio button between Equalizer and Subtitles and open Audio Modal on click', async () => {
    const btnAudio = window.locator('#btnAudioTrack');
    await expect(btnAudio).toBeAttached();

    // Verify order in DOM (btnEqualizer -> btnAudioTrack -> btnSubtitles)
    const order = await window.evaluate(() => {
      const parent = document.querySelector('.controls-right');
      const children = Array.from(parent.children).map(el => el.id);
      const eqIdx = children.indexOf('btnEqualizer');
      const audioIdx = children.indexOf('btnAudioTrack');
      const subIdx = children.indexOf('btnSubtitles');
      return { eqIdx, audioIdx, subIdx };
    });

    expect(order.eqIdx).toBeGreaterThan(-1);
    expect(order.audioIdx).toBe(order.eqIdx + 1);
    expect(order.subIdx).toBe(order.audioIdx + 1);

    // Emulate media loaded state so toolbar buttons are revealed
    await window.evaluate(() => {
      const welcome = document.getElementById('welcomeScreen');
      if (welcome) welcome.classList.add('hidden');
      window.HybridApp?.controlsModule?.updateToolbarVisibility?.();
    });

    // Click button to open modal
    await window.click('#btnAudioTrack');
    const isModalOpen = await window.evaluate(() => {
      const modal = document.getElementById('audioModal');
      return modal && !modal.hidden;
    });
    expect(isModalOpen).toBe(true);

    // Close modal
    await window.click('[data-close-modal="audioModal"]');
    const isModalClosed = await window.evaluate(() => {
      const modal = document.getElementById('audioModal');
      return modal && modal.hidden;
    });
    expect(isModalClosed).toBe(true);
  });

  test('should populate Audio Modal with Anime presets and track pills', async () => {
    const result = await window.evaluate(() => {
      window.HybridApp.player.trackList = [
        { id: 1, type: 'video', selected: true },
        { id: 2, type: 'audio', lang: 'jpn', title: 'Japanese (FLAC 5.1)', selected: true },
        { id: 3, type: 'audio', lang: 'eng', title: 'English (DTS-HD 5.1)', selected: false },
        { id: 4, type: 'sub', lang: 'eng', title: 'English (Full)', selected: true },
        { id: 5, type: 'sub', lang: 'eng', title: 'English (Signs & Songs)', selected: false }
      ];
      window.HybridApp.audioModule._updateTrackList(window.HybridApp.player.trackList);

      const trackBtns = Array.from(document.querySelectorAll('#audioTracks .subtitle-track-btn'));
      const btnSubs = document.getElementById('btnQuickSubs');
      const btnDubs = document.getElementById('btnQuickDubs');

      return {
        trackCount: trackBtns.length,
        track1Text: trackBtns[0]?.textContent,
        track1Active: trackBtns[0]?.classList.contains('active'),
        track2Text: trackBtns[1]?.textContent,
        track2Active: trackBtns[1]?.classList.contains('active'),
        subsActive: btnSubs?.classList.contains('active'),
        dubsActive: btnDubs?.classList.contains('active'),
      };
    });

    expect(result.trackCount).toBe(2);
    expect(result.track1Text).toContain('Japanese');
    expect(result.track1Active).toBe(true);
    expect(result.track2Text).toContain('English');
    expect(result.track2Active).toBe(false);
    expect(result.subsActive).toBe(true);
    expect(result.dubsActive).toBe(false);
  });

  test('should adjust audio sync delay in modal', async () => {
    const result = await window.evaluate(() => {
      window.HybridApp.audioModule.setSyncOffset(0);

      // +100ms
      window.HybridApp.audioModule.adjustSync(100);
      const val1 = document.getElementById('audioSyncValue')?.textContent;

      // -100ms twice (-100ms total)
      window.HybridApp.audioModule.adjustSync(-200);
      const val2 = document.getElementById('audioSyncValue')?.textContent;

      // Reset
      window.HybridApp.audioModule.setSyncOffset(0);
      const val3 = document.getElementById('audioSyncValue')?.textContent;

      return { val1, val2, val3 };
    });

    expect(result.val1).toBe('+100ms');
    expect(result.val2).toBe('-100ms');
    expect(result.val3).toBe('0ms');
  });

  test('should trigger Subs to Dubs toggle on A shortcut key', async () => {
    const result = await window.evaluate(() => {
      const messages = [];
      window.HybridToast = {
        show: (msg) => messages.push(msg)
      };

      window.HybridApp.player.trackList = [
        { id: 1, type: 'audio', lang: 'ja', title: 'Japanese Audio', selected: true },
        { id: 2, type: 'audio', lang: 'en', title: 'English Dub', selected: false },
        { id: 3, type: 'sub', lang: 'en', title: 'English Subtitles', selected: true }
      ];

      // Press A hotkey -> switches to Dubs
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }));
      const msg1 = messages[messages.length - 1];

      // Press A hotkey again -> switches back to Subs
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }));
      const msg2 = messages[messages.length - 1];

      return { msg1, msg2 };
    });

    expect(result.msg1).toContain('Dubs');
    expect(result.msg2).toContain('Subs');
  });
});
