const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const SkinManager = require('./tray');
const { getLocale, getAvailableLocales, detectLocale } = require('./locales');

// GPU crash prevention — must be set before 'ready' event
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let skinManager;

app.whenReady().then(() => {
  skinManager = new SkinManager();
  skinManager.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      skinManager.createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep app running (system tray app)
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (skinManager.trayUpdateInterval) {
    clearInterval(skinManager.trayUpdateInterval);
  }
  if (skinManager.injector) {
    skinManager.injector.disconnect().catch(() => {});
  }
});

// ─── IPC Handlers ─────────────────────────────────────────────────────────

// Theme operations
ipcMain.handle('theme:list', () => skinManager.themeEngine.listThemes());
ipcMain.handle('theme:load', (_, name) => skinManager.themeEngine.loadTheme(name));
ipcMain.handle('theme:activate', (_, name) => skinManager.themeEngine.activateTheme(name));
ipcMain.handle('theme:get-active', () => skinManager.themeEngine.getActiveTheme());
ipcMain.handle('theme:install', (_, sourcePath) => skinManager.themeEngine.installTheme(sourcePath));
ipcMain.handle('theme:delete', (_, name) => skinManager.themeEngine.deleteTheme(name));
ipcMain.handle('theme:create', (_, name, baseTheme) => skinManager.themeEngine.createTheme(name, baseTheme));
ipcMain.handle('theme:export', (_, name) => {
  const defaultPath = path.join(app.getPath('downloads'), `${name}-theme.zip`);
  return skinManager.themeEngine.exportTheme(name, defaultPath);
});
ipcMain.handle('theme:set-background', (_, name, imagePath) =>
  skinManager.themeEngine.setBackgroundImage(name, imagePath)
);
ipcMain.handle('theme:remove-background', (_, name) =>
  skinManager.themeEngine.removeBackgroundImage(name)
);

// Backup operations
ipcMain.handle('backup:list', () => skinManager.themeEngine.listBackups());
ipcMain.handle('backup:restore', (_, backupName) => skinManager.themeEngine.restoreFromBackup(backupName));
ipcMain.handle('backup:current', () => skinManager.themeEngine.backupCurrentTheme());

// Process operations
ipcMain.handle('claude:status', async () => ({
  running: skinManager.claudeRunning,
  path: skinManager.processManager.findClaudePath(),
  userDataDir: skinManager.processManager.findUserDataDir(),
}));
ipcMain.handle('claude:restart-with-cdp', () => skinManager.restartClaudeWithCDP());

// Injection operations
ipcMain.handle('inject:status', () => skinManager.injectionStatus);
ipcMain.handle('inject:refresh', async () => {
  if (skinManager.injector) {
    await skinManager.injector.refreshAllInjections();
    return { ok: true };
  }
  return { ok: false };
});

// Window operations
ipcMain.handle('window:minimize', () => skinManager.mainWindow?.minimize());
ipcMain.handle('window:close', () => skinManager.mainWindow?.hide());

// File dialog
ipcMain.handle('dialog:open-file', async (_, options) => {
  const result = await dialog.showOpenDialog(skinManager.mainWindow, options);
  return result;
});

ipcMain.handle('dialog:save-file', async (_, options) => {
  const result = await dialog.showSaveDialog(skinManager.mainWindow, options);
  return result;
});

// Locale operations
ipcMain.handle('locale:get', () => skinManager.locale);
ipcMain.handle('locale:list', () => getAvailableLocales());
ipcMain.handle('locale:set', (_, locale) => {
  skinManager.locale = locale;
  skinManager._saveLocale(locale);
  skinManager.updateTrayMenu();
  return locale;
});
ipcMain.handle('locale:t', (_, key) => skinManager.t(key));
