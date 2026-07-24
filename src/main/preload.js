const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cds', {
  // Theme API
  themes: {
    list: () => ipcRenderer.invoke('theme:list'),
    load: (name) => ipcRenderer.invoke('theme:load', name),
    activate: (name) => ipcRenderer.invoke('theme:activate', name),
    getActive: () => ipcRenderer.invoke('theme:get-active'),
    install: (sourcePath) => ipcRenderer.invoke('theme:install', sourcePath),
    delete: (name) => ipcRenderer.invoke('theme:delete', name),
    create: (name, baseTheme) => ipcRenderer.invoke('theme:create', name, baseTheme),
    export: (name) => ipcRenderer.invoke('theme:export', name),
    setBackground: (name, imagePath) => ipcRenderer.invoke('theme:set-background', name, imagePath),
    removeBackground: (name) => ipcRenderer.invoke('theme:remove-background', name),
  },

  // Backup API
  backups: {
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (name) => ipcRenderer.invoke('backup:restore', name),
    create: () => ipcRenderer.invoke('backup:current'),
  },

  // Claude status API
  claude: {
    status: () => ipcRenderer.invoke('claude:status'),
    restartWithCDP: () => ipcRenderer.invoke('claude:restart-with-cdp'),
  },

  // Injection API
  inject: {
    status: () => ipcRenderer.invoke('inject:status'),
    refresh: () => ipcRenderer.invoke('inject:refresh'),
  },

  // Window API
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
  },

  // Dialog API
  dialog: {
    openFile: (opts) => ipcRenderer.invoke('dialog:open-file', opts),
    saveFile: (opts) => ipcRenderer.invoke('dialog:save-file', opts),
  },

  // Event listener
  on: (channel, callback) => {
    const validChannels = [
      'theme-changed', 'injection-status', 'injection-event',
      'claude-status-changed', 'error', 'refresh-themes'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => callback(data));
    }
  },
});
