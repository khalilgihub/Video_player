const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveFfmpegBinary } = require('../src/main/binary-resolver');

test.describe('binary resolver hardening', () => {
  test('prefers bundled ffmpeg resources without PATH lookup', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-binary-test-'));
    const resourcesDir = path.join(tempRoot, 'resources');
    const execDir = path.join(tempRoot, 'exec');
    const appDir = path.join(tempRoot, 'app', 'src', 'main');
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const bundledBinary = path.join(resourcesDir, 'ffmpeg', binaryName);

    try {
      fs.mkdirSync(path.dirname(bundledBinary), { recursive: true });
      fs.mkdirSync(execDir, { recursive: true });
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(bundledBinary, '');

      const execPath = path.join(execDir, process.platform === 'win32' ? 'app.exe' : 'app');
      expect(resolveFfmpegBinary(resourcesDir, execPath, appDir, { allowPathLookup: false })).toBe(bundledBinary);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('resolves ffmpeg-static in development without PATH lookup', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-binary-test-'));
    const resourcesDir = path.join(tempRoot, 'resources');
    const execDir = path.join(tempRoot, 'exec');
    const appDir = path.join(tempRoot, 'app', 'src', 'main');
    const projectRoot = path.resolve(appDir, '../..');
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const staticBinary = path.join(projectRoot, 'node_modules', 'ffmpeg-static', binaryName);

    try {
      fs.mkdirSync(resourcesDir, { recursive: true });
      fs.mkdirSync(execDir, { recursive: true });
      fs.mkdirSync(path.dirname(staticBinary), { recursive: true });
      fs.writeFileSync(staticBinary, '');

      const execPath = path.join(execDir, process.platform === 'win32' ? 'app.exe' : 'app');
      expect(resolveFfmpegBinary(resourcesDir, execPath, appDir, { allowPathLookup: false })).toBe(staticBinary);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('does not fall back to PATH when PATH lookup is disabled', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-binary-test-'));
    const pathDir = path.join(tempRoot, 'path-bin');
    const resourcesDir = path.join(tempRoot, 'resources');
    const execDir = path.join(tempRoot, 'exec');
    const appDir = path.join(tempRoot, 'app', 'src', 'main');
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const fakeBinary = path.join(pathDir, binaryName);
    const previousPath = process.env.PATH;

    try {
      fs.mkdirSync(pathDir, { recursive: true });
      fs.mkdirSync(resourcesDir, { recursive: true });
      fs.mkdirSync(execDir, { recursive: true });
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(fakeBinary, '');
      process.env.PATH = pathDir;

      const execPath = path.join(execDir, process.platform === 'win32' ? 'app.exe' : 'app');
      expect(resolveFfmpegBinary(resourcesDir, execPath, appDir, { allowPathLookup: false })).toBeNull();
      expect(resolveFfmpegBinary(resourcesDir, execPath, appDir, { allowPathLookup: true })).toBe(fakeBinary);
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
