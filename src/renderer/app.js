/**
 * Claude Code Dream Skin — Renderer Application
 *
 * Handles all UI interactions, theme management, CDP status display,
 * and IPC communication with the main process.
 */

// const { ipcRenderer } = require('electron'); // removed: use window.cds (contextBridge)
const cds = window.cds;

// ── State ──────────────────────────────────────────────────────────────────

let currentThemes = [];
let currentBackups = [];
let activeThemeName = null;
let toastTimer = null;

// ── i18n ────────────────────────────────────────────────────────────────────

function applyLocale(locale) {
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = window.__dreamSkinLocale?.t(key);
    if (translation) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = translation;
      } else {
        el.textContent = translation;
      }
    }
  });

  // Update document title
  const titleEl = document.querySelector('title[data-i18n]');
  if (titleEl) {
    const titleKey = titleEl.getAttribute('data-i18n');
    const titleT = window.__dreamSkinLocale?.t(titleKey);
    if (titleT) document.title = titleT;
  }

  // Update html lang attribute
  document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en';

  // Re-render theme cards to update button text
  renderThemeCards();
}

function initLanguageSwitcher() {
  const langBtns = document.querySelectorAll('.lang-btn');
  const currentLangLabel = document.getElementById('current-lang-label');

  langBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang;
      if (!lang) return;

      // Update active state
      langBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update label
      if (currentLangLabel) {
        const labelKey = lang === 'zh-CN' ? 'langZh' : 'langEn';
        currentLangLabel.textContent = window.__dreamSkinLocale?.t(labelKey) || lang;
      }

      // Save via IPC
      await cds.locale.set(lang);
      applyLocale(lang);
    });
  });
}

// ── Initialization ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initTitleBar();
  initTabs();
  initImport();
  initBackups();
  initSettings();
  initEventListeners();
  initLanguageSwitcher();

  // Apply current locale to UI
  const currentLocale = await cds.locale.get();
  applyLocale(currentLocale);

  // Update language label
  const langLabel = document.getElementById('current-lang-label');
  if (langLabel && window.__dreamSkinLocale) {
    const key = currentLocale === 'zh-CN' ? 'langZh' : 'langEn';
    langLabel.textContent = window.__dreamSkinLocale.t(key);
  }

  // Listen for events from main process
  cds.on('theme-changed', (data) => {
    activeThemeName = data.name;
    renderThemeCards();
    const msgKey = data.name ? 'toastApplied' : 'toastRestored';
    const msg = data.name
      ? `${window.__dreamSkinLocale?.t('toastApplied') || 'Theme applied'}: "${data.name}"`
      : window.__dreamSkinLocale?.t('toastRestored') || 'Restored to default';
    showToast(msg, 'success');
  });

  cds.on('injection-status', (status) => {
    updateInjectionStatus(status);
  });

  cds.on('claude-status-changed', (status) => {
    updateClaudeStatus(status);
  });

  cds.on('injection-event', (event) => {
    console.log('[Renderer] Injection event:', event);
  });

  cds.on('refresh-themes', () => {
    refreshThemeList();
  });

  cds.on('error', (error) => {
    showToast(error.message || 'An error occurred', 'error');
  });

  // Initial load
  await refreshThemeList();
  await populateBaseThemeDropdown();
  await checkInitialStatus();
});

// ── Title Bar ──────────────────────────────────────────────────────────────

function initTitleBar() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => cds.window.minimize());
  document.getElementById('btn-close')?.addEventListener('click', () => cds.window.close());
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${tab}`)?.classList.add('active');
    });
  });
}

// ── Status Bar ─────────────────────────────────────────────────────────────

async function checkInitialStatus() {
  const status = await cds.claude.status();
  updateClaudeStatus({ running: status.running });

  // Show Claude paths in settings
  const pathEl = document.getElementById('setting-claude-path');
  const dataDirEl = document.getElementById('setting-user-data-dir');
  if (pathEl && status.path) pathEl.textContent = status.path;
  if (dataDirEl && status.userDataDir) dataDirEl.textContent = status.userDataDir;
}

function updateClaudeStatus(status) {
  const dot = document.getElementById('claude-dot');
  const text = document.getElementById('claude-status-text');
  if (status.running) {
    dot.className = 'status-dot running';
    text.textContent = 'Claude Desktop: Running';
  } else {
    dot.className = 'status-dot';
    text.textContent = 'Claude Desktop: Not Running';
  }
}

function updateInjectionStatus(status) {
  const dot = document.getElementById('injection-dot');
  const text = document.getElementById('injection-status-text');

  if (status.error === 'restart-required') {
    dot.className = 'status-dot warning';
    text.textContent = 'Restart Claude with CDP';
  } else if (status.connected) {
    dot.className = 'status-dot connected';
    text.textContent = 'Theme: Active';
  } else if (status.injecting) {
    dot.className = 'status-dot warning';
    text.textContent = 'Connecting...';
  } else if (status.error) {
    dot.className = 'status-dot error';
    text.textContent = `Error: ${status.error}`;
  } else {
    dot.className = 'status-dot';
    text.textContent = 'Not connected';
  }
}

// ── Theme Cards ────────────────────────────────────────────────────────────

async function refreshThemeList() {
  try {
    currentThemes = await cds.themes.list();
    const active = await cds.themes.getActive();
    activeThemeName = active.name;
    renderThemeCards();
  } catch (e) {
    console.error('Failed to load themes:', e);
  }
}

function renderThemeCards() {
  const grid = document.getElementById('themes-grid');
  if (!grid) return;

  if (currentThemes.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">🎨</div>
        <div class="empty-state-text">No themes installed.<br>Import or create one to get started.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = currentThemes.map(theme => {
    const isActive = theme.name === activeThemeName;
    const previewEmoji = getPreviewEmoji(theme);
    const colorStyle = theme.colors
      ? `background: linear-gradient(135deg, ${theme.colors.bg || '#0d0d0f'}, ${theme.colors.surface || '#1a1a1f'})`
      : '';

    return `
      <div class="theme-card ${isActive ? 'active' : ''}">
        <div class="theme-card-preview" style="${colorStyle}">
          ${previewEmoji}
        </div>
        <div class="theme-card-name">${escapeHtml(theme.displayName || theme.name)}</div>
        <div class="theme-card-author">by ${escapeHtml(theme.author || 'Unknown')}</div>
        <div class="theme-card-badge ${isActive ? 'active-badge' : ''}">${isActive ? 'Active' : (theme.version || '1.0.0')}</div>
        <div class="theme-card-actions">
          <button class="theme-card-action-btn" onclick="window.applyTheme('${theme.name}')">Apply</button>
          <button class="theme-card-action-btn" onclick="window.uploadBg('${theme.name}')" title="Set background image">🖼</button>
          <button class="theme-card-action-btn danger" onclick="window.deleteTheme('${theme.name}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function getPreviewEmoji(theme) {
  const map = {
    'default': '🌅', 'midnight': '🌙', 'midnight-glass': '🌙',
    'forest': '🌲', 'forest-mist': '🌲',
    'sakura': '🌸', 'sakura-dream': '🌸',
    'gothic': '🖤', 'gothic-neon': '🖤',
    'tokyo': '🗼', 'tokyo-night': '🗼',
    'aurora': '🌌', 'sunset-blvd': '🌇',
    'ocean-deep': '🌊', 'catppuccin': '🍵',
    'dracula': '🧛', 'solarized-light': '☀️',
    'rose-pine': '🌹', 'cyberpunk': '⚡',
  };
  const name = (theme.name || '').toLowerCase();
  for (const [key, emoji] of Object.entries(map)) {
    if (name.includes(key)) return emoji;
  }
  return '🎨';
}

async function applyTheme(name) {
  try {
    const result = await cds.themes.activate(name);
    if (!result || result.error) {
      showToast('Failed to activate theme: ' + (result?.error || 'unknown'), 'error');
      return;
    }

    activeThemeName = name;
    renderThemeCards();

    // Inject via CDP if connected
    const injectStatus = await cds.inject.status();
    if (injectStatus.connected) {
      await cds.inject.refresh();
    }
  } catch (e) {
    showToast('Failed to apply theme', 'error');
    console.error(e);
  }
}

async function deleteTheme(name) {
  const result = await cds.themes.delete(name);
  if (result.error) {
    showToast(result.error, 'error');
  } else {
    showToast(`Theme "${name}" deleted`, 'success');
    await refreshThemeList();
  }
}

// Expose to inline onclick handlers
window.applyTheme = applyTheme;
window.uploadBg = async function(name) {
  try {
    const result = await cds.dialog.openFile({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || !result.filePaths.length) return;
    const r = await cds.themes.setBackground(name, result.filePaths[0]);
    if (r.ok) {
      showToast('Background image set!', 'success');
      await applyTheme(name);
    } else {
      showToast(r.error || 'Failed to set background', 'error');
    }
  } catch (e) {
    showToast('Failed to upload background', 'error');
  }
};
window.deleteTheme = deleteTheme;

// ── Import ─────────────────────────────────────────────────────────────────

function initImport() {
  const importArea = document.getElementById('import-area');
  const browseBtn = document.getElementById('btn-browse-theme');

  browseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openThemeFile();
  });

  importArea?.addEventListener('click', () => {
    openThemeFile();
  });

  importArea?.addEventListener('dragover', (e) => {
    e.preventDefault();
    importArea.classList.add('drag-over');
  });

  importArea?.addEventListener('dragleave', () => {
    importArea.classList.remove('drag-over');
  });

  importArea?.addEventListener('drop', async (e) => {
    e.preventDefault();
    importArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) await importThemeFile(file.path);
  });

  document.getElementById('btn-create-theme')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('new-theme-name');
    const baseSelect = document.getElementById('new-theme-base');
    const name = nameInput?.value?.trim();

    if (!name) {
      showToast('Please enter a theme name', 'error');
      return;
    }

    const result = await cds.themes.create(name, baseSelect?.value || null);
    if (result.ok) {
      nameInput.value = '';
      showToast(`Theme "${name}" created`, 'success');
      await refreshThemeList();
      await populateBaseThemeDropdown();
      document.querySelector('[data-tab="themes"]')?.click();
    } else {
      showToast(result.error, 'error');
    }
  });
}

async function openThemeFile() {
  try {
    const result = await cds.dialog.openFile({
      properties: ['openFile'],
      filters: [
        { name: 'Theme Files', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      await importThemeFile(result.filePaths[0]);
    }
  } catch (e) {
    showToast('Failed to open file dialog', 'error');
  }
}

async function importThemeFile(filePath) {
  try {
    const result = await cds.themes.install(filePath);
    if (result.ok) {
      showToast(`Theme "${result.displayName || result.name}" installed`, 'success');
      await refreshThemeList();
      await populateBaseThemeDropdown();
    } else {
      showToast(result.error, 'error');
    }
  } catch (e) {
    showToast('Failed to import theme', 'error');
    console.error(e);
  }
}

async function populateBaseThemeDropdown() {
  const themes = await cds.themes.list();
  const select = document.getElementById('new-theme-base');
  if (!select) return;
  select.innerHTML = '<option value="">Blank Theme</option>' +
    themes.map(t => `<option value="${t.name}">${t.displayName || t.name}</option>`).join('');
}

// ── Backups ────────────────────────────────────────────────────────────────

function initBackups() {
  document.getElementById('btn-create-backup')?.addEventListener('click', async () => {
    try {
      const result = await cds.backups.create();
      if (result.ok) {
        showToast(`Backup created`, 'success');
        await refreshBackups();
      } else {
        showToast(result.error, 'error');
      }
    } catch (e) {
      showToast('Failed to create backup', 'error');
    }
  });
}

async function refreshBackups() {
  try {
    currentBackups = await cds.backups.list();
    renderBackups();
  } catch (e) {
    console.error('Failed to load backups:', e);
  }
}

function renderBackups() {
  const list = document.getElementById('backups-list');
  if (!list) return;

  if (currentBackups.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <div class="empty-state-text">No backups yet.<br>Backups are created automatically when switching themes.</div>
      </div>
    `;
    return;
  }

  list.innerHTML = currentBackups.map(backup => `
    <div class="backup-item">
      <div class="backup-item-info">
        <span class="backup-item-name">${escapeHtml(backup.themeName || 'Unknown theme')}</span>
        <span class="backup-item-date">${backup.timestamp ? formatDate(backup.timestamp) : 'Unknown date'}</span>
      </div>
      <div class="backup-item-actions">
        <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="window.restoreBackup('${backup.name}')">Restore</button>
      </div>
    </div>
  `).join('');
}

async function restoreBackup(name) {
  try {
    const result = await cds.backups.restore(name);
    if (result.ok) {
      activeThemeName = null;
      showToast('Backup restored successfully', 'success');
      await refreshThemeList();
    } else {
      showToast(result.error, 'error');
    }
  } catch (e) {
    showToast('Failed to restore backup', 'error');
  }
}

window.restoreBackup = restoreBackup;

// ── Settings ───────────────────────────────────────────────────────────────

function initSettings() {
  document.getElementById('btn-launch-cdp')?.addEventListener('click', async () => {
    showToast('Restarting Claude Desktop with CDP...', 'info');
    try {
      await cds.claude.restartWithCDP();
    } catch (e) {
      showToast('Failed to restart Claude', 'error');
    }
  });

  document.getElementById('btn-refresh-injection')?.addEventListener('click', async () => {
    try {
      await cds.inject.refresh();
      showToast('Theme refreshed', 'success');
    } catch (e) {
      showToast('Failed to refresh', 'error');
    }
  });

  document.getElementById('btn-restore-default')?.addEventListener('click', async () => {
    try {
      await cds.backups.create();
      // Go to backups tab where user can restore or use the restore default flow
      document.querySelector('[data-tab="backups"]')?.click();
      showToast('Backup created. Use Restore to revert.', 'info');
    } catch (e) {
      showToast('Failed', 'error');
    }
  });
}

// ── Event Listeners ────────────────────────────────────────────────────────

function initEventListeners() {
  document.getElementById('btn-refresh-themes')?.addEventListener('click', async () => {
    await refreshThemeList();
    await refreshBackups();
    await populateBaseThemeDropdown();
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const messageEl = document.getElementById('toast-message');
  const iconEl = toast?.querySelector('.toast-icon');

  if (!toast || !messageEl) return;

  messageEl.textContent = message;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  if (iconEl) iconEl.textContent = icons[type] || icons.info;

  toast.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return iso;
  }
}
