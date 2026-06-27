const { _electron: electron } = require('@playwright/test');
const path = require('path');

async function run() {
  console.log('Launching Electron...');
  const electronApp = await electron.launch({
    args: [path.join(__dirname)],
  });
  
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  console.log('DOM Loaded.');

  // Wait 3 seconds for preferences to load and gridMotion to initialize
  await new Promise(r => setTimeout(r, 3000));

  const state = await window.evaluate(() => {
    return {
      welcomeEffectsState: window.__hybridWelcomeEffectsState,
      bodyDataset: document.body.dataset.welcomeQuality,
      gridMotionMountExists: !!document.getElementById('gridMotionMount'),
      gridMotionItems: Array.from(document.querySelectorAll('.grid-motion-item-img')).map(img => ({
        display: img.style.display,
        bg: img.style.backgroundImage,
      })).slice(0, 5),
    };
  });

  console.log('--- STATE ---');
  console.log(JSON.stringify(state, null, 2));

  await electronApp.close();
}

run().catch(console.error);
