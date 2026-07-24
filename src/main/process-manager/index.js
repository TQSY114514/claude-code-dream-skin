const { execSync, exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');

/**
 * Detects Claude Desktop installation path and manages the process lifecycle.
 *
 * Uses multiple strategies to find Claude Desktop:
 *   1. Environment variable (CLAUDE_DESKTOP_PATH)
 *   2. Running process via WMIC
 *   3. Windows Registry uninstall entries
 *   4. Start Menu .lnk shortcut
 *   5. PowerShell Get-StartApps
 *   6. WindowsApps directory scan across drives
 */
class ProcessManager {
  constructor() {
    this.debugPort = parseInt(process.env.DREAM_SKIN_DEBUG_PORT || '9222');
    this.claudePath = null;
    this.claudePid = null;
    this.userDataDir = null;
  }

  /**
   * Read target path from a Windows .lnk shortcut.
   */
  _readLnkTarget(lnkPath) {
    try {
      const tmpJs = path.join(os.tmpdir(), '_ds_readlnk.js');
      const safePath = lnkPath.replace(/'/g, "''");
      fs.writeFileSync(tmpJs,
        "var shell = new ActiveXObject('WScript.Shell');\n" +
        "var lnk = shell.CreateShortcut('" + safePath + "');\n" +
        "WScript.Echo(lnk.TargetPath);\n"
      );
      try {
        const output = execSync('cscript //Nologo //E:jscript ' + tmpJs, {
          encoding: 'utf8', timeout: 3000, shell: 'cmd.exe', stdio: ['pipe', 'pipe', 'ignore']
        });
        const target = output.trim();
        if (target && fs.existsSync(target)) return target;
      } catch (e) {}
      try { fs.unlinkSync(tmpJs); } catch (e) {}
    } catch (e) {}
    return null;
  }

  /**
   * Find Claude Desktop installation path.
   * Tries multiple strategies in order of speed.
   */
  findClaudePath() {
    // Strategy 1: Environment variable override
    const customPath = process.env.CLAUDE_DESKTOP_PATH;
    if (customPath && fs.existsSync(customPath)) {
      return { path: customPath, source: 'custom' };
    }

    // Strategy 2: WMIC - check running process (fastest if Claude is running)
    try {
      const output = execSync(
        'wmic process where "name=\'Claude.exe\'" get ExecutablePath /format:list',
        { encoding: 'utf8', timeout: 3000 }
      );
      const match = output.match(/ExecutablePath\s*=\s*(.+)/);
      if (match && fs.existsSync(match[1].trim())) {
        return { path: match[1].trim(), source: 'running-process' };
      }
    } catch (e) {
      // Not running or WMIC not available
    }

    // Strategy 3: Windows Registry - uninstall entries
    try {
      const output = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /f "Claude" /reg:64',
        { encoding: 'utf8', timeout: 5000, shell: 'cmd.exe' }
      );
      const lines = output.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (/^(InstallLocation|DisplayIcon)/.test(trimmed)) {
          const parts = trimmed.split(/\s{2,}/);
          const val = parts[1];
          if (!val) continue;
          let candidate = val;
          if (!candidate.endsWith('.exe')) {
            candidate = path.join(candidate, 'app', 'Claude.exe');
          }
          if (fs.existsSync(candidate)) {
            return { path: candidate, source: 'registry' };
          }
        }
      }
    } catch (e) {
      // Registry not available
    }

    // Strategy 4: Start Menu shortcut (works even if app is not running)
    try {
      const lnkPath = path.join(os.homedir(), 'AppData', 'Roaming',
        'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Claude.lnk');
      if (fs.existsSync(lnkPath)) {
        const target = this._readLnkTarget(lnkPath);
        if (target && fs.existsSync(target)) {
          return { path: target, source: 'shortcut' };
        }
      }
    } catch (e) {
      // Shortcut parsing failed
    }

    // Strategy 5: PowerShell Get-StartApps
    try {
      const output = execSync(
        'powershell -NoProfile -Command "Get-StartApps -Name *Claude* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty InstallLocation"',
        { encoding: 'utf8', timeout: 8000, shell: 'cmd.exe' }
      );
      const loc = output.trim();
      if (loc && fs.existsSync(loc)) {
        const exe = path.join(loc, 'app', 'Claude.exe');
        if (fs.existsSync(exe)) {
          return { path: exe, source: 'shell-apps' };
        }
      }
    } catch (e) {
      // PowerShell not available
    }

    // Strategy 6: Scan WindowsApps across all drives
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
                path: exe,
                source: 'windows-apps',
                version: d.replace('Claude_', '').replace(/_x64__.*$/, '')
              };
            }
          }
        }
      } catch (e) {
        // Permission denied on this drive
      }
    }

    return null;
  }

  /**
   * Find Claude Desktop user data directory.
   */
  findUserDataDir() {
    const candidates = [
      path.join(os.homedir(), 'AppData', 'Local', 'Claude-3p'),
      path.join('D:', 'Claude-3p'),
      path.join(os.homedir(), 'AppData', 'Local', 'Claude'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }

    // Try WMIC to extract from running process command line
    try {
      const output = execSync(
        'wmic process where "name=\'Claude.exe\'" get CommandLine /format:list',
        { encoding: 'utf8', timeout: 5000 }
      );
      const match = output.match(/--user-data-dir="([^"]+)"/);
      if (match && fs.existsSync(match[1])) {
        return match[1];
      }
    } catch (e) {
      // Ignore
    }

    return null;
  }

  /**
   * Check if a port is in use.
   */
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

  /**
   * Check if Claude Desktop is currently running.
   */
  async isRunning() {
    try {
      const output = execSync('tasklist /FI "IMAGENAME eq Claude.exe" /FO CSV /NH', {
        encoding: 'utf8',
        timeout: 3000
      });
      return output.includes('Claude.exe');
    } catch (e) {
      return false;
    }
  }

  /**
   * Find the PID of the main Claude Desktop process.
   */
  findClaudePid() {
    try {
      const output = execSync(
        'wmic process where "name=\'Claude.exe\'" get ProcessId,CommandLine /format:csv',
        { encoding: 'utf8', timeout: 5000 }
      );
      const lines = output.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(',');
        if (parts.length >= 3 && parts[2]) {
          const cmdline = parts.slice(2).join(',').trim();
          if (!cmdline.includes('--type=') || cmdline.includes('--type=renderer')) {
            const pid = parseInt(parts[1]);
            if (!isNaN(pid)) return pid;
          }
        }
      }
      const firstMatch = lines[0]?.trim().split(',');
      if (firstMatch && firstMatch[1]) {
        return parseInt(firstMatch[1]);
      }
    } catch (e) {}
    return null;
  }

  /**
   * Kill Claude Desktop by process name.
   */
  killClaude() {
    try {
      execSync('taskkill /F /IM Claude.exe 2>nul', { timeout: 5000, stdio: 'pipe' });
      return new Promise(resolve => {
        let attempts = 0;
        const check = () => {
          this.isRunning().then(running => {
            if (!running || attempts > 20) resolve(!running);
            else { attempts++; setTimeout(check, 300); }
          });
        };
        check();
      });
    } catch (e) {
      return Promise.resolve(true);
    }
  }

  /**
   * Launch Claude Desktop with --remote-debugging-port.
   */
  launchWithCDP(debugPort) {
    return new Promise((resolve, reject) => {
      const port = debugPort || this.debugPort;
      const info = this.findClaudePath();

      if (!info) {
        return reject(new Error('Claude Desktop not found. Please install it first.'));
      }

      const exePath = info.path;
      const dataDir = this.findUserDataDir();

      this.isPortInUse(port).then(inUse => {
        if (inUse) {
          console.log(`[ProcessManager] CDP port ${port} already in use, connecting to existing instance`);
          return resolve({ launcher: 'existing', port });
        }

        console.log('[ProcessManager] Stopping existing Claude Desktop...');
        this.killClaude().then(() => {
          setTimeout(() => {
            try {
              const args = ['--remote-debugging-port=' + port];
              if (dataDir) {
                args.push('--user-data-dir="' + dataDir + '"');
              }

              // Build a single command string for exec()
              const cmdLine = 'cmd.exe /C start "ClaudeCodeCDP" "' + exePath + '" ' + args.join(' ');

              exec(cmdLine, { windowsHide: true }, (error) => {
                if (error) {
                  console.error('[ProcessManager] Launch error:', error);
                  return reject(error);
                }
                console.log(`[ProcessManager] Launched Claude with CDP on port ${port}`);
                resolve({ launcher: 'new', port, exePath });
              });
            } catch (e) {
              reject(e);
            }
          }, 2000);
        });
      });
    });
  }

  /**
   * Wait for the CDP endpoint to become available.
   */
  async waitForCDP(port, timeout = 15000) {
    const start = Date.now();
    const http = require('http');

    while (Date.now() - start < timeout) {
      try {
        const data = await new Promise((resolve, reject) => {
          http.get('http://127.0.0.1:' + port + '/json/version', { timeout: 2000 }, (res) => {
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
      } catch (e) {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 500));
    }

    throw new Error('CDP endpoint not available on port ' + port + ' within ' + timeout + 'ms');
  }
}

module.exports = new ProcessManager();
