const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('classroomAPI', {
  listSources: () => ipcRenderer.invoke('capture:list-sources'),
  takeCapture: (sourceId) => ipcRenderer.invoke('capture:take', sourceId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:set-always-on-top', enabled),
  ask: (payload) => ipcRenderer.invoke('ai:ask', payload),
  onAskShortcut: (callback) => ipcRenderer.on('shortcut:ask', callback)
});

