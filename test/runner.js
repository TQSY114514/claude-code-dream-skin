/**
 * Claude Code Dream Skin — Test Runner
 *
 * Tests the theme engine, process manager, and CDP injector
 * without requiring a running Electron app.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(os.homedir(), '.claude-dream-skin');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

// ── Theme Engine Tests ──────────────────────────────────────────────────────

async function testThemeEngine() {
  console.log('\n📦 Theme Engine');

  const ThemeEngine = require('../src/main/theme');

  test('directories are created', () => {
    assert(fs.existsSync(ROOT), 'Root directory exists');
    assert(fs.existsSync(path.join(ROOT, 'themes')), 'Themes directory exists');
    assert(fs.existsSync(path.join(ROOT, 'themes', 'active')), 'Active directory exists');
    assert(fs.existsSync(path.join(ROOT, 'backups')), 'Backups directory exists');
  });

  test('listThemes returns installed themes', () => {
    const themes = ThemeEngine.listThemes();
    assert(Array.isArray(themes), 'Returns an array');
    assert(themes.length >= 1, 'At least one theme (default)');
  });

  test('loadTheme returns theme with CSS', () => {
    const theme = ThemeEngine.loadTheme('default');
    assert(theme !== null, 'Theme exists');
    assert(theme.css.length > 0, 'Has CSS content');
    assert(theme.meta !== undefined, 'Has metadata');
    assert.strictEqual(theme.meta.name, 'Default');
  });

  test('loadTheme returns null for nonexistent theme', () => {
    const theme = ThemeEngine.loadTheme('nonexistent-theme-xyz');
    assert.strictEqual(theme, null);
  });

  test('getActiveTheme returns theme data', () => {
    const theme = ThemeEngine.getActiveTheme();
    assert(theme !== undefined, 'Returns theme data');
    assert(typeof theme.css === 'string', 'Has CSS string');
  });

  test('activateTheme copies files to active directory', () => {
    const result = ThemeEngine.activateTheme('default');
    assert.strictEqual(result.ok, true, 'Activation succeeds');
    assert.strictEqual(result.name, 'default');

    // Verify active directory has files
    const activeFiles = fs.readdirSync(path.join(ROOT, 'themes', 'active'));
    assert(activeFiles.includes('style.css'), 'style.css copied');
    assert(activeFiles.includes('theme.json'), 'theme.json copied');
  });

  test('createTheme creates a new theme', () => {
    const result = ThemeEngine.createTheme('test-theme');
    assert.strictEqual(result.ok, true, 'Creation succeeds');
    assert(fs.existsSync(path.join(ROOT, 'themes', 'test-theme', 'theme.json')), 'theme.json exists');
    assert(fs.existsSync(path.join(ROOT, 'themes', 'test-theme', 'style.css')), 'style.css exists');
  });

  test('getInjectionCSS combines theme CSS with Claude overrides', () => {
    const inputCSS = ':root { --ds-bg: #111; }';
    const result = ThemeEngine.getInjectionCSS(inputCSS);
    assert(result.includes('--ds-bg: #111'), 'Contains theme CSS');
    assert(result.includes('.dream-skin-active'), 'Contains Claude-specific selectors');
  });

  test('deleteTheme removes a theme', () => {
    const result = ThemeEngine.deleteTheme('test-theme');
    assert.strictEqual(result.ok, true, 'Deletion succeeds');
    assert(!fs.existsSync(path.join(ROOT, 'themes', 'test-theme')), 'Theme directory removed');
  });

  test('cannot delete default theme', () => {
    const result = ThemeEngine.deleteTheme('default');
    assert.strictEqual(result.ok, false, 'Deletion fails');
    assert(result.error.includes('Cannot delete'), 'Correct error message');
  });

  test('backup and restore', async () => {
    // Create a backup
    const backupResult = ThemeEngine.backupCurrentTheme();
    assert.strictEqual(backupResult.ok, true, 'Backup succeeds');
    assert(backupResult.backupName, 'Has backup name');

    // List backups
    const backups = ThemeEngine.listBackups();
    assert(backups.length >= 1, 'At least one backup exists');

    // Restore default
    const restoreResult = ThemeEngine.restoreDefault();
    assert.strictEqual(restoreResult.ok, true, 'Restore succeeds');

    // Verify active is cleared (no style.css)
    const activeCSS = path.join(ROOT, 'themes', 'active', 'style.css');
    assert(!fs.existsSync(activeCSS), 'Active CSS removed after restore');

    // Re-activate default for other tests
    ThemeEngine.activateTheme('default');
  });

  test('cannot delete active theme', () => {
    const result = ThemeEngine.deleteTheme('default');
    assert.strictEqual(result.ok, false, 'Deletion fails');
  });
}

// ── Process Manager Tests ───────────────────────────────────────────────────

async function testProcessManager() {
  console.log('\n🔍 Process Manager');

  const ProcessManager = require('../src/main/process-manager');

  test('can find Claude path', () => {
    const info = ProcessManager.findClaudePath();
    // May or may not find it depending on WMIC access
    if (info) {
      assert(fs.existsSync(info.path), 'Path exists');
      console.log(`    Found at: ${info.path} (via ${info.source})`);
    } else {
      console.log('    (Claude not found — acceptable on test machines)');
    }
  });

  test('isRunning detects Claude correctly', async () => {
    const running = await ProcessManager.isRunning();
    assert(typeof running === 'boolean', 'Returns boolean');
    console.log(`    Claude running: ${running}`);
  });

  test('port availability check works', async () => {
    const inUse = await ProcessManager.isPortInUse(9222);
    assert(typeof inUse === 'boolean', 'Returns boolean');
    console.log(`    Port 9222 in use: ${inUse}`);
  });
}

// ── CSS Tests ──────────────────────────────────────────────────────────────

function testCSSFiles() {
  console.log('\n🎨 CSS Files');

  test('default theme style.css exists and is valid CSS', () => {
    const cssPath = path.join(ROOT, 'themes', 'active', 'style.css');
    if (!fs.existsSync(cssPath)) {
      // Re-activate first
      const ThemeEngine = require('../src/main/theme');
      ThemeEngine.activateTheme('default');
    }
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.length > 0, 'CSS is not empty');
    assert(css.includes('--ds-'), 'Contains CSS custom properties');
  });

  test('theme.json is valid JSON', () => {
    const metaPath = path.join(ROOT, 'themes', 'default', 'theme.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert(meta.name, 'Has name');
    assert(meta.version, 'Has version');
    assert(meta.colors, 'Has colors object');
  });

  test('all theme directories have valid structure', () => {
    const themesDir = path.join(ROOT, 'themes');
    if (!fs.existsSync(themesDir)) return;

    for (const name of fs.readdirSync(themesDir)) {
      const themePath = path.join(themesDir, name);
      if (!fs.statSync(themePath).isDirectory()) continue;
      if (name === 'active') continue;

      assert(
        fs.existsSync(path.join(themePath, 'theme.json')),
        `Theme "${name}" has theme.json`
      );
      assert(
        fs.existsSync(path.join(themePath, 'style.css')),
        `Theme "${name}" has style.css`
      );
    }
  });
}

// ── CDP Injector Tests ──────────────────────────────────────────────────────

async function testCDPInjector() {
  console.log('\n🔌 CDP Injector');

  test('CDPInjector class loads', () => {
    const CDPInjector = require('../src/main/injector');
    assert(typeof CDPInjector === 'function', 'CDPInjector is a class');
  });

  test('Cannot connect without CDP server (expected to fail gracefully)', async () => {
    const CDPInjector = require('../src/main/injector');
    const injector = new CDPInjector(19999); // Random unused port
    try {
      await injector.connect();
      assert(false, 'Should have thrown');
    } catch (e) {
      assert(e.message.includes('ECONNREFUSED') || e.message.includes('timeout'),
        'Error is connection-related: ' + e.message);
    }
  });
}

// ── Run All Tests ───────────────────────────────────────────────────────────

async function run() {
  console.log('🧪 Claude Code Dream Skin — Test Suite');
  console.log('='.repeat(50));

  await testThemeEngine();
  await testProcessManager();
  testCSSFiles();
  await testCDPInjector();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
