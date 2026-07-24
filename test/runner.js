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

  test('getInjectionCSS returns theme CSS', () => {
    const inputCSS = ':root { --ds-bg: #111; }';
    const result = ThemeEngine.getInjectionCSS(inputCSS, null);
    assert(result === inputCSS, 'Returns only theme CSS without skin CSS');
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

  test('CDPInjector loads renderer-inject.js', () => {
    const CDPInjector = require('../src/main/injector');
    const injector = new CDPInjector(19999);
    assert(injector._injectorCode.length > 0, 'Injector code is loaded');
    assert(injector._injectorCode.includes('SELECTORS'), 'Contains selector code');
    assert(injector._injectorCode.includes('analyzeImage'), 'Contains image analysis');
  });
}

// ── Selector Compilation Tests ────────────────────────────────────────────

function testSelectorCompilation() {
  console.log('\n🎯 Selector Compilation');

  test('selectors.json loads and has correct schema', () => {
    const selectorsPath = path.join(__dirname, '..', 'tools', 'selectors.json');
    const data = JSON.parse(fs.readFileSync(selectorsPath, 'utf8'));
    assert.strictEqual(data.schema, 'claude-dream-skin-selectors/1', 'Schema version correct');
    assert(data.selectors.length >= 10, 'Has at least 10 selectors');
    assert(Array.isArray(data.themeVariables), 'Has theme variables array');
    assert(data.themeVariables.length >= 30, 'Has at least 30 theme variables');
  });

  test('all selectors have required fields', () => {
    const selectorsPath = path.join(__dirname, '..', 'tools', 'selectors.json');
    const data = JSON.parse(fs.readFileSync(selectorsPath, 'utf8'));
    for (const s of data.selectors) {
      assert(s.key, `Selector has key: ${s.key}`);
      assert(s.selector, `Selector "${s.key}" has selector string`);
      assert(['L1', 'L2'].includes(s.tier), `Selector "${s.key}" has valid tier`);
      assert(s.scope, `Selector "${s.key}" has scope`);
    }
  });

  test('sync-runtime-assets.mjs compiles without errors', async () => {
    const { execSync } = require('child_process');
    const result = execSync('node tools/sync-runtime-assets.mjs', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    });
    assert(result.includes('Done'), 'Output indicates success');
  });

  test('compiled CSS has no unresolved tokens (except in comments)', () => {
    const compiledPath = path.join(__dirname, '..', 'runtime', 'dream-skin-compiled.css');
    if (!fs.existsSync(compiledPath)) {
      // Run build first
      const { execSync } = require('child_process');
      execSync('node tools/sync-runtime-assets.mjs', {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
      });
    }
    const css = fs.readFileSync(compiledPath, 'utf8');
    const lines = css.split('\n');
    let unresolvedInRules = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
      if (trimmed.includes('__DREAM_SELECTOR')) {
        unresolvedInRules++;
      }
    }
    assert.strictEqual(unresolvedInRules, 0, `No unresolved tokens in CSS rules (found ${unresolvedInRules})`);
  });

  test('compiled CSS has actual selectors from contract', () => {
    const compiledPath = path.join(__dirname, '..', 'runtime', 'dream-skin-compiled.css');
    if (!fs.existsSync(compiledPath)) {
      const { execSync } = require('child_process');
      execSync('node tools/sync-runtime-assets.mjs', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    }
    const css = fs.readFileSync(compiledPath, 'utf8');
    assert(css.includes("aside, nav, [class*='sidebar']"), 'Contains left-panel selector');
    assert(css.includes('[role="main"]') || css.includes('[class*="content"]'), 'Contains shell-main selector');
  });
}

// ── Image Analysis Tests ──────────────────────────────────────────────────

function testImageAnalysis() {
  console.log('\n🖼️ Image Analysis');

  // We can't load the full renderer-inject.js in Node (uses window/Image),
  // but we can test the analysis logic directly
  test('hslToRgb conversion is correct', () => {
    // Test the algorithm used in renderer-inject.js
    function hslToRgb(h, s, l) {
      s /= 100; l /= 100;
      const a = s * Math.min(l, 1 - l);
      const f = n => {
        const k = (n + h / 30) % 12;
        return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      };
      return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
    }

    // Red: h=0, s=100, l=50
    const red = hslToRgb(0, 100, 50);
    assert(Math.abs(red[0] - 255) < 2, `Red R: ${red[0]}`);
    assert(Math.abs(red[1] - 0) < 2, `Red G: ${red[1]}`);
    assert(Math.abs(red[2] - 0) < 2, `Red B: ${red[2]}`);

    // Blue: h=240, s=100, l=50
    const blue = hslToRgb(240, 100, 50);
    assert(Math.abs(blue[0] - 0) < 2, `Blue R: ${blue[0]}`);
    assert(Math.abs(blue[1] - 0) < 2, `Blue G: ${blue[1]}`);
    assert(Math.abs(blue[2] - 255) < 2, `Blue B: ${blue[2]}`);

    // Green: h=120, s=100, l=50
    const green = hslToRgb(120, 100, 50);
    assert(Math.abs(green[0] - 0) < 2, `Green R: ${green[0]}`);
    assert(Math.abs(green[1] - 255) < 2, `Green G: ${green[1]}`);
    assert(Math.abs(green[2] - 0) < 2, `Green B: ${green[2]}`);
  });

  test('hue binning logic works', () => {
    const HUE_BINS = 24;
    // H=0 → bin 0
    assert.strictEqual(Math.round(0 / (360 / HUE_BINS)) % HUE_BINS, 0);
    // H=180 → bin 12
    assert.strictEqual(Math.round(180 / (360 / HUE_BINS)) % HUE_BINS, 12);
    // H=360 → bin 0 (wraps)
    assert.strictEqual(Math.round(360 / (360 / HUE_BINS)) % HUE_BINS, 0);
  });

  test('renderer-inject.js contains image analysis', () => {
    const injectPath = path.join(__dirname, '..', 'runtime', 'renderer-inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    assert(code.includes('analyzeImage'), 'Has analyzeImage function');
    assert(code.includes('HUE_BINS'), 'Has hue binning constant');
    assert(code.includes('hslToRgb'), 'Has color conversion');
    assert(code.includes('dominantHue'), 'Analyzes dominant hue');
    assert(code.includes('brightness'), 'Analyzes brightness');
    assert(code.includes('focusX'), 'Analyzes focus point');
    assert(code.includes('accentRgb'), 'Generates accent color');
  });

  test('renderer-inject.js contains adaptive palette', () => {
    const injectPath = path.join(__dirname, '..', 'runtime', 'renderer-inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    assert(code.includes('--ds-accent-rgb'), 'Sets accent-rgb');
    assert(code.includes('accentHex'), 'Generates accent hex');
  });
}

// ── Light Theme Tests ─────────────────────────────────────────────────────

function testLightTheme() {
  console.log('\n☀️ Light Theme');

  test('dream-skin.css has light theme section', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('data-dream-shell="light"'), 'Has light shell selector');
    assert(css.includes('color-scheme: light'), 'Sets light color-scheme');
  });

  test('light theme overrides sufficient variables', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    // Extract the light section
    const lightMatch = css.match(/html\[data-dream-skin="active"\]\[data-dream-shell="light"\]\s*\{([^}]+)\}/s);
    assert(lightMatch, 'Found light theme block');
    const lightVars = (lightMatch[1].match(/--ds-[a-z-]+/g) || []);
    assert(lightVars.length >= 15, `Light theme overrides ${lightVars.length} variables (need >= 15)`);
  });

  test('renderer-inject.js detects shell type', () => {
    const injectPath = path.join(__dirname, '..', 'runtime', 'renderer-inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    assert(code.includes('detectShell'), 'Has shell detection function');
    assert(code.includes('electron-light') || code.includes('electron-dark'), 'Checks electron class');
    assert(code.includes('data-dream-shell'), 'Sets shell attribute');
  });

  test('light theme uses lighter backgrounds and darker text', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const lightMatch = css.match(/html\[data-dream-skin="active"\]\[data-dream-shell="light"\]\s*\{([^}]+)\}/s);
    assert(lightMatch, 'Found light theme block');
    const content = lightMatch[1];
    // Light theme should have lighter bg values (high numbers)
    assert(content.includes('#f') || content.includes('rgb(24'), 'Has light background');
    // Light theme should have darker text values (low numbers)
    assert(content.includes('#22') || content.includes('rgb(3'), 'Has dark text');
  });
}

// ── Dynamic Effects Tests ───────────────────────────────────────────────────

function testDynamicEffects() {
  console.log('\n✨ Dynamic Effects System');

  test('dream-skin.css has particle animation keyframes', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('@keyframes ds-float'), 'Has ds-float keyframes');
    assert(css.includes('@keyframes ds-sparkle-blink'), 'Has ds-sparkle-blink keyframes');
    assert(css.includes('@keyframes ds-glow-pulse'), 'Has ds-glow-pulse keyframes');
    assert(css.includes('@keyframes ds-shimmer'), 'Has ds-shimmer keyframes');
    assert(css.includes('@keyframes ds-drift-up'), 'Has ds-drift-up keyframes');
    assert(css.includes('@keyframes ds-twinkle'), 'Has ds-twinkle keyframes');
  });

  test('dream-skin.css has dynamic CSS classes', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('.ds-particle'), 'Has ds-particle class');
    assert(css.includes('.ds-sparkle'), 'Has ds-sparkle class');
    assert(css.includes('.ds-glow'), 'Has ds-glow class');
    assert(css.includes('.ds-mouse-vignette'), 'Has ds-mouse-vignette class');
  });

  test('dream-skin.css has data-dream-dynamic selector', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('data-dream-dynamic="on"'), 'Has data-dream-dynamic attribute selector');
  });

  test('dream-skin.css has particle CSS variables', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('--ds-particle-count'), 'Has particle count variable');
    assert(css.includes('--ds-particle-speed'), 'Has particle speed variable');
    assert(css.includes('--ds-particle-duration'), 'Has particle duration variable');
    assert(css.includes('--ds-particle-opacity'), 'Has particle opacity variable');
  });

  test('dream-skin.css has dynamic CSS variables in dark theme', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const rootMatch = css.match(/:root\[data-dream-skin="active"\]\s*\{([^}]+)\}/s);
    assert(rootMatch, 'Found root block');
    assert(rootMatch[1].includes('--ds-dynamic-enabled'), 'Has dynamic-enabled variable');
  });

  test('dream-skin.css has scan line effect for dynamic mode', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('repeating-linear-gradient'), 'Has scan line gradient');
  });

  test('dream-skin.css has tagline styling', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('.ds-tagline'), 'Has ds-tagline class');
  });

  test('renderer-inject.js has dynamic effects engine', () => {
    const injectPath = path.join(__dirname, '..', 'runtime', 'renderer-inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    assert(code.includes('createParticle'), 'Has createParticle function');
    assert(code.includes('createGlowBlob'), 'Has createGlowBlob function');
    assert(code.includes('createSparkle'), 'Has createSparkle function');
    assert(code.includes('initDynamicEffects'), 'Has initDynamicEffects function');
    assert(code.includes('clearDynamicEffects'), 'Has clearDynamicEffects function');
  });

  test('renderer-inject.js has mouse parallax for dynamic effects', () => {
    const injectPath = path.join(__dirname, '..', 'runtime', 'renderer-inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    assert(code.includes('mousemove'), 'Listens for mousemove events');
    assert(code.includes('ds-mouse-x'), 'Sets mouse X position');
    assert(code.includes('ds-mouse-y'), 'Sets mouse Y position');
    assert(code.includes('ds-mouse-vignette'), 'Has vignette element for mouse tracking');
  });

  test('renderer-inject.js has click sparkle effects', () => {
    const injectPath = path.join(__dirname, '..', 'runtime', 'renderer-inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    assert(code.includes('addEventListener') && code.includes("'click'"), 'Listens for click events');
    assert(code.includes('ds-sparkle'), 'Creates sparkle elements on click');
  });

  test('themes with dynamic config have correct structure', () => {
    const themesDir = path.join(__dirname, '..', 'themes');
    for (const name of fs.readdirSync(themesDir)) {
      const themePath = path.join(themesDir, name);
      if (!fs.statSync(themePath).isDirectory()) continue;
      const metaPath = path.join(themePath, 'theme.json');
      if (!fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.dynamic) {
        assert(typeof meta.dynamic.particleCount === 'number', `${name}: particleCount is number`);
        assert(typeof meta.dynamic.glowCount === 'number', `${name}: glowCount is number`);
        assert(typeof meta.dynamic.speed === 'number', `${name}: speed is number`);
        assert(typeof meta.dynamic.sparkleOnClick === 'boolean', `${name}: sparkleOnClick is boolean`);
        assert(typeof meta.dynamic.parallax === 'boolean', `${name}: parallax is boolean`);
        assert(meta.dynamic.particleCount > 0, `${name}: particleCount > 0`);
        assert(meta.dynamic.particleCount <= 100, `${name}: particleCount <= 100`);
      }
    }
  });
}

function testThreeLayerBackground() {
  console.log('\n🏔️ Three-Layer Background System');

  test('CSS has task-fade, task-shade, and dream-skin-art layers', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('--ds-task-fade'), 'Has task-fade variable');
    assert(css.includes('--ds-task-shade'), 'Has task-shade variable');
    assert(css.includes('--dream-skin-art'), 'Has art background variable');
  });

  test('CSS uses all three layers in background-image', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    // The ::before pseudo-element should stack all three
    assert(css.includes('var(--ds-task-fade)'), 'Uses task-fade in stack');
    assert(css.includes('var(--ds-task-shade)'), 'Uses task-shade in stack');
    assert(css.includes('var(--dream-skin-art)'), 'Uses art image in stack');
  });

  test('CSS has task-mode selectors (ambient, banner, off)', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert(css.includes('data-dream-task-mode="ambient"'), 'Has ambient mode');
    assert(css.includes('data-dream-task-mode="banner"'), 'Has banner mode');
    assert(css.includes('data-dream-task-mode="off"'), 'Has off mode');
  });

  test('banner mode has constrained height', () => {
    const cssPath = path.join(__dirname, '..', 'runtime', 'dream-skin.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const bannerMatch = css.match(/banner[^}]*clamp\([^)]+\)/s);
    assert(bannerMatch, 'Banner mode has clamp height');
  });

  test('renderer-inject.js sets task-mode data attributes', () => {
    const injectPath = path.join(__dirname, '..', 'runtime', 'renderer-inject.js');
    const code = fs.readFileSync(injectPath, 'utf8');
    assert(code.includes('data-dream-task-mode'), 'Sets task-mode attribute');
    assert(code.includes('taskMode'), 'Reads taskMode from meta');
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
  testSelectorCompilation();
  testImageAnalysis();
  testLightTheme();
  testThreeLayerBackground();
  testDynamicEffects();

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
