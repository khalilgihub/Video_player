const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logFilePath = null;
let projectLogFilePath = null;

function initFullscreenLogger(baseDir = __dirname) {
  try {
    const userDataPath = app?.getPath ? app.getPath('userData') : null;
    if (userDataPath) {
      logFilePath = path.join(userDataPath, 'fullscreen-debug.log');
    }
  } catch (_) {}

  // Also write to current working directory or hybrid-player root for instant user access
  try {
    const cwd = process.cwd();
    projectLogFilePath = path.join(cwd, 'fullscreen-debug.log');
  } catch (_) {}

  const header = `\n==================== FULLSCREEN SESSION STARTED: ${new Date().toISOString()} ====================\n`;
  writeLog(header, false);
}

function writeLog(line, timestamp = true) {
  const formatted = timestamp ? `[${new Date().toISOString()}] ${line}\n` : line;
  console.log(formatted.trim());

  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, formatted, 'utf8');
    } catch (_) {}
  }
  if (projectLogFilePath) {
    try {
      fs.appendFileSync(projectLogFilePath, formatted, 'utf8');
    } catch (_) {}
  }
}

function logFs(event, details = {}) {
  let detailStr = '';
  try {
    detailStr = typeof details === 'string' ? details : JSON.stringify(details);
  } catch (_) {
    detailStr = String(details);
  }
  writeLog(`[FULLSCREEN-LOG] ${event} | ${detailStr}`);
}

function getLogPaths() {
  return {
    userDataLog: logFilePath,
    projectLog: projectLogFilePath
  };
}

module.exports = {
  initFullscreenLogger,
  logFs,
  getLogPaths,
};
