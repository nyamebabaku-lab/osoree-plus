// Gives the app this computer's ID (for its licence). Nothing else of Windows is exposed.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('osoreeDesktop', {
  deviceId: ipcRenderer.sendSync('osoree-device-id'),
  info: ipcRenderer.sendSync('osoree-device-info'),
  platform: 'windows',
  installUpdate: (url) => ipcRenderer.invoke('osoree-install-update', url),
  onUpdateProgress: (fn) => ipcRenderer.on('osoree-update-progress', (_e, p) => fn(p)),
});
