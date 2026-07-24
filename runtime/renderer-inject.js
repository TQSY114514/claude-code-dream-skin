/**
 * Dream Skin — Renderer Injector
 *
 * Runs inside Claude Desktop's renderer process via CDP Runtime.evaluate.
 * Performs dynamic features that can't be done in static CSS:
 *   - Image analysis (color binning, focus point, brightness)
 *   - Adaptive palette generation from image dominant color
 *   - Shell detection (dark/light Electron theme)
 *   - Token resolution with cache (fallback for un-compiled CSS)
 *   - MutationObserver for shell changes
 *
 * The PRIMARY styling is injected via CDP CSS.addStyleSheet (compiled CSS).
 * This script only sets CSS custom properties and data attributes.
 */

(function () {
  'use strict';

  // ── Selector contract (mirrors tools/selectors.json) ──────────────────────
  const SELECTORS = {
    shellMain:       'main, [role="main"], [class*="content"]',
    leftPanel:       'aside, nav, [class*="sidebar"], [class*="Sidebar"], [class*="nav-"], [class*="Navigation"]',
    headerTint:      'header, [class*="header"], [class*="Header"], [class*="top-bar"], [class*="TopBar"]',
    composerChrome:  '[contenteditable="true"], [role="textbox"], [class*="composer"], [class*="Composer"], [class*="input"], textarea',
    homeRoute:       '[class*="home"], [class*="Home"], [class*="welcome"], [class*="Welcome"]',
    homeSuggestions: '[class*="suggestion"], [class*="Suggestion"], [class*="starter"], [class*="Starter"]',
    markdown:        '[class*="markdown"], [class*="Markdown"], .markdown-body, [class*="prose"], article',
    message:         '[class*="message"], [class*="Message"], [class*="chat-message"], [class*="ChatMessage"]',
    codeBlock:       'pre, code, [class*="code"], [class*="Code"], pre[class*="language-']",
    sendButton:      '[class*="send"], [class*="Submit"], [class*="submit"], button[type="submit"]',
  };

  // ── Feature detection ──────────────────────────────────────────────────────
  let hasCSSSupports = false;
  try { hasCSSSupports = CSS.supports && CSS.supports('selector(:has(*))'); } catch (_) {}

  // ── Image analysis ────────────────────────────────────────────────────────
  const ANALYSIS_CACHE = new Map();
  const HUE_BINS = 24;

  async function analyzeImage(base64DataUrl) {
    if (ANALYSIS_CACHE.has(base64DataUrl)) return ANALYSIS_CACHE.get(base64DataUrl);

    const result = { dominantHue: 0, accentRgb: [130, 152, 163], brightness: 0.45, focusX: 50, focusY: 50, saturation: 0.5, side: 'left' };

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const loaded = await new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = base64DataUrl;
      });

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

      const hueCounts = new Array(HUE_BINS).fill(0);
      let totalBright = 0, brightCount = 0;
      let leftBright = 0, rightBright = 0;

      for (let i = 0; i < len; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const l = (mx + mn) / 2;
        let h = 0, s = 0;
        if (mx !== mn) {
          const d = mx - mn;
          s = l > 128 ? d / (510 - mx - mn) : d / (mx + mn);
          if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
          else if (mx === g) h = ((b - r) / d + 2) * 60;
          else h = ((r - g) / d + 4) * 60;
        }
        totalBright += l / 255;
        brightCount++;
        hueCounts[Math.round(h / (360 / HUE_BINS)) % HUE_BINS]++;
        const px = (i / 4) % canvas.width;
        if (px < canvas.width / 2) leftBright += s;
        else rightBright += s;
      }

      let maxBin = 0, maxCount = 0;
      for (let b = 0; b < HUE_BINS; b++) {
        if (hueCounts[b] > maxCount) { maxCount = hueCounts[b]; maxBin = b; }
      }
      result.dominantHue = Math.round((maxBin + 0.5) / HUE_BINS * 360);
      result.brightness = Math.min(0.65, Math.max(0.18, totalBright / brightCount));

      // Adaptive accent from dominant hue
      const c = { h: result.dominantHue, s: 72, l: 62 };
      c.l = result.brightness > 0.55 ? Math.max(c.l - 14, 38) : Math.min(c.l + 12, 68);
      c.s = Math.max(c.s - 8, 52);
      result.accentRgb = hslToRgb(c.h, c.s, c.l);

      // Focus point: center of highest saturation
      const sid = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const sd = sid.data;
      let maxSat = 0, sx = 0, sy = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = (y * canvas.width + x) * 4;
          const r2 = sd[idx], g2 = sd[idx + 1], b2 = sd[idx + 2];
          const mmx = Math.max(r2, g2, b2), mmn = Math.min(r2, g2, b2);
          const sat = mmx === mmn ? 0 : (mmx - mmn) / (510 - mmx - mmn);
          if (sat > maxSat) { maxSat = sat; sx = x; sy = y; }
        }
      }
      result.focusX = Math.round(sx / canvas.width * 100);
      result.focusY = Math.round(sy / canvas.height * 100);
      result.saturation = maxSat;
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
    const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // ── Shell detection ────────────────────────────────────────────────────────
  let currentShell = detectShell();

  function detectShell() {
    const html = document.documentElement;
    const cls = html.className;
    if (typeof cls === 'string' && (cls.includes('electron-light') || cls.includes('light-mode'))) return 'light';
    const dk = html.getAttribute('data-theme');
    if (dk && dk.toLowerCase().includes('light')) return 'light';
    return 'dark';
  }

  // ── Theme application ─────────────────────────────────────────────────────
  // This receives the compiled CSS (with resolved selectors) from CDP.
  // It only sets dynamic CSS custom properties and data attributes.

  function applyTheme(meta) {
    const html = document.documentElement;
    const isDark = currentShell === 'dark';

    // Mark skin as active
    html.setAttribute('data-dream-skin', 'active');
    html.setAttribute('data-dream-shell', currentShell);

    // Image analysis & adaptive palette
    let bgData = meta.backgroundBase64;

    // Check sessionStorage for large images
    if (!bgData && meta._bgFromStorage) {
      try { bgData = sessionStorage.getItem('__dreamSkin_bg'); } catch (_) {}
    }

    if (bgData) {
      const analysis = analyzeImage(bgData);

      // Set data attributes for CSS to use
      html.setAttribute('data-dream-art-safe', analysis.side);
      html.setAttribute('data-dream-art-focus-x', analysis.focusX + '%');
      html.setAttribute('data-dream-art-focus-y', analysis.focusY + '%');
      html.setAttribute('data-dream-art-position', `${analysis.focusX}% ${analysis.focusY}%`);
      html.setAttribute('data-dream-task-mode', meta.taskMode || 'immersive');
      html.setAttribute('data-dream-art-task-mode', meta.taskMode || 'immersive');
      html.setAttribute('data-dream-art', `url(${bgData})`);

      // Tagline element in home hero
      if (meta.tagline) {
        let tagEl = document.querySelector('.ds-tagline');
        if (!tagEl) {
          tagEl = document.createElement('span');
          tagEl.className = 'ds-tagline';
          const heroCard = document.querySelector(SELECTORS.homeRoute + ' > div:first-child > div:first-child > div:first-child');
          if (heroCard) heroCard.appendChild(tagEl);
        }
        tagEl.textContent = meta.tagline;
      }

      // Adaptive accent palette
      const accent = analysis.accentRgb;
      const accentHex = rgbToHex(accent[0], accent[1], accent[2]);
      const secondary = accent.map(v => Math.round(v * 0.88));
      const highlight = accent.map(v => Math.round(v * 0.72));
      const secondaryHex = rgbToHex(...secondary);
      const highlightHex = rgbToHex(...highlight);

      const root = document.documentElement;
      root.style.setProperty('--ds-accent-rgb', `${accent[0]} ${accent[1]} ${accent[2]}`);
      root.style.setProperty('--ds-accent', accentHex);
      root.style.setProperty('--ds-accent-soft', accentHex + '33');
      root.style.setProperty('--ds-secondary-rgb', `${secondary[0]} ${secondary[1]} ${secondary[2]}`);
      root.style.setProperty('--ds-secondary', secondaryHex);
      root.style.setProperty('--ds-highlight-rgb', `${highlight[0]} ${highlight[1]} ${highlight[2]}`);
      root.style.setProperty('--ds-highlight', highlightHex);

      if (!hasCSSSupports) {
        // Fallback for browsers without :has(): hide art overlays in thread views
        // by adding a class we can target
        const threadEl = document.querySelector('[class*="message"], article, [role="main"]');
        if (threadEl && !document.querySelector('[class*="home"]')) {
          html.setAttribute('data-dream-no-has', 'true');
        }
      }
    }

    // Dynamic effects
    initDynamicEffects(meta.dynamic);
  }

  function removeTheme() {
    const html = document.documentElement;
    html.removeAttribute('data-dream-skin');
    html.removeAttribute('data-dream-shell');
    html.removeAttribute('data-dream-art');
    html.removeAttribute('data-dream-art-safe');
    html.removeAttribute('data-dream-art-focus-x');
    html.removeAttribute('data-dream-art-focus-y');
    html.removeAttribute('data-dream-art-position');
    html.removeAttribute('data-dream-task-mode');
    html.removeAttribute('data-dream-art-task-mode');
    html.removeAttribute('data-dream-no-has');
    html.removeAttribute('data-dream-dynamic');
    const tagEl = document.querySelector('.ds-tagline');
    if (tagEl) tagEl.remove();
    try { sessionStorage.removeItem('__dreamSkin_bg'); } catch (_) {}
    clearDynamicEffects();
  }

  // ── Dynamic effects engine ────────────────────────────────────────────────
  let dynamicCleanup = null;
  let mouseTracker = null;
  let sparkleTimer = null;
  let glowElements = [];

  function createParticle(shellMain) {
    const particle = document.createElement('div');
    particle.className = 'ds-particle';
    const size = 2 + Math.random() * 5;
    const isAccent = Math.random() < 0.3;
    const root = document.documentElement;
    const accentRgb = getComputedStyle(root).getPropertyValue('--ds-accent-rgb').trim() || '130 152 163';
    const textRgb = getComputedStyle(root).getPropertyValue('--ds-text-rgb').trim() || '237 240 241';

    particle.style.width = size + 'px';
    particle.style.height = size + 'px';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = '100%';
    particle.style.setProperty('--ds-particle-duration', (6 + Math.random() * 10) + 's');
    particle.style.setProperty('--ds-particle-delay', (Math.random() * 8) + 's');
    particle.style.setProperty('--ds-particle-opacity', (0.15 + Math.random() * 0.5).toFixed(2));
    particle.style.setProperty('--ds-particle-drift-x', ((-15 + Math.random() * 30)) + 'px');
    particle.style.setProperty('--ds-particle-drift-y', (10 + Math.random() * 40) + 'px');
    particle.style.background = isAccent
      ? `rgb(${accentRgb} / 0.7)`
      : `rgb(${textRgb} / 0.45)`;
    particle.style.boxShadow = isAccent
      ? `0 0 ${size * 2}px rgb(${accentRgb} / 0.25)`
      : `0 0 ${size}px rgb(${textRgb} / 0.12)`;

    shellMain.appendChild(particle);

    // Remove after animation
    const duration = parseFloat(particle.style.getPropertyValue('--ds-particle-duration'));
    const delay = parseFloat(particle.style.getPropertyValue('--ds-particle-delay'));
    setTimeout(() => {
      if (particle.parentNode) particle.parentNode.removeChild(particle);
    }, (duration + delay) * 1000 + 500);
  }

  function createGlowBlob(shellMain) {
    const glow = document.createElement('div');
    glow.className = 'ds-glow';
    const size = 150 + Math.random() * 350;
    const isAccent = Math.random() < 0.5;
    const root = document.documentElement;
    const accentRgb = getComputedStyle(root).getPropertyValue('--ds-accent-rgb').trim() || '130 152 163';
    const panelRgb = getComputedStyle(root).getPropertyValue('--ds-panel-rgb').trim() || '25 28 34';

    glow.style.width = size + 'px';
    glow.style.height = size + 'px';
    glow.style.left = Math.random() * 80 + '%';
    glow.style.top = Math.random() * 80 + '%';
    glow.style.setProperty('--ds-glow-duration', (8 + Math.random() * 16) + 's');
    glow.style.animationDelay = (Math.random() * 6) + 's';
    glow.style.background = isAccent
      ? `radial-gradient(circle, rgb(${accentRgb} / 0.15) 0%, transparent 70%)`
      : `radial-gradient(circle, rgb(${panelRgb} / 0.25) 0%, transparent 70%)`;

    shellMain.appendChild(glow);
    glowElements.push(glow);
  }

  function createSparkle(shellMain, x, y) {
    const sparkle = document.createElement('div');
    sparkle.className = 'ds-sparkle';
    sparkle.style.left = x + 'px';
    sparkle.style.top = y + 'px';
    shellMain.appendChild(sparkle);
    setTimeout(() => { if (sparkle.parentNode) sparkle.parentNode.removeChild(sparkle); }, 500);
  }

  function initDynamicEffects(meta) {
    // Clean up previous
    clearDynamicEffects();

    if (!meta || !meta.dynamic) return;

    const shellMain = document.querySelector(SELECTORS.shellMain);
    if (!shellMain) return;

    // Set attribute
    document.documentElement.setAttribute('data-dream-dynamic', 'on');

    // Create glow blobs
    const glowCount = meta.dynamic.glowCount || 3;
    for (let i = 0; i < glowCount; i++) {
      createGlowBlob(shellMain);
    }

    // Create mouse vignette
    const vignette = document.createElement('div');
    vignette.className = 'ds-mouse-vignette';
    shellMain.appendChild(vignette);
    glowElements.push(vignette);

    // Mouse tracker for parallax + vignette
    let mouseTimeout;
    shellMain.addEventListener('mousemove', (e) => {
      clearTimeout(mouseTimeout);
      const rect = shellMain.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
      const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);

      // Update vignette
      if (vignette.parentNode) {
        vignette.style.setProperty('--ds-mouse-x', x + '%');
        vignette.style.setProperty('--ds-mouse-y', y + '%');
      }

      // Parallax on background art
      const art = document.querySelector('[data-dream-art]');
      if (art && art.offsetParent) {
        const px = ((e.clientX - rect.left) / rect.width - 0.5) * 8;
        const py = ((e.clientY - rect.top) / rect.height - 0.5) * 6;
        art.style.backgroundPosition = `calc(var(--ds-art-position) + ${px}px) calc(var(--ds-art-position) + ${py}px)`;
      }
    });

    // Sparkle on click
    shellMain.addEventListener('click', (e) => {
      for (let i = 0; i < 6; i++) {
        setTimeout(() => {
          createSparkle(shellMain,
            e.clientX - shellMain.getBoundingClientRect().left + (Math.random() - 0.5) * 30,
            e.clientY - shellMain.getBoundingClientRect().top + (Math.random() - 0.5) * 30
          );
        }, i * 25);
      }
    });

    // Particle spawner
    const particleCount = meta.dynamic.particleCount || 35;
    const spawnInterval = setInterval(() => {
      const particles = shellMain.querySelectorAll('.ds-particle');
      const maxCount = Math.round(particleCount * (getComputedStyle(root).getPropertyValue('--ds-particle-speed') || '1'));
      if (particles.length < maxCount) {
        createParticle(shellMain);
      }
    }, 600);

    dynamicCleanup = () => {
      clearInterval(spawnInterval);
      clearTimeout(mouseTimeout);
      document.documentElement.removeAttribute('data-dream-dynamic');
      document.documentElement.removeAttribute('data-dream-dynamic-particles');
      glowElements.forEach(el => { if (el.parentNode) el.parentNode.removeChild(el); });
      glowElements = [];
      shellMain.querySelectorAll('.ds-particle, .ds-sparkle').forEach(el => el.remove());
      if (vignette.parentNode) vignette.remove();
    };
  }

  function clearDynamicEffects() {
    if (dynamicCleanup) {
      dynamicCleanup();
      dynamicCleanup = null;
    }
  }
  function watchShellChange() {
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      const newShell = detectShell();
      if (newShell !== currentShell) {
        currentShell = newShell;
        const meta = window.__dreamSkinThemeMeta__;
        if (meta) applyTheme(meta);
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
    if (document.getElementById('dream-skin-injected')) return;

    // Expose API for CDP injector communication
    window.__dreamSkinApi = {
      apply: (meta) => {
        window.__dreamSkinThemeMeta__ = meta;
        applyTheme(meta);
      },
      remove: () => {
        window.__dreamSkinThemeMeta__ = null;
        removeTheme();
      },
      analyze: (base64) => analyzeImage(base64),
      getShell: detectShell,
      getSelectors: () => {
        const tokens = {};
        for (const [token, key] of Object.entries(SELECTORS)) {
          tokens[token] = key;
        }
        return tokens;
      },
    };

    // Apply initial theme if meta was set before boot
    if (window.__dreamSkinThemeMeta__) {
      applyTheme(window.__dreamSkinThemeMeta__);
    }

    watchShellChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
