const { _electron: electron } = require('@playwright/test');
const path = require('path');

async function run() {
  console.log('Launching Electron...');
  const electronApp = await electron.launch({
    args: [path.join(__dirname)],
  });
  
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  console.log('DOM Content Loaded.');

  // Open settings
  await window.locator('#bgSettingsToggle').click();

  // Select Grid Motion
  await window.locator('#welcomeBackgroundSelect').selectOption('gridmotion');

  // Let's set some sample images in __hybridWelcomeEffectsState to see if they render
  console.log('Injecting sample images into welcome state...');
  await window.evaluate(() => {
    // Create a 1x1 red dot base64 JPEG
    const redDot = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const settings = window.HybridApp.settingsModule;
    settings._bgOpts.gridmotion.customPictures = [redDot];
    settings._applyWelcomeQuality('custom', { persist: false, reapply: true, syncInputs: true });
  });

  // Wait a moment for rendering
  await new Promise(r => setTimeout(r, 1000));

  // Inspect the elements on the welcome screen
  const gridState = await window.evaluate(() => {
    const images = Array.from(document.querySelectorAll('.grid-motion-item-img'));
    const isVisible = images.map(img => {
      return {
        display: img.style.display,
        bg: img.style.backgroundImage,
        opacity: getComputedStyle(img).opacity,
      };
    });
    return {
      count: images.length,
      firstFew: isVisible.slice(0, 3),
    };
  });

  console.log('--- GRID CELL STYLE STATE ---');
  console.log(JSON.stringify(gridState, null, 2));

  await electronApp.close();
}

run().catch(console.error);
