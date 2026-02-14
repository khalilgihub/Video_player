/**
 * Hybrid Player - Application Menu
 */

const { Menu, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.wmv', '.ts', '.m2ts', '.mts',
  '.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff', '.alac',
  '.m3u8', '.mpd'
]);

function createMediaFilters() {
  return [
    { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v', 'wmv', 'ts', 'm2ts', 'mts', 'mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'alac', 'm3u8', 'mpd'] },
    { name: 'All Files', extensions: ['*'] }
  ];
}

async function handleOpenFile(win) {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Media File',
    properties: ['openFile'],
    filters: createMediaFilters()
  });
  if (!result.canceled && result.filePaths.length > 0) {
    win.webContents.send('menu-action', 'media-open-file', result.filePaths[0]);
  }
}

async function handleOpenMultipleFiles(win) {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Multiple Media Files',
    properties: ['openFile', 'multiSelections'],
    filters: createMediaFilters()
  });
  if (!result.canceled && result.filePaths.length > 0) {
    win.webContents.send('menu-action', 'media-open-multiple', result.filePaths);
  }
}

async function handleOpenFolder(win) {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Folder',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) return;

  const folderPath = result.filePaths[0];
  let mediaFiles = [];

  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    mediaFiles = entries
      .filter((entry) => entry.isFile())
      .filter((entry) => MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(folderPath, entry.name))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
  } catch {
    mediaFiles = [];
  }

  win.webContents.send('menu-action', 'media-open-folder', mediaFiles);
}

function createApplicationMenu(win) {
  const template = [
    {
      label: 'Media',
      submenu: [
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => handleOpenFile(win)
        },
        {
          label: 'Open Multiple Files...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => handleOpenMultipleFiles(win)
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+F',
          click: async () => handleOpenFolder(win)
        },
        {
          label: 'Open Network Stream...',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('menu-action', 'media-open-network-stream')
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { createApplicationMenu };
