const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('load'),
  save: (data) => ipcRenderer.invoke('save', data),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  importPaths: (paths) => ipcRenderer.invoke('import-paths', paths),
  removeFile: (file) => ipcRenderer.invoke('remove-file', file),
  keepAwake: (on) => ipcRenderer.invoke('keep-awake', on),
  pathFor: (file) => webUtils.getPathForFile(file),
});
