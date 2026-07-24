/**
 * Claude Code Dream Skin — i18n Locale Definitions
 *
 * Supported locales: zh-CN (Chinese), en (English)
 * Auto-detects system locale on first load.
 */

const LOCALES = {
  'zh-CN': {
    // Tray menu
    trayAppName: 'Claude Code Dream Skin',
    claudeRunning: 'Claude: 运行中',
    claudeNotRunning: 'Claude: 未运行',
    themeActive: '主题: 已激活',
    themeInactive: '主题: 未激活',
    showManager: '打开管理器',
    switchTheme: '切换主题',
    restoreDefault: '恢复默认',
    manageThemes: '管理主题...',
    quit: '退出',

    // Manager window
    windowTitle: 'Claude Code Dream Skin',
    themes: '主题',
    backups: '备份',
    importTheme: '导入主题',
    createTheme: '创建主题',
    importHint: '拖放 .zip 主题包到此处，或点击选择文件',
    noThemes: '暂无自定义主题',
    activeTag: '当前使用',
    apply: '应用',
    delete: '删除',
    export: '导出',
    uploadBg: '上传背景图',
    removeBg: '移除背景图',
    confirmDelete: '确定删除此主题？',
    confirmRestore: '确定恢复默认外观？当前主题将自动备份。',
    deleteSuccess: '主题已删除',
    deleteFailed: '删除失败',
    restoreSuccess: '已恢复默认外观',
    importSuccess: '主题导入成功',
    importFailed: '导入失败：',
    noBgImage: '暂无背景图',
    bgUploaded: '背景图已上传',
    bgRemoved: '背景图已移除',
    createTitle: '创建新主题',
    createPrompt: '输入主题名称：',
    createSuccess: '主题创建成功',
    createFailed: '创建失败',
    nameRequired: '请输入主题名称',
    themeExists: '主题已存在',

    // Status
    injectionStatus: '注入状态',
    connected: '已连接',
    disconnected: '未连接',
    injecting: '注入中...',
    errorPrefix: '错误: ',
    restartRequired: '需要重启 Claude',

    // Backup
    backupNow: '立即备份',
    noBackups: '暂无备份',
    restore: '恢复',
    backupDate: '备份时间',
    backupTheme: '主题',

    // Settings
    settings: '设置',
    language: '语言',
    languageZh: '简体中文',
    languageEn: 'English',
    themeDir: '主题目录',
    openDir: '打开目录',
    about: '关于',
    version: '版本',
    author: '作者',
    license: '许可证',

    // Toast
    applied: '主题已应用',
    restored: '已恢复默认',
    error: '发生错误',

    // Dynamic effects
    dynamicOn: '动态效果: 开启',
    dynamicOff: '动态效果: 关闭',
    particleCount: '粒子数量',
    glowCount: '光晕数量',
    speed: '速度',
    sparkleOnClick: '点击火花',
    parallax: '鼠标视差',
    on: '开启',
    off: '关闭',
  },

  en: {
    // Tray menu
    trayAppName: 'Claude Code Dream Skin',
    claudeRunning: 'Claude: Running',
    claudeNotRunning: 'Claude: Not Running',
    themeActive: 'Theme: Active',
    themeInactive: 'Theme: Inactive',
    showManager: 'Show Manager',
    switchTheme: 'Switch Theme',
    restoreDefault: 'Restore Default',
    manageThemes: 'Manage Themes...',
    quit: 'Quit',

    // Manager window
    windowTitle: 'Claude Code Dream Skin',
    themes: 'Themes',
    backups: 'Backups',
    importTheme: 'Import Theme',
    createTheme: 'Create Theme',
    importHint: 'Drop a .zip theme package here, or click to browse',
    noThemes: 'No custom themes yet',
    activeTag: 'Active',
    apply: 'Apply',
    delete: 'Delete',
    export: 'Export',
    uploadBg: 'Upload Background',
    removeBg: 'Remove Background',
    confirmDelete: 'Delete this theme?',
    confirmRestore: 'Restore default appearance? Current theme will be backed up.',
    deleteSuccess: 'Theme deleted',
    deleteFailed: 'Delete failed',
    restoreSuccess: 'Restored to default',
    importSuccess: 'Theme imported',
    importFailed: 'Import failed: ',
    noBgImage: 'No background image',
    bgUploaded: 'Background uploaded',
    bgRemoved: 'Background removed',
    createTitle: 'Create New Theme',
    createPrompt: 'Enter theme name:',
    createSuccess: 'Theme created',
    createFailed: 'Creation failed',
    nameRequired: 'Please enter a name',
    themeExists: 'Theme already exists',

    // Status
    injectionStatus: 'Injection Status',
    connected: 'Connected',
    disconnected: 'Disconnected',
    injecting: 'Injecting...',
    errorPrefix: 'Error: ',
    restartRequired: 'Restart required',

    // Backup
    backupNow: 'Backup Now',
    noBackups: 'No backups',
    restore: 'Restore',
    backupDate: 'Date',
    backupTheme: 'Theme',

    // Settings
    settings: 'Settings',
    language: 'Language',
    languageZh: '简体中文',
    languageEn: 'English',
    themeDir: 'Theme Directory',
    openDir: 'Open Directory',
    about: 'About',
    version: 'Version',
    author: 'Author',
    license: 'License',

    // Toast
    applied: 'Theme applied',
    restored: 'Restored to default',
    error: 'An error occurred',

    // Dynamic effects
    dynamicOn: 'Dynamic Effects: On',
    dynamicOff: 'Dynamic Effects: Off',
    particleCount: 'Particles',
    glowCount: 'Glow Blobs',
    speed: 'Speed',
    sparkleOnClick: 'Click Sparkles',
    parallax: 'Mouse Parallax',
    on: 'On',
    off: 'Off',
  },
};

/**
 * Detect system locale and return best matching locale key.
 */
function detectLocale() {
  try {
    const sysLang = process.env.LANG || process.env.LC_ALL || process.env.LANG || 'en';
    if (sysLang.startsWith('zh')) return 'zh-CN';
  } catch (_) {}
  return 'en';
}

/**
 * Get all available locale keys.
 */
function getAvailableLocales() {
  return Object.keys(LOCALES);
}

/**
 * Get translations for a locale.
 */
function getLocale(locale) {
  return LOCALES[locale] || LOCALES['en'];
}

module.exports = { LOCALES, detectLocale, getAvailableLocales, getLocale };
