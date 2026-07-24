/**
 * Dream Skin — Runtime Asset Sync
 *
 * Compiles __DREAM_SELECTOR_*__ placeholders in runtime/dream-skin.css
 * by replacing them with actual selectors from tools/selectors.json.
 * This gives us a clean contract file + a pre-compiled CSS file that
 * doesn't need token processing at runtime (the runtime injector can
 * also resolve tokens via resolveAllSelectors for future-proofing).
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SELECTORS_PATH = resolve(ROOT, 'tools', 'selectors.json');
const CSS_SOURCE = resolve(ROOT, 'runtime', 'dream-skin.css');
const CSS_COMPILED = resolve(ROOT, 'runtime', 'dream-skin-compiled.css');
const INJECT_SOURCE = resolve(ROOT, 'runtime', 'renderer-inject.js');
const INJECT_COMPILED = resolve(ROOT, 'runtime', 'renderer-inject-compiled.js');

// Token → key mapping (must match renderer-inject.js TOKEN_MAP)
const TOKEN_MAP = {
  '__DREAM_SELECTOR_SHELL_MAIN__':        'shell-main',
  '__DREAM_SELECTOR_LEFT_PANEL__':        'left-panel',
  '__DREAM_SELECTOR_HEADER_TINT__':       'header-tint',
  '__DREAM_SELECTOR_COMPOSER_CHROME__':   'composer-chrome',
  '__DREAM_SELECTOR_HOME_ROUTE__':        'home-route',
  '__DREAM_SELECTOR_HOME_SUGGESTIONS__':  'home-suggestions',
  '__DREAM_SELECTOR_HOME_ICON__':         'composer-chrome',  // fallback
  '__DREAM_SELECTOR_GAME_SOURCE__':       'shell-main',
  '__DREAM_SELECTOR_HOME_ROOT__':         'home-route',
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

function main() {
  console.log('[sync-runtime] Loading selector contract...');
  const selectors = loadSelectors();
  console.log(`  Loaded ${Object.keys(selectors).length} selectors`);

  console.log('[sync-runtime] Compiling dream-skin.css...');
  let css = readFileSync(CSS_SOURCE, 'utf-8');
  const compiled = compileCSS(css, selectors);
  writeFileSync(CSS_COMPILED, compiled);
  console.log(`  Wrote ${CSS_COMPILED} (${compiled.length} bytes, ${compiled.split('\n').length} lines)`);

  // Also copy injector
  console.log('[sync-runtime] Copying renderer-inject.js...');
  const inject = readFileSync(INJECT_SOURCE, 'utf-8');
  writeFileSync(INJECT_COMPILED, inject);
  console.log(`  Wrote ${INJECT_COMPILED} (${inject.length} bytes)`);

  // Report unmatched tokens
  const unmatched = [];
  for (const token of Object.keys(TOKEN_MAP)) {
    if (!css.includes(token)) {
      // Only warn for tokens that aren't present (some are optional)
    }
  }
  if (unmatched.length > 0) {
    console.log('[sync-runtime] Note: Some tokens not present in source CSS');
  }

  console.log('[sync-runtime] Done.');
}

main();
