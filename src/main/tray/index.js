const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const ThemeEngine = require('../theme');
const CDPInjector = require('../injector');
const ProcessManager = require('../process-manager');
const { detectLocale, getLocale } = require('../locales');

class SkinManager {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.themeEngine = ThemeEngine;
    this.injector = null;
    this.processManager = ProcessManager;
    this.claudeRunning = false;
    this.injectionStatus = { connected: false, injecting: false, error: null };
    this.trayUpdateInterval = null;
    this.locale = this._loadLocale();
  }

  _loadLocale() {
    try {
      const store = require('electron-store');
      const s = new store({ name: 'settings' });
      return s.get('locale') || detectLocale();
    } catch (_) {
      return detectLocale();
    }
  }

  _saveLocale(locale) {
    try {
      const store = require('electron-store');
      const s = new store({ name: 'settings' });
      s.set('locale', locale);
    } catch (_) {}
  }

  t(key) {
    return getLocale(this.locale)[key] || key;
  }

  start() {
    this.createWindow();
    this.createTray();

    // Check Claude status periodically
    this.trayUpdateInterval = setInterval(() => {
      this.checkClaudeStatus();
    }, 5000);

    // Initial check
    this.checkClaudeStatus();
  }

  async checkClaudeStatus() {
    const wasRunning = this.claudeRunning;
    this.claudeRunning = await this.processManager.isRunning();

    if (this.claudeRunning !== wasRunning) {
      this.updateTrayMenu();
      this.sendToWindow('claude-status-changed', { running: this.claudeRunning });

      if (this.claudeRunning) {
        // Auto-connect and inject
        this.autoInject();
      } else {
        // Claude stopped, clean up
        if (this.injector) {
          await this.injector.disconnect();
          this.injector = null;
          this.injectionStatus = { connected: false, injecting: false, error: null };
          this.sendToWindow('injection-status', this.injectionStatus);
        }
      }
    }
  }

  async autoInject() {
    if (this.injector) return; // Already connected

    try {
      const port = this.processManager.debugPort;

      // If Claude is already running, check if CDP is available
      const inUse = await this.processManager.isPortInUse(port);
      let cdpAvailable = false;

      if (inUse) {
        try {
          const http = require('http');
          const data = await new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 3000 }, (res) => {
              let body = '';
              res.on('data', d => body += d);
              res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(e); }
              });
            }).on('error', reject);
          });
          cdpAvailable = data.Browser?.includes('Electron');
        } catch (e) {
          cdpAvailable = false;
        }
      }

      if (!cdpAvailable) {
        // Need to restart Claude with CDP enabled
        this.injectionStatus = { connected: false, injecting: false, error: 'restart-required' };
        this.sendToWindow('injection-status', this.injectionStatus);
        return;
      }

      await this.connectAndInject(port);
    } catch (e) {
      this.injectionStatus = { connected: false, injecting: false, error: e.message };
      this.sendToWindow('injection-status', this.injectionStatus);
    }
  }

  async connectAndInject(port) {
    this.injectionStatus = { connected: false, injecting: true, error: null };
    this.sendToWindow('injection-status', this.injectionStatus);

    try {
      this.injector = new CDPInjector(port);
      await this.injector.connect();

      // Get active theme
      const theme = this.themeEngine.getActiveTheme();

      // Build theme meta for the renderer engine
      const themeMeta = {
        name: theme.name,
        displayName: theme.displayName,
        tagline: theme.tagline || '',
        backgroundBase64: theme.backgroundBase64 || null,
        taskMode: theme.taskMode || 'immersive',
        dynamic: theme.dynamic || null,
        style: theme.style || 'default',
      };

      // Pass theme CSS (with tokens) — renderer-inject.js will compile at runtime
      // The skin CSS is already in the renderer-inject.js code
      await this.injector.setTheme(theme.css, themeMeta);

      this.injectionStatus = { connected: true, injecting: false, error: null };
      this.sendToWindow('injection-status', this.injectionStatus);
      this.updateTrayMenu();

      // Listen for injection events
      this.injector.onInjection((event) => {
        this.sendToWindow('injection-event', event);
      });

    } catch (e) {
      this.injectionStatus = { connected: false, injecting: false, error: e.message };
      this.sendToWindow('injection-status', this.injectionStatus);
      this.injector = null;
    }
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 480,
      height: 640,
      minWidth: 400,
      minHeight: 500,
      resizable: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#0d0d0f',
      title: 'Claude Code Dream Skin',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
    this.mainWindow.on('close', (e) => {
      if (!app.isQuitting) {
        e.preventDefault();
        this.mainWindow.hide();
      }
    });
  }

  createTray() {
    // Create a simple tray icon (16x16 colored square)
    const iconSize = 16;
    const canvas = nativeImage.createEmpty();
    const buf = Buffer.alloc(iconSize * iconSize * 4);

    // Draw a simple orange gradient icon
    for (let y = 0; y < iconSize; y++) {
      for (let x = 0; x < iconSize; x++) {
        const i = (y * iconSize + x) * 4;
        // Orange color with slight gradient
        const t = y / iconSize;
        buf[i] = 255;                         // R
        buf[i + 1] = Math.floor(107 + t * 20); // G
        buf[i + 2] = Math.floor(53 - t * 10);  // B
        buf[i + 3] = 255;                     // A
      }
    }

    const icon = nativeImage.createFromBuffer(buf, { width: iconSize, height: iconSize });
    this.tray = new Tray(icon);
    this.tray.setToolTip('Claude Code Dream Skin');
    this.updateTrayMenu();
    this.tray.on('click', () => this.toggleWindow());
  }

  updateTrayMenu() {
    if (!this.tray) return;

    const themes = this.themeEngine.listThemes();
    const currentTheme = this.themeEngine.activeThemeName;

    const template = [
      {
        label: this.t('trayAppName'),
        enabled: false,
      },
      { type: 'separator' },
      {
        label: this.claudeRunning ? this.t('claudeRunning') : this.t('claudeNotRunning'),
        enabled: false,
      },
      {
        label: this.injectionStatus.connected ? this.t('themeActive') : this.t('themeInactive'),
        enabled: false,
      },
      { type: 'separator' },
      { label: this.t('showManager'), click: () => this.showWindow() },
      { type: 'separator' },
    ];

    // Theme submenu
    if (themes.length > 0) {
      const themeSubmenu = themes.map(t => ({
        label: t.name === currentTheme ? `[${t.displayName || t.name}]` : (t.displayName || t.name),
        click: () => this.switchTheme(t.name),
        type: 'radio',
        checked: t.name === currentTheme,
      }));
      template.push({ label: this.t('switchTheme'), submenu: themeSubmenu });
    }

    template.push(
      { type: 'separator' },
      { label: this.t('restoreDefault'), click: () => this.restoreDefault() },
      { label: this.t('manageThemes'), click: () => this.showWindow() },
      { type: 'separator' },
      { label: this.t('quit'), click: () => { app.isQuitting = true; app.quit(); } }
    );

    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  toggleWindow() {
    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.showWindow();
    }
  }

  showWindow() {
    this.mainWindow.show();
    this.mainWindow.focus();
    this.sendToWindow('refresh-themes', {});
  }

  async switchTheme(name) {
    const result = this.themeEngine.activateTheme(name);
    if (!result.ok) {
      this.sendToWindow('error', { message: result.error });
      return;
    }

    // Inject new theme if connected
    if (this.injector && this.injectionStatus.connected) {
      const theme = this.themeEngine.getActiveTheme();
      const fullCSS = this.themeEngine.getInjectionCSS(theme.css, theme.backgroundBase64);
      const themeMeta = {
        name: theme.name,
        displayName: theme.displayName,
        tagline: theme.tagline || '',
        backgroundBase64: theme.backgroundBase64 || null,
        taskMode: theme.taskMode || 'immersive',
        dynamic: theme.dynamic || null,
        style: theme.style || 'default',
      };
      await this.injector.setTheme(fullCSS, themeMeta);
    }

    this.updateTrayMenu();
    this.sendToWindow('theme-changed', { name });
  }

  async restoreDefault() {
    // Confirm with user
    const { response } = await dialog.showMessageBox(this.mainWindow, {
      type: 'question',
      buttons: ['Restore Default', 'Cancel'],
      defaultId: 1,
      title: 'Restore Default Theme',
      message: 'This will restore the original Claude Desktop appearance.',
      detail: 'A backup will be created automatically.',
    });

    if (response !== 0) return;

    const result = this.themeEngine.restoreDefault();

    if (result.ok) {
      // Remove injected CSS
      if (this.injector) {
        await this.injector.restoreDefault();
      }

      this.updateTrayMenu();
      this.sendToWindow('theme-changed', { name: null });
    } else {
      this.sendToWindow('error', { message: result.error });
    }
  }

  async restartClaudeWithCDP() {
    try {
      this.injectionStatus = { connected: false, injecting: true, error: null };
      this.sendToWindow('injection-status', this.injectionStatus);

      const result = await this.processManager.launchWithCDP();
      const cdpInfo = await this.processManager.waitForCDP(result.port);

      await this.connectAndInject(result.port);
    } catch (e) {
      this.injectionStatus = { connected: false, injecting: false, error: e.message };
      this.sendToWindow('injection-status', this.injectionStatus);
    }
  }

  sendToWindow(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}

module.exports = SkinManager;
