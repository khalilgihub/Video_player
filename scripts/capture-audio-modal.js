const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function capture() {
  const artifactDir = 'C:\\Users\\abdul\\.gemini\\antigravity\\brain\\e49cdc36-15b3-45dc-a886-c1c3fe2febe9';
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-snap-'));
  const videoPath = path.resolve(__dirname, '../test-sample.mp4');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
    env,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.evaluate(async (vPath) => {
    await window.HybridApp.player.loadFile(vPath);
  }, videoPath);

  await window.waitForTimeout(1200);

  // Mock dual-audio track list (Japanese + English)
  await window.evaluate(() => {
    window.HybridApp.player.trackList = [
      { id: 1, type: 'video', selected: true },
      { id: 2, type: 'audio', lang: 'jpn', title: 'Japanese (FLAC 5.1)', selected: true },
      { id: 3, type: 'audio', lang: 'eng', title: 'English (DTS-HD 5.1)', selected: false },
      { id: 4, type: 'sub', lang: 'eng', title: 'English (Full)', selected: true },
      { id: 5, type: 'sub', lang: 'eng', title: 'English (Signs & Songs)', selected: false }
    ];
    window.HybridApp.audioModule._updateTrackList(window.HybridApp.player.trackList);
    window.HybridApp.controlsModule.toggleModal('audioModal');
  });

  await window.waitForTimeout(400);

  const screenshotPath = path.join(artifactDir, 'audio_modal_screenshot.png');
  await window.screenshot({ path: screenshotPath });
  console.log('Saved screenshot to:', screenshotPath);

  await electronApp.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

capture().catch(console.error);
