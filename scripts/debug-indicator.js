const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function debugIndicator() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-player-debug-'));
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

  await window.waitForTimeout(1500);

  console.log('Before press space:');
  const beforeState = await window.evaluate(() => {
    const el = document.getElementById('playPauseIndicator');
    const cs = window.getComputedStyle(el);
    return {
      isPlaying: window.HybridApp.player.isPlaying,
      hasStarted: window.HybridApp._hasStartedPlaying,
      welcomeClass: document.getElementById('welcomeScreen')?.className,
      elClass: el.className,
      opacity: cs.opacity,
      visibility: cs.visibility,
      display: cs.display,
      zIndex: cs.zIndex,
      rect: el.getBoundingClientRect(),
      innerHTML: el.innerHTML,
    };
  });
  console.log('Before state:', beforeState);

  console.log('Pressing Space...');
  await window.keyboard.press('Space');
  await window.waitForTimeout(100);

  const afterState = await window.evaluate(() => {
    const el = document.getElementById('playPauseIndicator');
    const cs = window.getComputedStyle(el);
    return {
      isPlaying: window.HybridApp.player.isPlaying,
      hasStarted: window.HybridApp._hasStartedPlaying,
      welcomeClass: document.getElementById('welcomeScreen')?.className,
      elClass: el.className,
      opacity: cs.opacity,
      visibility: cs.visibility,
      display: cs.display,
      zIndex: cs.zIndex,
      transform: cs.transform,
      rect: el.getBoundingClientRect(),
      innerHTML: el.innerHTML,
    };
  });
  console.log('After state:', afterState);

  await electronApp.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

debugIndicator().catch(console.error);
