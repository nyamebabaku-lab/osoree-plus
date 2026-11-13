// Gives the app this computer's ID (for its licence). Nothing else of Windows is exposed.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('osoreeDesktop', { deviceId: ipcRenderer.sendSync('osoree-device-id'), platform: 'windows' });
