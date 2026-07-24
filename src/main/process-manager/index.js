const { execSync, exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');

/**
 * Detects Claude Desktop installation path and manages the process lifecycle.
 *
 * Claude Desktop on Windows is installed as an MSIX package:
 *   C:\Program Files\WindowsApps\Claude_<version>_x64__<publisherId>\app\Claude.exe
 *
 * We cannot modify the MSIX installation. Instead, we relaunch Claude
 * with --remote-debugging-port=9222 to enable CDP-based theme injection.
 */
class ProcessManager {
  constructor() {
    this.debugPort = parseInt(process.env.DREAM_SKIN_DEBUG_PORT || '9222');
    this.claudePath = null;
    this.claudePid = null;
    this.userDataDir = null;
  }

  /**
   * Find Claude Desktop installation path.
   * Priority:
   *   1. Explicit path from environment/registry
   *   2. WindowsApps directory scan
   *   3. Known common paths
   */
  findClaudePath() {
    // Check if user configured a custom path
    const customPath = process.env.CLAUDE_DESKTOP_PATH;
    if (customPath && fs.existsSync(customPath)) {
      return { path: customPath, source: 'custom' };
    }

    // Scan WindowsApps for Claude MSIX
    const windowsApps = path.join('C:', 'Program Files', 'WindowsApps');
    if (fs.existsSync(windowsApps)) {
      try {
        const dirs = fs.readdirSync(windowsApps);
        const claudeDir = dirs.find(d => d.startsWith('Claude_') && d.endsWith('.exe') === false && fs.existsSync(path.join(windowsApps, d, 'app', 'Claude.exe')));
        // Also check for the correct pattern
        for (const d of dirs) {
          if (d.startsWith('Claude_')) {
            const exePath = path.join(windowsApps, d, 'app', 'Claude.exe');
            if (fs.existsSync(exePath)) {
              return {
                path: exePath,
                source: 'windows-apps',
                version: d.replace('Claude_', '').replace('_x64__pzs8sxrjxfjjc', '')
              };
            }
          }
        }
      } catch (e) {
        // Permission error reading WindowsApps - try WMIC
      }
    }

    // Fallback: use WMIC to find it
    try {
      const output = execSync(
        'wmic process where "name=\'Claude.exe\'" get ExecutablePath /format:list',
        { encoding: 'utf8', timeout: 5000 }
      );
      const match = output.match(/ExecutablePath\s*=\s*(.+)/);
      if (match && fs.existsSync(match[1].trim())) {
        return { path: match[1].trim(), source: 'wmic' };
      }
    } catch (e) {
      // WMIC failed
    }

    return null;
  }

  /**
   * Find Claude Desktop user data directory.
   */
  findUserDataDir() {
    // Try localappdata\Claude-3p (standard for the Store/MSIX version)
    const claude3p = path.join(os.homedir(), 'AppData', 'Local', 'Claude-3p');
    if (fs.existsSync(claude3p)) {
      return claude3p;
    }

    // Try wmic for user-data-dir
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
   * Find the PID of the main Claude Desktop process (not helper processes).
   */
  findClaudePid() {
    try {
      // Use WMIC to get processes with their command lines
      const output = execSync(
        'wmic process where "name=\'Claude.exe\'" get ProcessId,CommandLine /format:csv',
        { encoding: 'utf8', timeout: 5000 }
      );
      const lines = output.trim().split('\n').slice(1); // skip header
      for (const line of lines) {
        const parts = line.trim().split(',');
        if (parts.length >= 3 && parts[2]) {
          const cmdline = parts.slice(2).join(',').trim();
          // Main process has --app-path argument and --type=renderer or no --type
          if (!cmdline.includes('--type=') || cmdline.includes('--type=renderer')) {
            const pid = parseInt(parts[1]);
            if (!isNaN(pid)) {
              return pid;
            }
          }
        }
      }
      // Fallback: return first PID
      const firstMatch = lines[0]?.trim().split(',');
      if (firstMatch && firstMatch[1]) {
        return parseInt(firstMatch[1]);
      }
    } catch (e) {
      // Ignore
    }
    return null;
  }

  /**
   * Kill Claude Desktop by process name.
   */
  killClaude() {
    try {
      execSync('taskkill /F /IM Claude.exe 2>nul', { timeout: 5000, stdio: 'pipe' });
      // Wait for process to fully terminate
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
   *
   * On Windows, we use cmd.exe /C start to launch so the process
   * becomes independent of our Node process.
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

      // Check if port is already in use (another instance with CDP already running)
      this.isPortInUse(port).then(inUse => {
        if (inUse) {
          console.log(`[ProcessManager] CDP port ${port} already in use, connecting to existing instance`);
          return resolve({ launcher: 'existing', port });
        }

        // Kill existing Claude processes
        console.log('[ProcessManager] Stopping existing Claude Desktop...');
        this.killClaude().then(() => {
          // Small delay after killing
          setTimeout(() => {
            try {
              const args = [`--remote-debugging-port=${port}`];
              if (dataDir) {
                args.push(`--user-data-dir="${dataDir}"`);
              }

              // Launch via shell so the app can interact with Windows shell
              const shell = os.platform() === 'win32' ? 'cmd.exe' : '';
              const shellArgs = os.platform() === 'win32'
                ? ['/C', 'start', '"ClaudeCodeCDP"', exePath, ...args]
                : args;

              exec(shell, { args: shellArgs }, (error) => {
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
          http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 2000 }, (res) => {
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

    throw new Error(`CDP endpoint not available on port ${port} within ${timeout}ms`);
  }
}

module.exports = new ProcessManager();
