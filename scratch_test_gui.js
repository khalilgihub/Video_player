const { _electron: electron } = require('@playwright/test');
const path = require('path');

(async () => {
  console.log('Launching Electron...');
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '.')],
    env: { ...process.env, HYBRID_ENABLE_DEVTOOLS: '1' }
  });

  const window = await electronApp.firstWindow();
  console.log('Window opened');

  // Monitor console logs
  window.on('console', msg => {
    console.log('[RENDERER CONSOLE]:', msg.text());
  });

  // Wait for loading to complete
  await window.waitForLoadState('domcontentloaded');

  console.log('Triggering network stream modal...');
  await window.evaluate(() => {
    window.HybridApp.promptOpenUrl();
  });

  console.log('Inputting YouTube URL...');
  await window.locator('#networkStreamInput').fill('https://youtu.be/F2nc-J1GBf8?si=8l5-gxCwvTrJCGwV');

  console.log('Submitting...');
  await window.locator('#networkStreamForm').evaluate(form => {
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });

  console.log('Waiting 8 seconds to see if it plays/errors...');
  await new Promise(resolve => setTimeout(resolve, 8000));

  console.log('Closing app...');
  await electronApp.close();
  console.log('Done');
})();
