/**
 * Dream Skin — Runtime Asset Sync
 *
 * Compiles __DREAM_SELECTOR_*__ placeholders in runtime/dream-skin.css
 * by replacing them with actual selectors from tools/selectors.json.
 *
 * Also assembles payload placeholders in runtime/renderer-inject.js with
 * static tokens (version, styleRevision) pre-replaced. Runtime tokens
 * (css JSON, art data URL, theme config JSON, payload revision) are left
 * as placeholders and get resolved by the injector at injection time.
 *
 * @see Codex Dream Skin tools/sync-runtime-assets.mjs — payload assembly pattern
 */

import { readFileSync, writeFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SELECTORS_PATH = resolve(ROOT, 'tools', 'selectors.json');
const CSS_SOURCE = resolve(ROOT, 'runtime', 'dream-skin.css');
const CSS_COMPILED = resolve(ROOT, 'runtime', 'dream-skin-compiled.css');
const INJECT_SOURCE = resolve(ROOT, 'runtime', 'renderer-inject.js');
const INJECT_COMPILED = resolve(ROOT, 'runtime', 'renderer-inject-compiled.js');

const SKIN_VERSION = '1.3.5';

// Token → key mapping (must match selectors.json keys)
const TOKEN_MAP = {
  '__DREAM_SELECTOR_SHELL_MAIN__':        'shell-main',
  '__DREAM_SELECTOR_LEFT_PANEL__':        'left-panel',
  '__DREAM_SELECTOR_HEADER_TINT__':       'header-tint',
  '__DREAM_SELECTOR_COMPOSER_CHROME__':   'composer-chrome',
  '__DREAM_SELECTOR_HOME_ROUTE__':        'home-route',
  '__DREAM_SELECTOR_HOME_ROUTE_CSS__':    'home-route-css',
  '__DREAM_SELECTOR_HOME_ICON__':         'home-icon',
  '__DREAM_SELECTOR_GAME_SOURCE__':       'game-source',
  '__DREAM_SELECTOR_HOME_SUGGESTIONS__':  'home-suggestions',
  '__DREAM_SELECTOR_MARKDOWN__':          'markdown',
  '__DREAM_SELECTOR_MESSAGE__':           'message',
  '__DREAM_SELECTOR_CODE_BLOCK__':        'code-block',
  '__DREAM_SELECTOR_SEND_BUTTON__':       'send-button',
};

function loadSelectors() {
  const contract = JSON.parse(readFileSync(SELECTORS_PATH, 'utf-8'));
  const map = {};
  for (const s of contract.selectors) {
    map[s.key] = s.selector;
  }
  return map;
}

function compileCSS(css, selectors) {
  let result = css;
  for (const [token, key] of Object.entries(TOKEN_MAP)) {
    const sel = selectors[key] || '*';
    result = result.split(token).join(sel);
  }
  return result;
}

function computeRevision(data) {
  return createHash('sha256').update(data, 'utf-8').digest('hex').slice(0, 20);
}

function main() {
  console.log('[sync-runtime] Loading selector contract...');
  const selectors = loadSelectors();
  console.log(`  Loaded ${Object.keys(selectors).length} selectors`);

  // ── Compile CSS ────────────────────────────────────────────────────────

  console.log('[sync-runtime] Compiling dream-skin.css...');
  let css = readFileSync(CSS_SOURCE, 'utf-8');
  const compiledCSS = compileCSS(css, selectors);
  writeFileSync(CSS_COMPILED, compiledCSS);
  const styleRevision = computeRevision(compiledCSS);
  console.log(`  Wrote ${CSS_COMPILED} (${compiledCSS.length} bytes, ${compiledCSS.split('\n').length} lines)`);
  console.log(`  styleRevision: ${styleRevision}`);

  // ── Compile injector with static placeholders ──────────────────────────

  console.log('[sync-runtime] Compiling renderer-inject.js...');
  let inject = readFileSync(INJECT_SOURCE, 'utf-8');

  // Replace STATIC tokens (same at build time)
  const staticTokens = {
    '__DREAM_SKIN_VERSION_JSON__': JSON.stringify(SKIN_VERSION),
    '__DREAM_SKIN_STYLE_REVISION_JSON__': JSON.stringify(styleRevision),
  };

  for (const [token, value] of Object.entries(staticTokens)) {
    inject = inject.split(token).join(value);
  }

  // Compute payload revision (empty theme payload — real revision includes theme config)
  const payloadRevision = computeRevision(SKIN_VERSION + compiledCSS + '{}');
  inject = inject.split('__DREAM_SKIN_PAYLOAD_REVISION_JSON__').join(JSON.stringify(payloadRevision));

  writeFileSync(INJECT_COMPILED, inject);
  console.log(`  Wrote ${INJECT_COMPILED} (${inject.length} bytes)`);
  console.log(`  version: ${SKIN_VERSION}`);
  console.log(`  payloadRevision (empty): ${payloadRevision}`);

  // ── Report ─────────────────────────────────────────────────────────────

  // Check for remaining placeholders (should only be runtime ones)
  const remainingPlaceholders = [];
  const placeholderRegex = /__DREAM_\w+_JSON__/g;
  let match;
  while ((match = placeholderRegex.exec(inject)) !== null) {
    remainingPlaceholders.push(match[0]);
  }

  if (remainingPlaceholders.length > 0) {
    console.log(`\n  Remaining runtime placeholders (resolved by injector):`);
    for (const p of remainingPlaceholders) {
      console.log(`    ${p}`);
    }
  }

  // Check source CSS for unmatched tokens
  const cssTokens = [];
  const cssTokenRegex = /__DREAM_\w+_JSON__/g;
  while ((match = cssTokenRegex.exec(css)) !== null) {
    cssTokens.push(match[0]);
  }
  // Filter out known static/runtime tokens
  const knownTokens = new Set([
    '__DREAM_SKIN_CSS_JSON__', '__DREAM_SKIN_ART_JSON__', '__DREAM_SKIN_THEME_JSON__',
    '__DREAM_SKIN_VERSION_JSON__', '__DREAM_SKIN_STYLE_REVISION_JSON__',
    '__DREAM_SKIN_PAYLOAD_REVISION_JSON__',
  ]);
  const unknownTokens = cssTokens.filter(t => !knownTokens.has(t));
  if (unknownTokens.length > 0) {
    console.log(`\n  [sync-runtime] Warning: Unknown tokens in source CSS: ${unknownTokens.join(', ')}`);
  }

  console.log('\n[sync-runtime] Done.');
}

main();
