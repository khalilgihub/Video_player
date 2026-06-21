const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasExtraResource(config, predicate) {
  return Array.isArray(config.extraResources) && config.extraResources.some(predicate);
}

const packageJson = readJson('package.json');
const builderConfig = readJson('electron-builder.json');

assert(packageJson.dependencies?.['ffmpeg-static'], 'ffmpeg-static must be a production dependency.');
assert(packageJson.scripts?.verify, 'package.json must define a verify script.');
assert(packageJson.scripts?.['test:release'], 'package.json must define a test:release script.');
assert(packageJson.scripts?.['verify:release'], 'package.json must define a verify:release script.');

assert(
  hasExtraResource(builderConfig, (item) => String(item.from || '').replace(/\\/g, '/') === 'mpv/'),
  'electron-builder must package bundled mpv resources.'
);
assert(
  hasExtraResource(builderConfig, (item) => String(item.from || '').replace(/\\/g, '/') === 'node_modules/ffmpeg-static/'),
  'electron-builder must package ffmpeg-static as an external ffmpeg resource.'
);
assert(
  Array.isArray(builderConfig.files) && builderConfig.files.includes('!node_modules/ffmpeg-static/**/*'),
  'electron-builder must exclude duplicate ffmpeg-static files from app.asar.'
);
assert(builderConfig.win?.signAndEditExecutable === true, 'Windows signing/editing must not be disabled.');

for (const file of ['src/main/main.js', 'src/main/ipc-handlers.js', 'src/main/menu.js']) {
  const text = readText(file);
  assert(!text.includes("name: 'All Files'"), `${file} must not expose unrestricted All Files dialogs.`);
  assert(!text.includes('"All Files"'), `${file} must not expose unrestricted All Files dialogs.`);
}

for (const file of ['src/main/main.js', 'src/main/mpv-ipc-bridge.js', 'src/main/mpv-process.js']) {
  assert(!readText(file).includes('TEMP DEBUG'), `${file} still contains TEMP DEBUG scaffolding.`);
}

assert(
  readText('src/main/main.js').includes("ipcMain.handle('app:get-startup-diagnostics'"),
  'main process must expose startup diagnostics.'
);
assert(
  readText('src/renderer/app.js').includes('_showStartupDiagnostics'),
  'renderer must display startup diagnostics.'
);

console.log('Static release-readiness checks passed.');
