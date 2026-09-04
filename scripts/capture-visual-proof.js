const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function capture() {
  const artifactDir = 'C:\\Users\\abdul\\.gemini\\antigravity\\brain\\e49cdc36-15b3-45dc-a886-c1c3fe2febe9';
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-snap-'));
  const videoPath = path.resolve(__dirname, '../test-sample.mp4');
  console.log('Loading video from:', videoPath);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
    env,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  console.log('Opening file in player...');
  await window.evaluate(async (vPath) => {
    await window.HybridApp.player.loadFile(vPath);
  }, videoPath);

  // Wait for playback to start
  await window.waitForTimeout(1200);

  // 1. Trigger Pause via clicking btnPlay on control bar
  console.log('Triggering pause via #btnPlay click...');
  await window.evaluate(() => {
    document.getElementById('btnPlay').click();
  });
  
  // Wait 120ms so indicator reaches peak opacity
  await window.waitForTimeout(120);

  const pauseStatus = await window.evaluate(() => {
    const el = document.getElementById('playPauseIndicator');
    const cs = window.getComputedStyle(el);
    return {
      className: el.className,
      opacity: cs.opacity,
      visibility: cs.visibility,
      transform: cs.transform,
      html: el.innerHTML
    };
  });
  console.log('Pause status:', pauseStatus);

  const pauseScreenshotPath = path.join(artifactDir, 'pause_indicator_screenshot.png');
  await window.screenshot({ path: pauseScreenshotPath });
  console.log('Saved pause screenshot to:', pauseScreenshotPath);

  // Wait for indicator to finish
  await window.waitForTimeout(1000);

  // 2. Trigger Play via Space key
  console.log('Triggering play via Space key...');
  await window.evaluate(() => {
    document.getElementById('btnPlay').click();
  });
  await window.waitForTimeout(120);

  const playStatus = await window.evaluate(() => {
    const el = document.getElementById('playPauseIndicator');
    const cs = window.getComputedStyle(el);
    return {
      className: el.className,
      opacity: cs.opacity,
      visibility: cs.visibility,
      transform: cs.transform,
      html: el.innerHTML
    };
  });
  console.log('Play status:', playStatus);

  const playScreenshotPath = path.join(artifactDir, 'play_indicator_screenshot.png');
  await window.screenshot({ path: playScreenshotPath });
  console.log('Saved play screenshot to:', playScreenshotPath);

  await electronApp.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  console.log('Done!');
}

capture().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
