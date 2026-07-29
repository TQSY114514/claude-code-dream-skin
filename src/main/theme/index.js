const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_ROOT = path.join(os.homedir(), '.claude-dream-skin');
const ROOT = process.env.DREAM_SKIN_TEST_ROOT || DEFAULT_ROOT;
const THEMES_DIR = path.join(ROOT, 'themes');
const ACTIVE_DIR = path.join(THEMES_DIR, 'active');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DEFAULT_THEME_NAME = 'default';

// Built-in themes bundled with the app
const BUILTIN_THEMES = path.join(__dirname, '..', '..', '..', 'themes');

class ThemeEngine {
  constructor() {
    this.ensureDirs();
    this.syncBuiltinThemes();
    this.activeThemeName = this.loadActiveThemeName();
  }

  ensureDirs() {
    [ROOT, THEMES_DIR, ACTIVE_DIR, BACKUP_DIR].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  /**
   * Copy built-in themes from the project's themes/ directory to the user's
   * ~/.claude-dream-skin/themes/ directory if they don't already exist.
   */
  syncBuiltinThemes() {
    if (!fs.existsSync(BUILTIN_THEMES)) return;
    try {
      const builtinDirs = fs.readdirSync(BUILTIN_THEMES).filter(f => {
        const p = path.join(BUILTIN_THEMES, f);
        return fs.statSync(p).isDirectory();
      });
      for (const dir of builtinDirs) {
        const dest = path.join(THEMES_DIR, dir);
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true });
          this.copyDir(path.join(BUILTIN_THEMES, dir), dest);
        }
      }
    } catch (e) {
      console.warn('[ThemeEngine] Failed to sync built-in themes:', e.message);
    }
  }

  listThemes() {
    if (!fs.existsSync(THEMES_DIR)) return [];
    return fs.readdirSync(THEMES_DIR)
      .filter(name => {
        const themePath = path.join(THEMES_DIR, name);
        return fs.statSync(themePath).isDirectory() && name !== 'active';
      })
      .map(name => this.loadThemeMeta(name))
      .filter(Boolean);
  }

  loadThemeMeta(name) {
    const metaPath = path.join(THEMES_DIR, name, 'theme.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      // `name` (directory/id) MUST NOT be overwritten by meta.name (display name).
      // Frontend uses theme.name as the directory key for activate/delete/uploadBg.
      return { ...meta, name, displayName: meta.name };
    } catch (e) {
      return { name, error: 'Invalid theme.json' };
    }
  }

  setBackgroundImage(name, imagePath) {
    const themeDir = path.join(THEMES_DIR, name);
    if (!fs.existsSync(themeDir)) {
      return { ok: false, error: `Theme "${name}" not found` };
    }

    try {
      const artDir = path.join(themeDir, 'art');
      if (!fs.existsSync(artDir)) fs.mkdirSync(artDir, { recursive: true });

      // Clean old art files
      for (const f of fs.readdirSync(artDir)) {
        fs.unlinkSync(path.join(artDir, f));
      }

      // Copy new image (limit size to 10MB)
      const stats = fs.statSync(imagePath);
      if (stats.size > 10 * 1024 * 1024) {
        return { ok: false, error: 'Image too large (max 10MB)' };
      }

      const ext = path.extname(imagePath).toLowerCase();
      const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
      if (!allowed.includes(ext)) {
        return { ok: false, error: 'Unsupported format. Use PNG, JPG, or WebP' };
      }

      const destName = `background${ext}`;
      fs.copyFileSync(imagePath, path.join(artDir, destName));

      return { ok: true, path: path.join(artDir, destName) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  removeBackgroundImage(name) {
    const themeDir = path.join(THEMES_DIR, name);
    if (!fs.existsSync(themeDir)) return { ok: false, error: 'Theme not found' };

    const artDir = path.join(themeDir, 'art');
    if (!fs.existsSync(artDir)) return { ok: true };

    try {
      for (const f of fs.readdirSync(artDir)) {
        fs.unlinkSync(path.join(artDir, f));
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  loadTheme(name) {
    const themeDir = path.join(THEMES_DIR, name);
    if (!fs.existsSync(themeDir)) return null;

    const meta = this.loadThemeMeta(name);
    const cssPath = path.join(themeDir, 'style.css');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

    let backgroundBase64 = null;
    const artDir = path.join(themeDir, 'art');
    if (fs.existsSync(artDir)) {
      const imgs = fs.readdirSync(artDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
      if (imgs.length > 0) {
        const imgPath = path.join(artDir, imgs[0]);
        const buf = fs.readFileSync(imgPath);
        const ext = path.extname(imgs[0]).toLowerCase();
        const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[ext] || 'image/png';
        backgroundBase64 = `data:${mime};base64,${buf.toString('base64')}`;
      }
    }

    return { name, meta, css, backgroundBase64, dynamic: meta.dynamic || null, style: meta.style || 'default' };
  }

  getActiveTheme() {
    const cssPath = path.join(ACTIVE_DIR, 'style.css');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

    let backgroundBase64 = null;
    const artDir = path.join(ACTIVE_DIR, 'art');
    if (fs.existsSync(artDir)) {
      const imgs = fs.readdirSync(artDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
      if (imgs.length > 0) {
        const imgPath = path.join(artDir, imgs[0]);
        const buf = fs.readFileSync(imgPath);
        const ext = path.extname(imgs[0]).toLowerCase();
        const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[ext] || 'image/png';
        backgroundBase64 = `data:${mime};base64,${buf.toString('base64')}`;
      }
    }

    // Load meta from active theme.json
    let dynamic = null, style = 'default';
    const metaPath = path.join(ACTIVE_DIR, 'theme.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        dynamic = meta.dynamic || null;
        style = meta.style || 'default';
      } catch (_) {}
    }

    return { name: this.activeThemeName, css, backgroundBase64, dynamic, style };
  }

  activateTheme(name) {
    const sourceDir = path.join(THEMES_DIR, name);
    if (!fs.existsSync(sourceDir)) {
      return { ok: false, error: `Theme "${name}" not found` };
    }

    try {
      this.backupCurrentTheme();
      this.clearDirectory(ACTIVE_DIR);
      this.copyDir(sourceDir, ACTIVE_DIR);
      fs.writeFileSync(path.join(ACTIVE_DIR, '.theme-name'), name);
      this.activeThemeName = name;
      fs.writeFileSync(path.join(ROOT, 'active-theme'), name);
      return { ok: true, name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  installTheme(sourcePath) {
    try {
      let themeDir = sourcePath;

      if (sourcePath.endsWith('.zip')) {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(sourcePath);
        const extractDir = path.join(THEMES_DIR, '_import_' + Date.now());
        zip.extractAllTo(extractDir, true);

        const entries = fs.readdirSync(extractDir);
        if (entries.includes('theme.json')) {
          themeDir = extractDir;
        } else {
          const nested = entries.find(e => {
            const p = path.join(extractDir, e);
            return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'theme.json'));
          });
          if (nested) {
            themeDir = path.join(extractDir, nested);
          } else {
            throw new Error('No theme.json found in archive');
          }
        }
      }

      const metaPath = path.join(themeDir, 'theme.json');
      if (!fs.existsSync(metaPath)) {
        throw new Error('theme.json not found in theme directory');
      }

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const themeName = meta.name
        .toLowerCase()
        .replace(/[^a-z0-9一-鿿]+/g, '-')
        .replace(/^-|-$/g, '');

      const destDir = path.join(THEMES_DIR, themeName);

      if (fs.existsSync(destDir)) {
        return { ok: false, error: `Theme "${meta.name}" already installed` };
      }

      fs.mkdirSync(destDir, { recursive: true });
      this.copyDir(themeDir, destDir);

      return { ok: true, name: themeName, displayName: meta.name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  deleteTheme(name) {
    if (name === DEFAULT_THEME_NAME) {
      return { ok: false, error: 'Cannot delete the default theme' };
    }
    if (name === this.activeThemeName) {
      return { ok: false, error: 'Cannot delete the currently active theme' };
    }

    const themeDir = path.join(THEMES_DIR, name);
    if (!fs.existsSync(themeDir)) {
      return { ok: false, error: 'Theme not found' };
    }

    try {
      this.clearDirectory(themeDir);
      fs.rmdirSync(themeDir);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  createTheme(name, baseTheme = null) {
    const safeName = name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '');
    const destDir = path.join(THEMES_DIR, safeName);

    if (fs.existsSync(destDir)) {
      return { ok: false, error: `Theme "${name}" already exists` };
    }

    try {
      fs.mkdirSync(destDir, { recursive: true });

      if (baseTheme) {
        const sourceDir = path.join(THEMES_DIR, baseTheme);
        if (fs.existsSync(sourceDir)) {
          this.copyDir(sourceDir, destDir);
          const metaPath = path.join(destDir, 'theme.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          meta.name = name;
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        }
      } else {
        fs.writeFileSync(
          path.join(destDir, 'theme.json'),
          JSON.stringify({
            name, author: '', version: '1.0.0', description: '',
            colors: { accent: '#FF6B35', bg: '#0a0a0f', surface: '#141419', text: '#e8e8ec', muted: '#6e6e80' }
          }, null, 2)
        );
        fs.writeFileSync(path.join(destDir, 'style.css'), this.getDefaultCSS());
      }

      return { ok: true, name: safeName };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  getInjectionCSS(themeCSS, backgroundBase64) {
    // Returns only theme-specific CSS variable overrides.
    // The full skin CSS is loaded by the CDP injector from runtime/.
    return themeCSS || '';
  }

  backupCurrentTheme() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `${timestamp}_${this.activeThemeName || 'unknown'}`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    try {
      fs.mkdirSync(backupPath, { recursive: true });
      if (fs.existsSync(ACTIVE_DIR)) {
        for (const item of fs.readdirSync(ACTIVE_DIR)) {
          const src = path.join(ACTIVE_DIR, item);
          const dst = path.join(backupPath, item);
          if (fs.statSync(src).isDirectory()) {
            fs.mkdirSync(dst, { recursive: true });
            this.copyDir(src, dst);
          } else {
            fs.copyFileSync(src, dst);
          }
        }
      }
      fs.writeFileSync(path.join(backupPath, 'backup.json'),
        JSON.stringify({ timestamp, themeName: this.activeThemeName, claudeVersion: '1.24012.1' }, null, 2));
      this.pruneBackups(10);
      return { ok: true, backupName };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(name => fs.statSync(path.join(BACKUP_DIR, name)).isDirectory())
      .sort()
      .reverse()
      .map(name => {
        const metaPath = path.join(BACKUP_DIR, name, 'backup.json');
        let meta = {};
        if (fs.existsSync(metaPath)) {
          try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) {}
        }
        return { name, ...meta };
      });
  }

  restoreFromBackup(backupName) {
    const backupPath = path.join(BACKUP_DIR, backupName);
    if (!fs.existsSync(backupPath)) {
      return { ok: false, error: 'Backup not found' };
    }

    try {
      this.clearDirectory(ACTIVE_DIR);
      const files = fs.readdirSync(backupPath).filter(f => f !== 'backup.json');
      for (const item of files) {
        const src = path.join(backupPath, item);
        const dst = path.join(ACTIVE_DIR, item);
        if (fs.statSync(src).isDirectory()) {
          fs.mkdirSync(dst, { recursive: true });
          this.copyDir(src, dst);
        } else {
          fs.copyFileSync(src, dst);
        }
      }

      const metaPath = path.join(backupPath, 'backup.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.themeName) {
          this.activeThemeName = meta.themeName;
          fs.writeFileSync(path.join(ACTIVE_DIR, '.theme-name'), meta.themeName);
          fs.writeFileSync(path.join(ROOT, 'active-theme'), meta.themeName);
        }
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  restoreDefault() {
    try {
      this.backupCurrentTheme();
      this.clearDirectory(ACTIVE_DIR);
      this.activeThemeName = null;
      if (fs.existsSync(path.join(ROOT, 'active-theme'))) {
        fs.unlinkSync(path.join(ROOT, 'active-theme'));
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  exportTheme(name, outputPath) {
    const themeDir = path.join(THEMES_DIR, name);
    if (!fs.existsSync(themeDir)) {
      return { ok: false, error: 'Theme not found' };
    }

    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();

      const addDir = (dir, zipPath) => {
        for (const entry of fs.readdirSync(dir)) {
          const fullPath = path.join(dir, entry);
          const zipEntryPath = path.join(zipPath, entry);
          if (fs.statSync(fullPath).isDirectory()) {
            addDir(fullPath, zipEntryPath);
          } else {
            zip.addLocalFile(fullPath, path.dirname(zipEntryPath), path.basename(zipEntryPath));
          }
        }
      };

      addDir(themeDir, '');
      zip.writeZip(outputPath);
      return { ok: true, path: outputPath };
    } catch (e) {
      return { ok: false, error: `Export failed: ${e.message}` };
    }
  }

  loadActiveThemeName() {
    try {
      const marker = fs.readFileSync(path.join(ROOT, 'active-theme'), 'utf8').trim();
      if (marker && fs.existsSync(path.join(THEMES_DIR, marker))) return marker;
    } catch (e) { /* ignore */ }
    return null;
  }

  clearDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        this.clearDirectory(fullPath);
        fs.rmdirSync(fullPath);
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  }

  copyDir(src, dst) {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dstPath, { recursive: true });
        this.copyDir(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  pruneBackups(keep) {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(n => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory())
      .sort();
    while (backups.length > keep) {
      const oldest = backups.shift();
      this.clearDirectory(path.join(BACKUP_DIR, oldest));
      fs.rmdirSync(path.join(BACKUP_DIR, oldest));
    }
  }

  getDefaultCSS() {
    return `/* Claude Code Dream Skin - Default Theme */

:root {
  --ds-bg: #0d0d0f;
  --ds-panel: #141417;
  --ds-surface: #1a1a1f;
  --ds-text: #e8e8ec;
  --ds-muted: #6e6e80;
  --ds-accent: #FF6B35;
  --ds-border: rgba(255, 255, 255, 0.06);
  --ds-radius: 8px;
  --ds-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --ds-line-height: 1.6;
}
`;
  }
}

module.exports = new ThemeEngine();
