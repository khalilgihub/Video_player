const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function runVerification() {
  console.log('=== High-Speed Visual Frame Capture & White Flash Verification ===');

  const artifactDir = path.resolve('C:\\Users\\abdul\\.gemini\\antigravity\\brain\\a689dfcb-746f-49c6-be7f-c3f078171827\\verification_frames');
  if (fs.existsSync(artifactDir)) {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
  fs.mkdirSync(artifactDir, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-flashcheck-'));
  const videoPath = path.resolve(__dirname, '../test-sample.mp4');
  console.log('Target Video:', videoPath);
  console.log('Output Directory:', artifactDir);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
    env,
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  let frameCount = 0;
  async function snap(stage) {
    frameCount++;
    const fn = `frame_${String(frameCount).padStart(4, '0')}_${stage}.png`;
    const targetPath = path.join(artifactDir, fn);
    await window.screenshot({ path: targetPath });
    return targetPath;
  }

  console.log('1. Capturing Initial Welcome State (5 frames)...');
  for (let i = 0; i < 5; i++) {
    await snap('welcome');
    await new Promise((r) => setTimeout(r, 40));
  }

  console.log('2. Initiating Video Load & Capturing Handoff Burst (100+ frames)...');
  const loadPromise = window.evaluate(async (vPath) => {
    await window.HybridApp.player.loadFile(vPath);
  }, videoPath);

  const startTime = Date.now();
  while (Date.now() - startTime < 1800) {
    await snap('loading');
    await new Promise((r) => setTimeout(r, 15));
  }

  await loadPromise;

  console.log('3. Capturing Live Playback Frames...');
  for (let i = 0; i < 15; i++) {
    await snap('playback');
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log('4. Initiating Second Video Reload & Capturing Transition...');
  const reloadPromise = window.evaluate(async (vPath) => {
    await window.HybridApp.player.loadFile(vPath);
  }, videoPath);

  const reloadStartTime = Date.now();
  while (Date.now() - reloadStartTime < 1400) {
    await snap('reload');
    await new Promise((r) => setTimeout(r, 15));
  }

  await reloadPromise;

  for (let i = 0; i < 10; i++) {
    await snap('playback2');
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`Total captured frames: ${frameCount}`);
  await electronApp.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  console.log('Capture completed successfully!');
}

runVerification().catch((err) => {
  console.error('Verification error:', err);
  process.exit(1);
});
