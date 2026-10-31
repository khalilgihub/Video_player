const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

async function main() {
  const screenshotsDir = path.join(__dirname, '../audit-evidence');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '../src/main/main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HYBRID_TEST_MODE: 'true',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // 1. Capture Toast Update Pill (Dark Theme)
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-theme');
    window.HybridToast.showUpdatePrompt({ latestVersion: '2026.10.26' });
  });
  await page.waitForTimeout(300);
  const pillDark = page.locator('#toastContainer .toast-update-pill');
  await pillDark.screenshot({ path: path.join(screenshotsDir, 'VERIFY_PICTURE1_TOAST_DARK.png') });

  // 2. Capture Toast Update Pill (Light Theme)
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    window.HybridToast.showUpdatePrompt({ latestVersion: '2026.10.26' });
  });
  await page.waitForTimeout(300);
  const pillLight = page.locator('#toastContainer .toast-update-pill');
  await pillLight.screenshot({ path: path.join(screenshotsDir, 'VERIFY_PICTURE1_TOAST_LIGHT.png') });

  // 3. Capture YouTube Settings Card (Dark Theme)
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-theme');
    const modal = document.getElementById('settingsModal');
    if (modal) {
      modal.hidden = false;
      modal.classList.add('active');
    }
    const card = document.getElementById('ytCookiesCard');
    if (card) {
      card.scrollIntoView({ block: 'center' });
    }
  });
  await page.waitForTimeout(600);
  const cardDark = page.locator('#ytCookiesCard');
  if (await cardDark.isVisible()) {
    await cardDark.screenshot({ path: path.join(screenshotsDir, 'VERIFY_PICTURE2_CARD_CONNECTED.png') });
  }

  // 3b. Capture YouTube Settings Card in Disconnected State (exact state from Picture 2)
  await page.evaluate(() => {
    const el = document.getElementById('settYtdlpCookies');
    const signinBtn = document.getElementById('btnYtSigninCookies');
    const signedInActions = document.getElementById('ytSignedInActions');
    const hint = document.getElementById('settYtdlpCookiesHint');
    if (el) {
      el.className = 'yt-status-badge yt-badge-disconnected';
      el.innerHTML = '<span class="yt-status-dot"></span>Not signed in';
    }
    if (signinBtn) {
      signinBtn.style.display = '';
      signinBtn.textContent = 'Sign in to YouTube';
    }
    if (signedInActions) signedInActions.style.display = 'none';
    if (hint) {
      hint.textContent = 'Click "Sign in to YouTube" to authenticate via a clean browser window. Session cookies sync automatically for 4K and restricted streams.';
    }
  });
  await page.waitForTimeout(300);
  if (await cardDark.isVisible()) {
    await cardDark.screenshot({ path: path.join(screenshotsDir, 'VERIFY_PICTURE2_CARD_DISCONNECTED.png') });
  }

  // 4. Capture Helper Companion Dialog (Picture 3)
  await page.evaluate(() => {
    window.hybridAPI?.youtube?.openSignin?.();
  });
  await page.waitForTimeout(1500);

  const windows = app.windows();
  for (const win of windows) {
    const title = await win.title();
    if (title === 'Sign in to YouTube') {
      await win.screenshot({ path: path.join(screenshotsDir, 'VERIFY_PICTURE3_DIALOG.png') });
      break;
    }
  }

  await app.close();
  console.log('Visual verification screenshots captured successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
