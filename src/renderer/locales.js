/**
 * Claude Code Dream Skin — Renderer i18n
 *
 * Provides translation strings for the renderer UI.
 * Used by app.js to update DOM text content based on selected locale.
 */

const RENDERER_I18N = {
  'zh-CN': {
    appTitle: 'Claude Code Dream Skin',
    version: 'v0.1.0',

    tabThemes: '主题',
    tabImport: '导入',
    tabBackups: '备份',
    tabSettings: '设置',

    themesTitle: '主题',
    themesSubtitle: '选择主题应用到 Claude Desktop',
    refreshBtn: '↻ 刷新',
    restoreBtn: '⟲ 恢复默认',

    importTitle: '导入主题',
    importSubtitle: '从 .zip 文件或文件夹安装主题',
    dropText: '拖放 .zip 主题包到此处，或点击选择文件',
    browseBtn: '浏览文件',

    createTitle: '创建新主题',
    createNameLabel: '主题名称',
    createNamePlaceholder: '我的自定义主题',
    createBaseLabel: '基础主题（可选）',
    createBlank: '空白主题',
    createBtn: '创建主题',
    createDialogTitle: '创建新主题',
    createDialogPrompt: '输入主题名称：',
    nameRequired: '请输入主题名称',
    themeExists: '主题已存在',

    backupsTitle: '备份',
    backupsSubtitle: '恢复到之前的主题状态',
    createBackupBtn: '立即备份',
    noBackups: '暂无备份',
    backupDate: '备份时间',
    backupTheme: '主题',
    restoreBtn2: '恢复',

    settingsTitle: '设置',
    settingsSubtitle: '配置 Dream Skin 行为',
    launchCdpLabel: '带 CDP 启动',
    launchCdpDesc: '以远程调试端口重启 Claude Desktop',
    launchCdpBtn: '启动 Claude + CDP',
    refreshInjectLabel: '刷新注入',
    refreshInjectDesc: '重新应用当前主题到 Claude Desktop',
    refreshInjectBtn: '刷新',
    claudePathLabel: 'Claude Desktop 路径',
    claudePathDesc: '自动检测',
    userDataLabel: '用户数据目录',
    userDataDesc: '自动检测',

    langLabel: '语言',
    langZh: '简体中文',
    langEn: 'English',
    themeDirLabel: '主题目录',
    openDirBtn: '打开目录',
    aboutLabel: '关于',

    statusClaude: 'Claude',
    statusInjection: '注入状态',
    checking: '检测中...',
    connected: '已连接',
    notConnected: '未连接',
    injecting: '注入中...',

    activeTag: '当前使用',
    apply: '应用',
    delete: '删除',
    export: '导出',
    uploadBg: '上传背景',
    removeBg: '移除背景',
    noBg: '暂无背景图',

    confirmDelete: '确定删除此主题？此操作不可撤销。',
    confirmRestore: '确定恢复默认外观？当前主题将自动备份。',
    toastApplied: '主题已应用',
    toastRestored: '已恢复默认外观',
    toastError: '发生错误',

    toastBgUploaded: '背景图已上传',
    toastBgRemoved: '背景图已移除',
    toastCreated: '主题创建成功',
    toastDeleted: '主题已删除',
    toastRestoredOk: '已恢复默认外观',
    toastImported: '主题导入成功',
    toastCreateFailed: '创建失败',
    toastDeleteFailed: '删除失败',
    toastImportFailed: '导入失败',
  },

  en: {
    appTitle: 'Claude Code Dream Skin',
    version: 'v0.1.0',

    tabThemes: 'Themes',
    tabImport: 'Import',
    tabBackups: 'Backups',
    tabSettings: 'Settings',

    themesTitle: 'Themes',
    themesSubtitle: 'Select a theme to apply to Claude Desktop',
    refreshBtn: '↻ Refresh',
    restoreBtn: '⟲ Restore Default',

    importTitle: 'Import Theme',
    importSubtitle: 'Install a theme from a .zip file or folder',
    dropText: 'Drop a theme .zip file here, or click to browse',
    browseBtn: 'Browse Files',

    createTitle: 'Create New Theme',
    createNameLabel: 'Theme Name',
    createNamePlaceholder: 'My Custom Theme',
    createBaseLabel: 'Base Theme (optional)',
    createBlank: 'Blank Theme',
    createBtn: 'Create Theme',
    createDialogTitle: 'Create New Theme',
    createDialogPrompt: 'Enter theme name:',
    nameRequired: 'Please enter a name',
    themeExists: 'Theme already exists',

    backupsTitle: 'Backups',
    backupsSubtitle: 'Restore to a previous theme state',
    createBackupBtn: 'Backup Now',
    noBackups: 'No backups',
    backupDate: 'Date',
    backupTheme: 'Theme',
    restoreBtn2: 'Restore',

    settingsTitle: 'Settings',
    settingsSubtitle: 'Configure Dream Skin behavior',
    launchCdpLabel: 'Launch with CDP',
    launchCdpDesc: 'Restart Claude Desktop with remote debugging port',
    launchCdpBtn: 'Launch Claude + CDP',
    refreshInjectLabel: 'Refresh Injection',
    refreshInjectDesc: 'Re-apply current theme to Claude Desktop',
    refreshInjectBtn: 'Refresh',
    claudePathLabel: 'Claude Desktop Path',
    claudePathDesc: 'Auto-detected',
    userDataLabel: 'User Data Directory',
    userDataDesc: 'Auto-detected',

    langLabel: 'Language',
    langZh: '简体中文',
    langEn: 'English',
    themeDirLabel: 'Theme Directory',
    openDirBtn: 'Open Directory',
    aboutLabel: 'About',

    statusClaude: 'Claude',
    statusInjection: 'Injection Status',
    checking: 'Checking...',
    connected: 'Connected',
    notConnected: 'Not connected',
    injecting: 'Injecting...',

    activeTag: 'Active',
    apply: 'Apply',
    delete: 'Delete',
    export: 'Export',
    uploadBg: 'Upload Background',
    removeBg: 'Remove Background',
    noBg: 'No background image',

    confirmDelete: 'Delete this theme? This cannot be undone.',
    confirmRestore: 'Restore default appearance? Current theme will be backed up.',
    toastApplied: 'Theme applied',
    toastRestored: 'Restored to default',
    toastError: 'An error occurred',

    toastBgUploaded: 'Background uploaded',
    toastBgRemoved: 'Background removed',
    toastCreated: 'Theme created',
    toastDeleted: 'Theme deleted',
    toastRestoredOk: 'Restored to default',
    toastImported: 'Theme imported',
    toastCreateFailed: 'Creation failed',
    toastDeleteFailed: 'Delete failed',
    toastImportFailed: 'Import failed',
  },
};

/**
 * Renderer-side locale manager.
 * Detects system locale, applies translations to DOM.
 */
class RendererLocale {
  constructor() {
    this.locale = this._detectLocale();
    this.strings = RENDERER_I18N[this.locale] || RENDERER_I18N['en'];
  }

  _detectLocale() {
    try {
      const stored = localStorage.getItem('dream-skin-locale');
      if (stored && RENDERER_I18N[stored]) return stored;
    } catch (_) {}
    const sysLang = navigator.language || navigator.userLanguage || 'en';
    if (sysLang.startsWith('zh')) return 'zh-CN';
    return 'en';
  }

  t(key) {
    return this.strings[key] || key;
  }

  setLocale(locale) {
    if (!RENDERER_I18N[locale]) return;
    this.locale = locale;
    this.strings = RENDERER_I18N[locale];
    try { localStorage.setItem('dream-skin-locale', locale); } catch (_) {}
  }

  getAvailableLocales() {
    return Object.keys(RENDERER_I18N);
  }

  getLocale() {
    return this.locale;
  }
}

// Global instance
window.__dreamSkinLocale = new RendererLocale();
