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
    restoreDefault: () => ipcRenderer.invoke('theme:restore-default'),
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
    setPath: (exePath) => ipcRenderer.invoke('claude:set-path', exePath),
    browsePath: () => ipcRenderer.invoke('claude:browse-path'),
  },

  // Injection API
  inject: {
    status: () => ipcRenderer.invoke('inject:status'),
    refresh: () => ipcRenderer.invoke('inject:refresh'),
    restore: () => ipcRenderer.invoke('inject:restore'),
  },

  // Window API
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
  },

  // Locale API
  locale: {
    get: () => ipcRenderer.invoke('locale:get'),
    list: () => ipcRenderer.invoke('locale:list'),
    set: (locale) => ipcRenderer.invoke('locale:set', locale),
    t: (key) => ipcRenderer.invoke('locale:t', key),
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
