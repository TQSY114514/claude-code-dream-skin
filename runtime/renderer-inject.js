/**
 * Dream Skin — Renderer Injector
 *
 * Runs inside Claude Desktop's renderer process.
 * Watches for CSS custom property updates from the CDP injector,
 * performs image analysis, resolves selectors from the contract,
 * and compiles __DREAM_SELECTOR_*__ tokens in the injected CSS.
 */

(function () {
  'use strict';

  // ── Selector contract (mirrors tools/selectors.json) ──────────────────────
  const SELECTORS = {
    shellMain:         'main, [role="main"], [class*="content"]',
    leftPanel:         'aside, nav, [class*="sidebar"], [class*="Sidebar"], [class*="nav-"], [class*="Navigation"]',
    headerTint:        'header, [class*="header"], [class*="Header"], [class*="top-bar"], [class*="TopBar"]',
    composerChrome:    '[contenteditable="true"], [role="textbox"], [class*="composer"], [class*="Composer"], [class*="input"], textarea',
    homeRoute:         '[class*="home"], [class*="Home"], [class*="welcome"], [class*="Welcome"]',
    homeSuggestions:   '[class*="suggestion"], [class*="Suggestion"], [class*="starter"], [class*="Starter"]',
    homeIcon:          '[class*="icon"], [class*="Icon"]',
    gameSource:        '[class*="title"], [class*="Title"], h1',
    homeRoot:          '[class*="home"], [class*="Home"]',
    markdown:          '[class*="markdown"], [class*="Markdown"], .markdown-body, [class*="prose"], article',
    message:           '[class*="message"], [class*="Message"], [class*="chat-message"], [class*="ChatMessage"]',
    codeBlock:         'pre, code, [class*="code"], [class*="Code"], pre[class*="language-"]',
    sendButton:        '[class*="send"], [class*="Submit"], [class*="submit"], button[type="submit"]',
  };

  // ── Token map ─────────────────────────────────────────────────────────────
  const TOKEN_MAP = {
    '__DREAM_SELECTOR_SHELL_MAIN__':          'SELECTOR_shellMain',
    '__DREAM_SELECTOR_LEFT_PANEL__':          'SELECTOR_leftPanel',
    '__DREAM_SELECTOR_HEADER_TINT__':         'SELECTOR_headerTint',
    '__DREAM_SELECTOR_COMPOSER_CHROME__':     'SELECTOR_composerChrome',
    '__DREAM_SELECTOR_HOME_ROUTE__':          'SELECTOR_homeRoute',
    '__DREAM_SELECTOR_HOME_SUGGESTIONS__':    'SELECTOR_homeSuggestions',
    '__DREAM_SELECTOR_HOME_ICON__':           'SELECTOR_homeIcon',
    '__DREAM_SELECTOR_GAME_SOURCE__':         'SELECTOR_gameSource',
    '__DREAM_SELECTOR_MARKDOWN__':            'SELECTOR_markdown',
    '__DREAM_SELECTOR_MESSAGE__':             'SELECTOR_message',
    '__DREAM_SELECTOR_CODE_BLOCK__':          'SELECTOR_codeBlock',
    '__DREAM_SELECTOR_SEND_BUTTON__':         'SELECTOR_sendButton',
  };

  // ── Selector resolution with cache ────────────────────────────────────────
  const selectorCache = new Map();

  function resolveSelector(doc, key, forceRefresh) {
    if (!forceRefresh && selectorCache.has(key)) return selectorCache.get(key);

    let selector;
    if (key.startsWith('SELECTOR_')) {
      const name = key.replace('SELECTOR_', '');
      selector = SELECTORS[name] || '*';
    } else {
      selector = key;
    }

    try {
      const el = doc.querySelector(selector);
      if (el) {
        selectorCache.set(key, selector);
        return selector;
      }
    } catch (_) { /* bad selector */ }

    // L1 fallback: try broader
    if (key === 'SELECTOR_shellMain') {
      const fallback = doc.querySelector('[class*="content"]') || doc.querySelector('main');
      if (fallback) { selectorCache.set(key, fallback.tagName); return fallback.tagName; }
    }

    selectorCache.set(key, selector);
    return selector;
  }

  function resolveAllSelectors(doc, forceRefresh) {
    const tokens = {};
    for (const [token, key] of Object.entries(TOKEN_MAP)) {
      tokens[token] = resolveSelector(doc, key, forceRefresh);
    }
    return tokens;
  }

  function compileCSS(css, doc, forceRefresh) {
    const tokens = resolveAllSelectors(doc, forceRefresh);
    let compiled = css;
    for (const [token, selector] of Object.entries(tokens)) {
      compiled = compiled.split(token).join(selector);
    }
    return compiled;
  }

  // ── Image analysis ────────────────────────────────────────────────────────
  const ANALYSIS_CACHE = new Map();
  const HUE_BINS = 24;

  function analyzeImage(base64DataUrl) {
    if (ANALYSIS_CACHE.has(base64DataUrl)) return ANALYSIS_CACHE.get(base64DataUrl);

    const result = { dominantHue: 0, accentRgb: [130, 152, 163], brightness: 0.45, focusX: 50, focusY: 50, saturation: 0.5, side: 'left' };

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const deferred = new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = reject;
      });
      img.src = base64DataUrl;
      const loaded = await deferred;

      const w = loaded.naturalWidth || loaded.width;
      const h = loaded.naturalHeight || loaded.height;
      const canvas = document.createElement('canvas');
      const MAX = 320;
      const scale = Math.min(1, MAX / Math.max(w, h));
      canvas.width = Math.floor(w * scale);
      canvas.height = Math.floor(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(loaded, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const len = data.length;

      // Color binning
      const hueCounts = new Array(HUE_BINS).fill(0);
      let totalBright = 0;
      let brightCount = 0;
      let leftBright = 0, rightBright = 0;

      for (let i = 0; i < len; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;

        let h = 0, s = 0;
        if (max !== min) {
          const d = max - min;
          s = l > 128 ? d / (510 - max - min) : d / (max + min);
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
          else if (max === g) h = ((b - r) / d + 2) * 60;
          else h = ((r - g) / d + 4) * 60;
        }
        const brightness = l / 255;
        totalBright += brightness;
        brightCount++;

        hueCounts[Math.round(h / (360 / HUE_BINS)) % HUE_BINS] += 1;

        // Information density
        const px = (i / 4) % canvas.width;
        if (px < canvas.width / 2) leftBright += s;
        else rightBright += s;
      }

      // Dominant hue
      let maxBin = 0, maxCount = 0;
      for (let b = 0; b < HUE_BINS; b++) {
        if (hueCounts[b] > maxCount) { maxCount = hueCounts[b]; maxBin = b; }
      }
      result.dominantHue = Math.round((maxBin + 0.5) / HUE_BINS * 360);
      result.brightness = Math.min(0.65, Math.max(0.18, totalBright / brightCount));

      // Accent from dominant hue
      const c = { h: result.dominantHue, s: 72, l: 62 };
      c.l = result.brightness > 0.55 ? Math.max(c.l - 14, 38) : Math.min(c.l + 12, 68);
      c.s = Math.max(c.s - 8, 52);
      result.accentRgb = hslToRgb(c.h, c.s, c.l);

      // Focus point: hotspot at weighted center of saturation
      const satCanvas = document.createElement('canvas');
      satCanvas.width = canvas.width;
      satCanvas.height = canvas.height;
      const sctx = satCanvas.getContext('2d');
      const sid = sctx.getImageData(0, 0, satCanvas.width, satCanvas.height);
      const sd = sid.data;
      let maxSat = 0, sx = 0, sy = 0;
      for (let y = 0; y < satCanvas.height; y++) {
        for (let x = 0; x < satCanvas.width; x++) {
          const idx = (y * satCanvas.width + x) * 4;
          const r = sd[idx], g = sd[idx + 1], b = sd[idx + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const sat = mx === mn ? 0 : (mx - mn) / (510 - mx - mn);
          if (sat > maxSat) { maxSat = sat; sx = x; sy = y; }
        }
      }
      result.focusX = Math.round(sx / satCanvas.width * 100);
      result.focusY = Math.round(sy / satCanvas.height * 100);
      result.saturation = maxSat;

      // Side preference
      result.side = leftBright > rightBright ? 'left' : 'right';
    } catch (e) {
      console.warn('[DreamSkin] Image analysis failed:', e);
    }

    ANALYSIS_CACHE.set(base64DataUrl, result);
    return result;
  }

  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  // ── Theme application ─────────────────────────────────────────────────────
  let currentThemeId = null;
  let currentShell = detectShell();

  function detectShell() {
    const html = document.documentElement;
    const cls = html.className;
    if (typeof cls === 'string') {
      if (cls.includes('electron-light') || cls.includes('light-mode')) return 'light';
    }
    const dk = html.getAttribute('data-theme');
    if (dk && dk.toLowerCase().includes('light')) return 'light';
    return 'dark';
  }

  function applyThemeCSS(rawCSS, themeMeta) {
    const doc = document;
    const isDark = currentShell === 'dark';

    let compiled = compileCSS(rawCSS, doc, false);

    // Compile home-root selector with safe-area check
    const hasRightSafeArea = doc.querySelector('[data-dream-art-safe="right"]');
    if (!hasRightSafeArea) {
      compiled = compiled.replace(
        /html\[data-dream-skin="active"\]:is\(\[data-dream-art-safe="right"\]\s*,?\s*\[data-dream-art-safe-area="right"\]\)/g,
        'html[data-dream-skin="active"]'
      );
    }

    // Inject CSS
    const styleId = 'dream-skin-injected';
    let styleEl = doc.getElementById(styleId);
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = styleId;
      doc.head.appendChild(styleEl);
    }
    styleEl.textContent = compiled;

    // Set data attributes on <html>
    const html = doc.documentElement;
    html.setAttribute('data-dream-skin', 'active');
    html.setAttribute('data-dream-shell', currentShell);

    // Image analysis & adaptive palette
    let artCSS = '';
    let analysis = null;

    if (themeMeta && themeMeta.backgroundBase64) {
      analysis = analyzeImage(themeMeta.backgroundBase64);

      html.setAttribute('data-dream-art-safe', analysis.side);
      html.setAttribute('data-dream-art-focus-x', analysis.focusX + '%');
      html.setAttribute('data-dream-art-focus-y', analysis.focusY + '%');
      html.setAttribute('data-dream-art-position', `${analysis.focusX}% ${analysis.focusY}%`);
      html.setAttribute('data-dream-task-mode', themeMeta.taskMode || 'immersive');
      html.setAttribute('data-dream-art-task-mode', themeMeta.taskMode || 'immersive');
      html.setAttribute('data-dream-task-shade', '1');
      html.setAttribute('data-dream-task-fade', '1');
      html.setAttribute('data-dream-art', `url(${themeMeta.backgroundBase64})`);
      html.setAttribute('data-dream-skin-name', themeMeta.name || 'Dream Skin');
      html.setAttribute('data-dream-skin-tagline', themeMeta.tagline || '');

      // Adaptive accent override
      const accent = analysis.accentRgb.join(' ');
      const accentHex = rgbToHex(analysis.accentRgb[0], analysis.accentRgb[1], analysis.accentRgb[2]);
      artCSS = `
        :root[data-dream-skin="active"] {
          --ds-accent-rgb: ${accent};
          --ds-accent: ${accentHex};
          --ds-accent-soft: ${accentHex}33;
          --ds-secondary-rgb: ${analysis.accentRgb.map(v => Math.round(v * 0.88)).join(' ')};
          --ds-secondary: ${rgbToHex(...analysis.accentRgb.map(v => Math.round(v * 0.88)))};
          --ds-highlight-rgb: ${analysis.accentRgb.map(v => Math.round(v * 0.72)).join(' ')};
          --ds-highlight: ${rgbToHex(...analysis.accentRgb.map(v => Math.round(v * 0.72)))};
        }
      `;

      if (analysis.side === 'right') {
        artCSS += `
          html[data-dream-skin="active"] __DREAM_SELECTOR_LEFT_PANEL__ {
            background: linear-gradient(270deg, rgb(var(--ds-panel-rgb) / .98), rgb(var(--ds-bg-rgb) / .96)) !important;
          }
        `;
      }
    }

    // Inject adaptive art CSS
    const artId = 'dream-skin-art-css';
    let artEl = doc.getElementById(artId);
    if (!artEl) {
      artEl = doc.createElement('style');
      artEl.id = artId;
      doc.head.appendChild(artEl);
    }
    artEl.textContent = artCSS;
  }

  function removeTheme() {
    const styleEl = document.getElementById('dream-skin-injected');
    const artEl = document.getElementById('dream-skin-art-css');
    if (styleEl) styleEl.remove();
    if (artEl) artEl.remove();
    document.documentElement.removeAttribute('data-dream-skin');
    currentThemeId = null;
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // ── Shell change watcher ──────────────────────────────────────────────────
  function watchShellChange() {
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      const newShell = detectShell();
      if (newShell !== currentShell) {
        currentShell = newShell;
        const meta = window.__dreamSkinThemeMeta__;
        if (meta) applyThemeCSS(meta.rawCSS, meta);
      }
    });
    if (html) {
      observer.observe(html, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'data-color-scheme'],
      });
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    if (document.getElementById('dream-skin-injected')) {
      // Already running
      return;
    }

    // Listen for theme updates from the CDP injector
    // The CDP injector sets window.__dreamSkinThemeMeta__ before injecting CSS
    const handler = new Proxy({}, {
      set(target, prop, value) {
        if (prop === '__dreamSkinThemeMeta__') {
          if (value && value.rawCSS) {
            applyThemeCSS(value.rawCSS, value);
          } else if (value === null) {
            removeTheme();
          }
        }
        return true;
      }
    });

    // Expose for CDP injector communication
    window.__dreamSkinApi = {
      apply: (rawCSS, meta) => {
        window.__dreamSkinThemeMeta__ = { rawCSS, ...meta };
        applyThemeCSS(rawCSS, { rawCSS, ...meta });
      },
      remove: () => {
        window.__dreamSkinThemeMeta__ = null;
        removeTheme();
      },
      analyze: (base64) => analyzeImage(base64),
      getShell: detectShell,
      getSelectors: () => {
        const doc = document;
        const tokens = {};
        for (const [token, key] of Object.entries(TOKEN_MAP)) {
          tokens[token] = resolveSelector(doc, key, false);
        }
        return tokens;
      },
      getResolvedSelectors: () => resolveAllSelectors(document, false),
    };

    // Set initial theme meta if present
    if (window.__dreamSkinThemeMeta__ && window.__dreamSkinThemeMeta__.rawCSS) {
      applyThemeCSS(window.__dreamSkinThemeMeta__.rawCSS, window.__dreamSkinThemeMeta__);
    }

    watchShellChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
