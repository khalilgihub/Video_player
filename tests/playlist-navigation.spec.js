const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test.describe('Playlist Navigation and Video Click to Collapse Drawer', () => {
  let electronApp;
  let window;
  let userDataDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-playlistnav-test-'));
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

  test('should advance playlist when clicking next button on control bar (btnNext)', async () => {
    // Populate playlist with mocked player.loadFile
    await window.evaluate(() => {
      window.HybridApp.player.loadFile = async () => true;
      window.HybridApp.playlistModule.replaceFiles([
        'C:\\media\\episode1.mkv',
        'C:\\media\\episode2.mkv',
        'C:\\media\\episode3.mkv'
      ], { autoPlay: false });
      window.HybridApp.playlistModule.currentIndex = 0;
      window.HybridApp.playlistModule._renderList();
    });

    const initialIndex = await window.evaluate(() => window.HybridApp.playlistModule.currentIndex);
    expect(initialIndex).toBe(0);

    // Click btnNext
    await window.evaluate(() => {
      const btnNext = document.getElementById('btnNext');
      btnNext?.click();
    });

    const nextIndex = await window.evaluate(() => window.HybridApp.playlistModule.currentIndex);
    expect(nextIndex).toBe(1);

    // Click btnNext again
    await window.evaluate(() => {
      const btnNext = document.getElementById('btnNext');
      btnNext?.click();
    });

    const nextIndex2 = await window.evaluate(() => window.HybridApp.playlistModule.currentIndex);
    expect(nextIndex2).toBe(2);

    // Click btnPrev
    await window.evaluate(() => {
      // Simulate current time = 0 so prev skips to previous track instead of restarting current
      window.HybridApp.player.currentTime = 0;
      const btnPrev = document.getElementById('btnPrev');
      btnPrev?.click();
    });

    const prevIndex = await window.evaluate(() => window.HybridApp.playlistModule.currentIndex);
    expect(prevIndex).toBe(1);
  });

  test('should collapse playlist drawer when clicking on the video surface', async () => {
    const sidebar = window.locator('#sidebarPlaylist');

    // Open playlist drawer via btnPlaylist click
    await window.evaluate(() => {
      const btn = document.getElementById('btnPlaylist');
      if (document.getElementById('sidebarPlaylist')?.classList.contains('collapsed')) {
        btn?.click();
      }
    });

    await expect(sidebar).not.toHaveClass(/collapsed/);
    const isBodyOpen = await window.evaluate(() => document.body.classList.contains('playlist-open'));
    expect(isBodyOpen).toBe(true);

    // Click on video surface (mpvContainer)
    await window.evaluate(() => {
      const mpvContainer = document.getElementById('mpvContainer');
      mpvContainer?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await expect(sidebar).toHaveClass(/collapsed/);
    const isBodyClosed = await window.evaluate(() => document.body.classList.contains('playlist-open'));
    expect(isBodyClosed).toBe(false);
  });

  test('should collapse playlist drawer when clicking on videoContainer outside control bar', async () => {
    const sidebar = window.locator('#sidebarPlaylist');

    // Open playlist drawer via btnPlaylist click
    await window.evaluate(() => {
      const btn = document.getElementById('btnPlaylist');
      if (document.getElementById('sidebarPlaylist')?.classList.contains('collapsed')) {
        btn?.click();
      }
    });

    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Click on videoContainer surface
    await window.evaluate(() => {
      const videoContainer = document.getElementById('videoContainer');
      videoContainer?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await expect(sidebar).toHaveClass(/collapsed/);
  });
});
