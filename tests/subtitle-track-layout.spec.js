const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

test('verify subtitle track list layout with many tracks without clipping or overlap', async () => {
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);

  // Populate realistic multi-track subtitle list (like Mob Psycho)
  await window.evaluate(() => {
    const welcome = document.getElementById('welcomeScreen');
    if (welcome) welcome.classList.add('hidden');
    window.HybridApp.controlsModule.toggleModal('subtitleModal');

    const fakeTracks = [
      { id: 1, type: 'sub', lang: 'English', selected: true },
      { id: 2, type: 'sub', lang: 'French' },
      { id: 3, type: 'sub', lang: 'German' },
      { id: 4, type: 'sub', lang: 'Italian' },
      { id: 5, type: 'sub', lang: 'Spanish[ESP]' },
      { id: 6, type: 'sub', lang: 'Spanish[LAT]' },
      { id: 7, type: 'sub', lang: 'Brazilian Portuguese' },
      { id: 8, type: 'sub', lang: 'Russian' },
      { id: 9, type: 'sub', lang: 'Arabic' },
      { id: 10, type: 'sub', title: 'English [Full] (PGS)' },
      { id: 11, type: 'sub', title: 'English [Signs/Songs] (PGS)' },
    ];

    window.HybridApp.subtitleModule._updateTrackList(fakeTracks);
  });

  await window.waitForTimeout(400);

  // Check the layout positions of the buttons and #btnLoadSubtitle
  const layoutCheck = await window.evaluate(() => {
    const container = document.getElementById('subtitleTracks');
    const buttons = Array.from(container.querySelectorAll('.subtitle-track-btn'));
    const loadBtn = document.getElementById('btnLoadSubtitle');
    const lastBtn = buttons[buttons.length - 1];

    const lastRect = lastBtn.getBoundingClientRect();
    const loadRect = loadBtn.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    return {
      buttonCount: buttons.length,
      lastBtnText: lastBtn.textContent,
      lastBtnHeight: lastRect.height,
      lastBtnBottom: lastRect.bottom,
      loadBtnTop: loadRect.top,
      containerHeight: containerRect.height,
      overlaps: lastRect.bottom > loadRect.top,
      clippedByContainer: lastRect.bottom > containerRect.bottom,
    };
  });

  console.log('[LAYOUT CHECK]', layoutCheck);
  expect(layoutCheck.buttonCount).toBe(12); // Off + 11 tracks
  expect(layoutCheck.lastBtnText).toContain('English [Signs/Songs]');
  expect(layoutCheck.overlaps).toBe(false); // NO OVERLAP!
  expect(layoutCheck.clippedByContainer).toBe(false); // NO CLIPPING!

  // Take screenshot of subtitle modal
  const artifactsDir = 'C:/Users/abdul/.gemini/antigravity/brain/cc1729a9-9718-4f0a-af7f-70f75d2cf69d';
  const modal = window.locator('#subtitleModal .subtitle-panel');
  await modal.screenshot({ path: path.join(artifactsDir, 'subtitle_modal_fixed.png') });

  await electronApp.close();
});
