import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/types';
const api: DesktopAPI = {
  request: (action, payload) => ipcRenderer.invoke('learning:request', action, payload),
  onCloseRequested: (handler) => {
    const listener = async () => {
      try {
        await handler();
        ipcRenderer.send('learning:close-ready');
      } catch {
        /* Failed draft saves must withhold close-ready and keep the window open. */
      }
    };
    ipcRenderer.on('learning:prepare-close', listener);
    return () => ipcRenderer.removeListener('learning:prepare-close', listener);
  },
};
contextBridge.exposeInMainWorld('learning', Object.freeze(api));
