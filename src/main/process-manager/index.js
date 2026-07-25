const { exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const crypto = require('crypto');

const STATE_VERSION = 2;
const STATE_PATH = path.join(os.homedir(), '.claude-dream-skin', 'state.json');
const SAFE_CSS_PROPS = new Set([
  'background','background-color','background-image','background-size','background-position',
  'background-repeat','background-blend-mode','background-clip','background-origin',
  'color','font-family','font-size','font-weight','font-style','line-height','letter-spacing',
  'text-shadow','opacity','visibility','filter','backdrop-filter','mix-blend-mode',
  'border','border-radius','border-color','border-width','box-shadow',
  'outline','cursor','pointer-events','user-select',
  'transform','transition','animation','will-change',
  'display','flex','grid','gap','padding','margin',
  'z-index','position','top','left','right','bottom',
  'width','height','min-width','max-width','min-height','max-height',
  'overflow','overflow-x','overflow-y',
  'scrollbar-width','scrollbar-color',
  'accent-color','caret-color',
  'text-decoration','text-transform','word-break','white-space',
  'fill','stroke',
]);

/**
 * Detects Claude Desktop installation using multiple strategies,
 * ordered by reliability and speed. Inspired by Codex Dream Skin's
 * Store-package-first approach.
 */
class ProcessManager {
  constructor() {
    this.debugPort = parseInt(process.env.DREAM_SKIN_DEBUG_PORT || '9222');
    this.claudePath = null;
    this.claudePid = null;
    this.userDataDir = null;
    this._state = null;
    this._loading = false;
    this._loadState();
  }

  /**
   * Extract browser ID from CDP version response.
   * Codex Dream Skin pattern: verify port listener belongs to the correct browser.
   */
  _extractBrowserId(version) {
    if (!version || !version.Browser) return null;
    const match = version.Browser.match(/DevTools\s+(.+?)(?:\s+\d|$)/);
    if (match) return match[1].trim();
    if (version.webSocketDebuggerUrl) {
      try {
        const url = new URL(version.webSocketDebuggerUrl);
        const m = url.pathname.match(/^\/devtools\/browser\/(.+)$/);
        if (m) return m[1];
      } catch (_) {}
    }
    return null;
  }

  // ── State Management ──────────────────────────────────────────────────────

  _loadState() {
    try {
      if (fs.existsSync(STATE_PATH)) {
        this._state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      }
    } catch (e) {
      this._state = null;
    }
  }

  _saveState(state) {
    try {
      const dir = path.dirname(STATE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      state.schemaVersion = STATE_VERSION;
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
      this._state = state;
    } catch (e) {}
  }

  /**
   * Verify that the current state matches a CDP endpoint.
   * Checks browser ID to prevent CDP hijacking by a different process.
   */
  async verifyStateAgainstCdp(port) {
    if (!this._state) return { match: false, reason: 'no-state' };
    try {
      const data = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 3000 }, res => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
          });
        }).on('error', reject);
      });

      const browserId = this._extractBrowserId(data);

      // Check port matches
      if (this._state.port && this._state.port !== port) {
        return { match: false, reason: 'port-mismatch', expectedPort: this._state.port };
      }

      // Check browser ID if we have one saved
      if (browserId && this._state.browserId && browserId !== this._state.browserId) {
        return { match: false, reason: 'browser-id-mismatch', expected: this._state.browserId, actual: browserId };
      }

      return { match: true, browserId, version: data.Browser };
    } catch (e) {
      return { match: false, reason: e.message };
    }
  }

  getState() {
    return this._state;
  }

  // ── Persisted Settings ────────────────────────────────────────────────────

  _getStore() {
    try {
      return require('electron-store');
    } catch (e) {
      return null;
    }
  }

  _storeGet(key) {
    try {
      const Store = this._getStore();
      if (!Store) return null;
      const s = new Store({ name: 'settings' });
      const v = s.get(key);
      return v || null;
    } catch (e) { return null; }
  }

  _storeSet(key, val) {
    try {
      const Store = this._getStore();
      if (!Store) return;
      const s = new Store({ name: 'settings' });
      s.set(key, val);
    } catch (e) {}
  }

  getManualPath() {
    return this._storeGet('claude-path');
  }

  saveManualPath(exePath) {
    this._storeSet('claude-path', exePath);
  }

  getSavedUserDataDir() {
    return this._storeGet('user-data-dir');
  }

  saveUserDataDir(dir) {
    this._storeSet('user-data-dir', dir);
  }

  // ── Path Safety ───────────────────────────────────────────────────────────

  /**
   * Validate that a path doesn't escape its root via junctions/symlinks.
   * Mirrors Codex Dream Skin's Assert-DreamSkinNoReparseComponents.
   */
  _assertSafePath(filePath, rootDir) {
    const fullPath = path.resolve(filePath);
    const fullRoot = path.resolve(rootDir);
    let current = fullPath;

    while (true) {
      if (!fs.existsSync(current)) break;
      try {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
          throw new Error(`Path contains symbolic link: ${current}`);
        }
        if ((stat.mode & 0o120000) !== 0 && stat.nlink === 0) {
          // Junction detection on Windows (reparse point)
          throw new Error(`Path contains junction/reparse point: ${current}`);
        }
      } catch (e) {
        if (e.message.includes('symbolic link') || e.message.includes('junction')) {
          throw e;
        }
      }
      if (path.resolve(current) === fullRoot) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  _pathWithin(filePath, rootDir) {
    const fullPath = path.resolve(filePath);
    const fullRoot = path.resolve(rootDir).replace(/[\\/]$/, '');
    if (fullPath === fullRoot) return true;
    return fullPath.startsWith(fullRoot + path.sep);
  }

  // ── Store Package Detection (Codex-style) ─────────────────────────────────

  /**
   * Try to find Claude via PowerShell Get-AppxPackage.
   * This is Codex Dream Skin's primary detection method — it queries
   * the Windows Store package database which is more reliable than
   * filesystem scanning.
   */
  _detectViaStorePackage() {
    try {
      const output = execSync(
        'powershell -NoProfile -Command "Get-AppxPackage -Name *Claude* -ErrorAction Stop 2>$null | Select-Object Name,InstallLocation,PackageFullName,PackageFamilyName,SignatureKind | ConvertTo-Json -Depth 3"',
        { encoding: 'utf8', timeout: 10000, shell: 'cmd.exe', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const packages = JSON.parse(output);
      const list = Array.isArray(packages) ? packages : [packages].filter(Boolean);

      for (const pkg of list) {
        if (!pkg.InstallLocation) continue;
        const installDir = pkg.InstallLocation;
        const candidateExe = path.join(installDir, 'app', 'Claude.exe');

        if (fs.existsSync(candidateExe)) {
          return {
            path: path.resolve(candidateExe),
            source: 'store-package',
            packageFullName: pkg.PackageFullName || null,
            packageFamilyName: pkg.PackageFamilyName || null,
            signatureKind: pkg.SignatureKind || null,
            installLocation: installDir,
            appUserModelId: pkg.PackageFamilyName ? `${pkg.PackageFamilyName}!App` : null,
          };
        }
      }
    } catch (e) {
      // Get-AppxPackage returned no results or failed
    }
    return null;
  }

  // ── Process Detection ─────────────────────────────────────────────────────

  /**
   * Detect Claude Desktop via running process (WMIC or PowerShell).
   * Fastest method when Claude is already open.
   */
  _detectViaRunningProcess() {
    // Try PowerShell first (faster, no deprecated WMIC warnings)
    try {
      const output = execSync(
        'powershell -NoProfile -Command "Get-Process -Name Claude -ErrorAction Stop | Select-Object -ExpandProperty Path"',
        { encoding: 'utf8', timeout: 5000, shell: 'cmd.exe', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const exePath = output.trim();
      if (exePath && fs.existsSync(exePath)) {
        return { path: path.resolve(exePath), source: 'running-process' };
      }
    } catch (e) {}

    // Fallback: WMIC
    try {
      const output = execSync(
        "wmic process where \"name='Claude.exe'\" get ExecutablePath /format:list",
        { encoding: 'utf8', timeout: 5000 }
      );
      const match = output.match(/ExecutablePath\s*=\s*(.+)/);
      if (match && fs.existsSync(match[1].trim())) {
        return { path: path.resolve(match[1].trim()), source: 'running-process' };
      }
    } catch (e) {}

    return null;
  }

  /**
   * Detect Claude Desktop via .lnk shortcut parsing.
   * Uses JScript via cscript (same technique Codex uses in other contexts).
   */
  _readLnkTarget(lnkPath) {
    try {
      const tmpJs = path.join(os.tmpdir(), '_ds_readlnk.js');
      const safePath = lnkPath.replace(/'/g, "''");
      fs.writeFileSync(tmpJs,
        "var shell = new ActiveXObject('WScript.Shell');\n" +
        "var lnk = shell.CreateShortcut('" + safePath + "');\n" +
        "WScript.Echo(lnk.TargetPath);\n",
        'utf8'
      );
      try {
        const output = execSync('cscript //Nologo //E:jscript ' + tmpJs, {
          encoding: 'utf8', timeout: 3000, shell: 'cmd.exe', stdio: ['pipe', 'pipe', 'ignore']
        });
        const target = output.trim();
        if (target && fs.existsSync(target)) return path.resolve(target);
      } catch (e) {}
      try { fs.unlinkSync(tmpJs); } catch (e) {}
    } catch (e) {}
    return null;
  }

  _detectViaStartMenu() {
    const lnkPath = path.join(os.homedir(), 'AppData', 'Roaming',
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Claude.lnk');
    if (fs.existsSync(lnkPath)) {
      const target = this._readLnkTarget(lnkPath);
      if (target) return { path: target, source: 'start-menu' };
    }
    return null;
  }

  /**
   * Scan WindowsApps directories across drives.
   * Codex doesn't use this (they use Store packages), but it's a
   * useful fallback for non-Store installs.
   */
  _detectViaWindowsApps() {
    const drives = ['C:', 'D:', 'E:', 'F:', 'G:'];
    for (const drive of drives) {
      const wa = path.join(drive, 'WindowsApps');
      if (!fs.existsSync(wa)) continue;
      try {
        const dirs = fs.readdirSync(wa);
        for (const d of dirs) {
          if (d.startsWith('Claude_')) {
            const exe = path.join(wa, d, 'app', 'Claude.exe');
            if (fs.existsSync(exe)) {
              return {
                path: path.resolve(exe),
                source: 'windows-apps',
                version: d.replace('Claude_', '').replace(/_x64__.*$/, ''),
              };
            }
          }
        }
      } catch (e) {}
    }
    return null;
  }

  // ── Main Detection ────────────────────────────────────────────────────────

  findClaudePath() {
    // Strategy 0: Saved/configured path (most reliable)
    const saved = this.getManualPath();
    if (saved && fs.existsSync(saved)) {
      return { path: path.resolve(saved), source: 'saved' };
    }

    // Strategy 1: Environment variable override
    const customPath = process.env.CLAUDE_DESKTOP_PATH;
    if (customPath && fs.existsSync(customPath)) {
      return { path: path.resolve(customPath), source: 'env' };
    }

    // Strategy 2: Store package (Codex's primary method — most reliable)
    const storeResult = this._detectViaStorePackage();
    if (storeResult) return storeResult;

    // Strategy 3: Running process (fast)
    const runningResult = this._detectViaRunningProcess();
    if (runningResult) return runningResult;

    // Strategy 4: Start Menu shortcut
    const shortcutResult = this._detectViaStartMenu();
    if (shortcutResult) return shortcutResult;

    // Strategy 5: WindowsApps directory scan
    const waResult = this._detectViaWindowsApps();
    if (waResult) return waResult;

    return null;
  }

  /**
   * Find Claude Desktop's user data directory.
   */
  findUserDataDir() {
    const saved = this.getSavedUserDataDir();
    if (saved && fs.existsSync(saved)) return path.resolve(saved);

    // Check from running process command line
    try {
      const output = execSync(
        "wmic process where \"name='Claude.exe'\" get CommandLine /format:list",
        { encoding: 'utf8', timeout: 5000 }
      );
      const match = output.match(/--user-data-dir="([^"]+)"/);
      if (match && fs.existsSync(match[1])) return path.resolve(match[1]);
    } catch (e) {}

    // Common paths
    const candidates = [
      path.join(os.homedir(), 'AppData', 'Local', 'Claude-3p'),
      path.join('D:', 'Claude-3p'),
      path.join(os.homedir(), 'AppData', 'Local', 'Claude'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return path.resolve(dir);
    }

    return null;
  }

  // ── CDP Communication (Raw WebSocket, no dependency) ──────────────────────

  /**
   * Validate a CDP WebSocket URL — ensures it's a loopback endpoint
   * matching the expected browser identity. Inspired by Codex's
   * validatedDebuggerUrl().
   */
  _validateCdpUrl(url, port) {
    const parsed = new URL(url);
    const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
    const pathOk = /^\/devtools\/(?:page|browser)\/[A-Za-z0-9._-]{1,200}$/.test(parsed.pathname);

    if (parsed.protocol !== 'ws:' ||
        !LOOPBACK.has(parsed.hostname) ||
        Number(parsed.port) !== port ||
        parsed.username || parsed.password ||
        parsed.search || parsed.hash ||
        !pathOk) {
      throw new Error('Rejected CDP WebSocket URL outside allowed loopback shape');
    }
    return parsed.href;
  }

  /**
   * Check if Claude is already running with CDP on the given port.
   */
  isClaudeRunningWithCDP(port) {
    return new Promise(resolve => {
      this.isPortInUse(port).then(inUse => {
        if (!inUse) return resolve(false);

        const options = {
          hostname: '127.0.0.1',
          port: port,
          path: '/json/version',
          timeout: 3000,
        };

        http.get(options, res => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              const isElectron = data.Browser && data.Browser.includes('Electron');
              resolve(!!isElectron);
            } catch (e) {
              resolve(false);
            }
          });
        }).on('error', () => resolve(false));
      });
    });
  }

  /**
   * Wait for CDP endpoint to become available.
   */
  async waitForCDP(port, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const data = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 3000 }, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
              try { resolve(JSON.parse(body)); }
              catch (e) { reject(e); }
            });
          }).on('error', reject);
        });

        if (data.Browser && data.Browser.includes('Electron')) {
          return data;
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`CDP endpoint not available on port ${port} within ${timeout}ms`);
  }

  // ── Process Lifecycle ─────────────────────────────────────────────────────

  isPortInUse(port) {
    return new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(true));
      server.once('listening', () => {
        server.close();
        resolve(false);
      });
      server.listen(port, '127.0.0.1');
      setTimeout(() => {
        server.close();
        resolve(false);
      }, 500);
    });
  }

  async isRunning() {
    try {
      const output = execSync(
        'powershell -NoProfile -Command "Get-Process -Name Claude -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count"',
        { encoding: 'utf8', timeout: 5000, shell: 'cmd.exe', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return parseInt(output.trim()) > 0;
    } catch (e) {
      return false;
    }
  }

  killClaude() {
    try {
      // Try graceful first
      execSync('taskkill /F /IM Claude.exe 2>nul', { timeout: 5000, stdio: 'pipe' });
    } catch (e) {
      // Already not running or access denied
    }
    return new Promise(resolve => {
      let attempts = 0;
      const check = async () => {
        const running = await this.isRunning();
        if (!running || attempts > 30) resolve(!running);
        else { attempts++; setTimeout(check, 300); }
      };
      check();
    });
  }

  // ── Launch with CDP ───────────────────────────────────────────────────────

  async launchWithCDP(debugPort) {
    const port = debugPort || this.debugPort;

    // Lock: prevent concurrent launches
    if (this._launching) {
      console.log('[ProcessManager] Launch already in progress, waiting...');
      return new Promise((resolve, reject) => {
        const check = async () => {
          if (!this._launching) {
            try {
              const active = await this.isClaudeRunningWithCDP(port);
              if (active) return resolve({ launcher: 'existing', port });
            } catch (_) {}
            reject(new Error('Launch did not complete'));
          } else {
            setTimeout(check, 500);
          }
        };
        check();
      });
    }

    this._launching = true;
    try {
      // Check if CDP is already active
      const cdpActive = await this.isClaudeRunningWithCDP(port);
      if (cdpActive) {
        console.log('[ProcessManager] Claude already running with CDP on port ' + port);
        return { launcher: 'existing', port };
      }

      // Find Claude executable
      const info = this.findClaudePath();
      if (!info) {
        throw new Error('Claude Desktop not found. Please install it first.');
      }

      const exePath = info.path;
      const dataDir = this.findUserDataDir();

      // Save paths for future use
      this.saveManualPath(exePath);
      if (dataDir) this.saveUserDataDir(dataDir);

      // Update state (schema v2)
      this._saveState({
        schemaVersion: 2,
        port,
        browserId: null,
        claudeExe: exePath,
        userDataDir: dataDir,
        detectSource: info.source,
        packageFullName: info.packageFullName || null,
        packageFamilyName: info.packageFamilyName || null,
        signatureKind: info.signatureKind || null,
      });

      console.log('[ProcessManager] CDP not active. Need to restart Claude with --remote-debugging-port=' + port);
      console.log('[ProcessManager] Claude exe: ' + exePath);

      // Kill existing and relaunch
      console.log('[ProcessManager] Killing Claude to relaunch with CDP...');
      try {
        await this.killClaude();
      } catch (e) {
        console.warn('[ProcessManager] Kill warning:', e.message);
      }

      // Wait for processes to fully exit
      await new Promise(r => setTimeout(r, 2000));

      try {
        const args = ['--remote-debugging-port=' + port];
        if (dataDir) {
          args.push('--user-data-dir=' + dataDir);
        }

        if (info.appUserModelId) {
          // Store app: MUST use IApplicationActivationManager to pass args.
          // Direct EXE launch from WindowsApps silently drops command-line args.
          console.log('[ProcessManager] Store app detected, using COM activation');
          const psScript = path.join(__dirname, 'store-activate.ps1');
          execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -AppId "${info.appUserModelId}" -Arguments "${args.join(' ').replace(/"/g, '\\"')}"`,
            { encoding: 'utf8', timeout: 60000, shell: 'cmd.exe', stdio: ['pipe', 'pipe', 'pipe'] }
          );
        } else {
          // Regular install: cmd.exe /C start works fine
          const cmdLine = 'cmd.exe /C start "ClaudeCodeCDP" "' + exePath + '" ' + args.join(' ');
          exec(cmdLine, { windowsHide: true });
        }

        console.log('[ProcessManager] Launched Claude with CDP on port ' + port);

        // Wait for CDP to become available
        const version = await this.waitForCDP(port, 30000);
        console.log('[ProcessManager] CDP ready on port ' + port);

        // Update state with browser ID
        const browserId = this._extractBrowserId(version);
        this._saveState({
          ...this._state,
          browserId,
        });

        return { launcher: 'new', port, exePath };
      } catch (e) {
        console.error('[ProcessManager] Launch error:', e);
        throw e;
      }
    } finally {
      this._launching = false;
    }
  }
}

module.exports = new ProcessManager();
