const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

async function run() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  
  console.log('Launching Electron...');
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '..')],
    env,
  });
  
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  
  // Wait a bit for welcome animations to settle
  await window.waitForTimeout(2000);
  
  const screenshotPath = 'C:/Users/abdul/.gemini/antigravity-ide/brain/2716044f-12c1-4f58-92d1-fb33b63d126c/app_screenshot.png';
  await window.screenshot({ path: screenshotPath });
  console.log('Screenshot saved to:', screenshotPath);
  
  await electronApp.close();
}

run().catch(console.error);
