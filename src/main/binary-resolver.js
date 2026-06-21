const path = require('path');
const fs = require('fs');

function isUsableFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function findBinaryInPath(binaryNames) {
  const envPath = process.env.PATH || '';
  const paths = envPath.split(path.delimiter);

  for (const dir of paths) {
    if (!dir) continue;
    const baseDir = path.resolve(dir);
    for (const name of binaryNames) {
      const candidate = path.join(baseDir, name);
      if (isUsableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function resolveYtDlpBinary(resourcesPath, execPath, appDir, options = {}) {
  const allowPathLookup = options.allowPathLookup !== false;
  const localCandidates = [
    path.join(resourcesPath || path.join(appDir, '../../'), 'mpv', 'yt-dlp.exe'),
    path.join(path.dirname(execPath), 'mpv', 'yt-dlp.exe'),
    path.join(appDir, '../../mpv/yt-dlp.exe'),
    path.join(appDir, '../../mpv/yt-dlp')
  ];

  for (const candidate of localCandidates) {
    const resolved = path.resolve(candidate);
    if (isUsableFile(resolved)) {
      return resolved;
    }
  }

  if (allowPathLookup) {
    const names = process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'];
    const inPath = findBinaryInPath(names);
    if (inPath) return inPath;
  }

  return null;
}

function resolveFfmpegBinary(resourcesPath, execPath, appDir, options = {}) {
  const allowPathLookup = options.allowPathLookup !== false;
  const candidates = process.platform === 'win32'
    ? [
        path.join(resourcesPath || '', 'ffmpeg', 'ffmpeg.exe'),
        path.join(resourcesPath || '', 'mpv', 'ffmpeg.exe'),
        path.join(path.dirname(execPath), 'ffmpeg', 'ffmpeg.exe'),
        path.join(appDir, '../../ffmpeg/ffmpeg.exe'),
        path.join(appDir, '../../node_modules/ffmpeg-static/ffmpeg.exe'),
      ]
    : [
        path.join(resourcesPath || '', 'ffmpeg', 'ffmpeg'),
        path.join(resourcesPath || '', 'mpv', 'ffmpeg'),
        path.join(path.dirname(execPath), 'ffmpeg', 'ffmpeg'),
        path.join(appDir, '../../ffmpeg/ffmpeg'),
        path.join(appDir, '../../node_modules/ffmpeg-static/ffmpeg'),
      ];

  for (const candidate of candidates) {
    const resolved = candidate ? path.resolve(candidate) : '';
    if (resolved && isUsableFile(resolved)) {
      return resolved;
    }
  }

  if (allowPathLookup) {
    const names = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
    const inPath = findBinaryInPath(names);
    if (inPath) return inPath;
  }

  return null;
}

function resolveMpvBinary(resourcesPath, execPath, appDir, options = {}) {
  const allowPathLookup = options.allowPathLookup !== false;
  const candidates = process.platform === 'win32'
    ? [
        path.join(resourcesPath || path.join(appDir, '../../'), 'mpv', 'mpv.exe'),
        path.join(path.dirname(execPath), 'mpv', 'mpv.exe'),
        path.join(appDir, '../../mpv/mpv.exe'),
      ]
    : [
        path.join(resourcesPath || path.join(appDir, '../../'), 'mpv', 'mpv'),
        path.join(path.dirname(execPath), 'mpv', 'mpv'),
        path.join(appDir, '../../mpv/mpv'),
      ];

  for (const candidate of candidates) {
    const resolved = candidate ? path.resolve(candidate) : '';
    if (resolved && isUsableFile(resolved)) {
      return resolved;
    }
  }

  if (allowPathLookup) {
    const names = process.platform === 'win32' ? ['mpv.exe', 'mpv'] : ['mpv'];
    const inPath = findBinaryInPath(names);
    if (inPath) return inPath;
  }

  return null;
}

function resolveBundledBinaryPath(binaryName, isPackaged, resourcesPath, appDir) {
  if (isPackaged) {
    return path.join(resourcesPath, 'mpv', binaryName);
  }
  return path.join(appDir, '../../mpv', binaryName);
}

module.exports = {
  resolveYtDlpBinary,
  resolveFfmpegBinary,
  resolveMpvBinary,
  resolveBundledBinaryPath
};
