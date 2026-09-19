const { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const fsp = fs.promises;
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus', '.webm'];

let dataFile;
let audioDir;
let blockerId = null;

const defaultData = () => ({
  folders: [{ id: 'default', name: 'My sounds', enabled: true }],
  clips: [],
  settings: {
    intervalMin: 1,
    intervalMax: 5,
    intervalUnit: 'm', // 's' | 'm'
    durationValue: 30,
    durationUnit: 'm', // 'm' | 'h'
    unlimited: false,
    volume: 80,
    avoidRepeat: true,
    keepAwake: true,
    showNext: false,
  },
});

async function readData() {
  const defaults = defaultData();
  try {
    const raw = JSON.parse(await fsp.readFile(dataFile, 'utf8'));
    return {
      folders: Array.isArray(raw.folders) ? raw.folders : defaults.folders,
      clips: Array.isArray(raw.clips) ? raw.clips : [],
      settings: { ...defaults.settings, ...raw.settings },
    };
  } catch {
    return defaults;
  }
}

async function writeData(data) {
  if (!data || !Array.isArray(data.folders) || !Array.isArray(data.clips)) return;
  const tmp = dataFile + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, dataFile);
}

// Copies audio files into the app's own storage so clips survive the originals being moved.
async function copyIn(paths) {
  await fsp.mkdir(audioDir, { recursive: true });
  const added = [];
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();
    if (!AUDIO_EXTS.includes(ext)) continue;
    try {
      if (!(await fsp.stat(p)).isFile()) continue;
      const file = crypto.randomUUID() + ext;
      await fsp.copyFile(p, path.join(audioDir, file));
      added.push({ name: path.basename(p, path.extname(p)), file });
    } catch (err) {
      console.error('Could not import', p, err);
    }
  }
  return added;
}

function registerIpc() {
  ipcMain.handle('load', async () => ({
    data: await readData(),
    audioUrl: pathToFileURL(audioDir).href + '/',
  }));

  ipcMain.handle('save', (_e, data) => writeData(data));

  ipcMain.handle('pick-files', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Add sounds',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTS.map((x) => x.slice(1)) }],
    });
    return canceled ? [] : copyIn(filePaths);
  });

  ipcMain.handle('pick-folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import a folder of sounds',
      properties: ['openDirectory'],
    });
    if (canceled) return null;
    const dir = filePaths[0];
    const names = await fsp.readdir(dir);
    return { name: path.basename(dir), files: await copyIn(names.map((n) => path.join(dir, n))) };
  });

  ipcMain.handle('import-paths', (_e, paths) => copyIn(Array.isArray(paths) ? paths : []));

  ipcMain.handle('remove-file', async (_e, file) => {
    if (typeof file !== 'string' || path.basename(file) !== file) return;
    await fsp.rm(path.join(audioDir, file), { force: true });
  });

  ipcMain.handle('keep-awake', (_e, on) => {
    if (on && blockerId === null) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!on && blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 640,
    minHeight: 500,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Keep audio scheduling running when the window is minimized/hidden.
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  dataFile = path.join(app.getPath('userData'), 'library.json');
  audioDir = path.join(app.getPath('userData'), 'audio');
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
