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
const MEDIA_DIALOG_EXTENSIONS = Array.from(MEDIA_EXTENSIONS, (ext) => ext.slice(1));
const FOLDER_SCAN_MAX_DEPTH = 8;
const FOLDER_SCAN_MAX_FILES = 2000;
const FOLDER_SCAN_MAX_DIRS = 5000;

function createMediaFilters() {
  return [
    { name: 'Media Files', extensions: MEDIA_DIALOG_EXTENSIONS }
  ];
}

function collectFolderMediaFiles(folderPath) {
  const root = typeof folderPath === 'string' ? path.resolve(folderPath) : null;
  if (!root) return [];

  const mediaFiles = [];
  let visitedDirs = 0;

  function walk(dirPath, depth) {
    if (mediaFiles.length >= FOLDER_SCAN_MAX_FILES) return;
    if (depth > FOLDER_SCAN_MAX_DEPTH) return;
    visitedDirs += 1;
    if (visitedDirs > FOLDER_SCAN_MAX_DIRS) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    for (const entry of entries) {
      if (mediaFiles.length >= FOLDER_SCAN_MAX_FILES || visitedDirs > FOLDER_SCAN_MAX_DIRS) return;
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(entryPath, depth + 1);
        continue;
      }
      if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        mediaFiles.push(entryPath);
      }
    }
  }

  try {
    if (!fs.statSync(root).isDirectory()) return [];
  } catch {
    return [];
  }

  walk(root, 0);
  return mediaFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
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
  win.webContents.send('menu-action', 'media-open-folder', collectFolderMediaFiles(folderPath));
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
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Renderer DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (!win || win.isDestroyed()) return;
            if (win.webContents.isDevToolsOpened()) {
              win.webContents.closeDevTools();
            } else {
              win.webContents.openDevTools({ mode: 'detach' });
            }
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { createApplicationMenu };
