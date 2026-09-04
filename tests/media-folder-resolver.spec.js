const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  resolveScreenshotSubfolder,
  sanitizeWindowsName,
  stripBracketTags,
  toTitleCase,
} = require('../src/main/media-folder-resolver');

test.describe('Media Folder Resolver for Smart Screenshot Organization', () => {

  test('Scenario 1: Word vs Code notation both resolve to the exact same folder', () => {
    const fileWord = 'E:\\vid\\mob psycho 100 season 1 episode 2.mkv';
    const fileCode = 'E:\\vid\\mob psycho 100 S01E03.mkv';

    const subfolderWord = resolveScreenshotSubfolder({ filePath: fileWord });
    const subfolderCode = resolveScreenshotSubfolder({ filePath: fileCode });

    expect(subfolderWord).toBe(path.join('Mob Psycho 100', 'Season 1'));
    expect(subfolderCode).toBe(path.join('Mob Psycho 100', 'Season 1'));
    expect(subfolderWord).toBe(subfolderCode);
  });

  test('Scenario 2: Fansub tags [Judas], [SubsPlease], and versioning v2 are stripped', () => {
    // User exact file
    const fileJudas = 'E:\\vid\\[Judas] Mob Psycho 100 (Season 3) [1080p]\\[Judas] Mob Psycho 100 - S03E01v2.mkv';
    const fileSubsPlease = 'C:\\Downloads\\[SubsPlease] Mob Psycho 100 - S03E01 (1080p) [A1B2C3D4].mkv';

    const resJudas = resolveScreenshotSubfolder({ filePath: fileJudas });
    const resSubsPlease = resolveScreenshotSubfolder({ filePath: fileSubsPlease });

    expect(resJudas).toBe(path.join('Mob Psycho 100', 'Season 3'));
    expect(resSubsPlease).toBe(path.join('Mob Psycho 100', 'Season 3'));
  });

  test('Scenario 3: Roman numerals (e.g. Mob Psycho 100 III) map to correct seasons', () => {
    const fileS3 = 'E:\\vid\\Mob Psycho 100 III - 01.mkv';
    const fileS2 = 'E:\\vid\\Mob Psycho 100 II - 05.mkv';

    const resS3 = resolveScreenshotSubfolder({ filePath: fileS3 });
    const resS2 = resolveScreenshotSubfolder({ filePath: fileS2 });

    expect(resS3).toBe(path.join('Mob Psycho 100', 'Season 3'));
    expect(resS2).toBe(path.join('Mob Psycho 100', 'Season 2'));
  });

  test('Scenario 4: Specials and OVAs map to Specials folder', () => {
    const fileOva = 'E:\\vid\\[Judas] Mob Psycho 100 - Consultation Office [OVA].mkv';
    const resOva = resolveScreenshotSubfolder({ filePath: fileOva });

    expect(resOva).toBe(path.join('Mob Psycho 100', 'Specials'));
  });

  test('Scenario 5: Dotted names (Scene releases) are cleanly spaced and parsed', () => {
    const fileDot = 'D:\\Torrents\\Mob.Psycho.100.S02E05.1080p.mkv';
    const resDot = resolveScreenshotSubfolder({ filePath: fileDot });

    expect(resDot).toBe(path.join('Mob Psycho 100', 'Season 2'));
  });

  test('Scenario 6: Standalone Movies vs Random camera recordings', () => {
    const movie = 'E:\\Movies\\Inception (2010).mp4';
    const random = 'C:\\Users\\User\\Videos\\VID_20260902_142030.mp4';

    const resMovie = resolveScreenshotSubfolder({ filePath: movie });
    const resRandom = resolveScreenshotSubfolder({ filePath: random });

    expect(resMovie).toBe('Inception (2010)');
    expect(resRandom).toBe(''); // Empty string = root Screenshots directory
  });

  test('Scenario 7: YouTube stream URLs with illegal Windows characters', () => {
    const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const titleIllegal = 'YOASOBI「Idol」| Official MV / 4K';

    const resYt = resolveScreenshotSubfolder({ filePath: ytUrl, mediaTitle: titleIllegal });

    // Illegal chars | and / replaced with -
    expect(resYt).toBe(path.join('YouTube', 'YOASOBI「Idol」 - Official MV - 4K'));
    expect(resYt).not.toContain('|');
    expect(resYt).not.toContain(':');
  });

  test('Scenario 8: YouTube anime trailer stream routes to Show/Trailers', () => {
    const ytUrl = 'https://www.youtube.com/watch?v=trailer123';
    const trailerTitle = 'Mob Psycho 100 Season 3 - Official Trailer | Crunchyroll';

    const resTrailer = resolveScreenshotSubfolder({ filePath: ytUrl, mediaTitle: trailerTitle });

    expect(resTrailer).toBe(path.join('Mob Psycho 100', 'Trailers'));
  });
});

test.describe('Auto-Organize Screenshots UI and IPC Integration', () => {
  const { _electron: electron } = require('@playwright/test');
  const fs = require('fs');
  const os = require('os');
  let electronApp;
  let window;
  let userDataDir;

  test.beforeAll(async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-auto-org-test-'));

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

  test('should render Auto-Organize toggle in Settings and persist preference', async () => {
    const result = await window.evaluate(async () => {
      const check = document.getElementById('settAutoOrganizeShots');
      const initialChecked = check ? check.checked : false;

      // Toggle off
      if (check) {
        check.checked = false;
        check.dispatchEvent(new Event('change'));
      }
      await new Promise(r => setTimeout(r, 50));
      const prefAfterOff = await window.hybridAPI.db.getPreference('autoOrganizeScreenshots');

      // Toggle on
      if (check) {
        check.checked = true;
        check.dispatchEvent(new Event('change'));
      }
      await new Promise(r => setTimeout(r, 50));
      const prefAfterOn = await window.hybridAPI.db.getPreference('autoOrganizeScreenshots');

      return {
        initialChecked,
        prefAfterOff,
        prefAfterOn,
      };
    });

    expect(result.initialChecked).toBe(true);
    expect(result.prefAfterOff).toBe(false);
    expect(result.prefAfterOn).toBe(true);
  });
});
