/**
 * Dream Skin — Renderer Injector (Claude Desktop)
 *
 * IIFE running in the renderer via CDP Runtime.evaluate.
 * Receives pre-assembled data as parameters — no globals needed.
 *
 * Handles: CSS installation, image analysis, adaptive palette, dynamic effects,
 *          shell change watching, and cleanup.
 */

((cssText, artDataUrl, themeConfig) => {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const K = Object.freeze({
    STATE:      '__CODEX_DREAM_SKIN_STATE__',
    DISABLED:   '__CODEX_DREAM_SKIN_DISABLED__',
    STYLE_REG:  '__CODEX_DREAM_SKIN_STYLE_SHEETS__',
    ANALYSIS:   '__CODEX_DREAM_SKIN_ANALYSIS_CACHE__',
    STYLE_ID:   'codex-dream-skin-style',
  });

  const ROOT_ATTRS = [
    'data-dream-skin','data-dream-shell',
    'data-dream-style',
    'data-dream-art-wide','data-dream-art-safe','data-dream-task-mode',
    'data-dream-art-safe-area','data-dream-art-task-mode','data-dream-art-aspect',
    'data-dream-art-ready',
  ];

  const THEME_VARS = [
    '--ds-bg','--ds-panel','--ds-panel-2','--ds-green','--ds-lime',
    '--ds-cyan','--ds-purple','--ds-text','--ds-muted','--ds-line',
    '--ds-bg-rgb','--ds-panel-rgb','--ds-panel-2-rgb',
    '--ds-accent-rgb','--ds-accent-alt-rgb','--ds-secondary-rgb','--ds-highlight-rgb',
    '--ds-text-rgb','--ds-muted-rgb','--ds-line-rgb',
    '--ds-accent','--ds-accent-soft','--ds-secondary','--ds-highlight','--ds-on-accent',
    '--dream-art-focus-x','--dream-art-focus-y','--dream-art-position',
    '--dream-skin-focus-x','--dream-skin-focus-y','--dream-skin-art-position',
    '--dream-skin-name','--dream-skin-tagline','--dream-skin-project-prefix',
    '--dream-skin-project-label','--dream-skin-brand-subtitle',
    '--dream-skin-status','--dream-skin-quote','--dream-skin-art',
  ];

  const HUE_BINS = 24;

  // ── Config ─────────────────────────────────────────────────────────────────

  const THEME  = themeConfig && typeof themeConfig === 'object' ? themeConfig : {};
  const ART    = THEME.art  && typeof THEME.art  === 'object' ? THEME.art : {};
  const ART_KEY = typeof THEME.artKey === 'string' ? THEME.artKey : null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setAttr(el, name, value) {
    if (el.getAttribute(name) === String(value)) return false;
    if (value === null || value === undefined || value === '') {
      el.removeAttribute(name);
    } else {
      el.setAttribute(name, String(value));
    }
    return true;
  }

  function setVar(name, value) {
    if (document.documentElement.style.getPropertyValue(name) === String(value)) return false;
    if (value === null || value === undefined || value === '') {
      document.documentElement.style.removeProperty(name);
    } else {
      document.documentElement.style.setProperty(name, String(value));
    }
    return true;
  }

  function setVars(pairs) {
    let wrote = 0;
    for (const [name, value] of Object.entries(pairs)) {
      if (setVar(name, value)) wrote++;
    }
    return wrote;
  }

  // ── Shell Detection ────────────────────────────────────────────────────────

  function detectShell() {
    const html = document.documentElement;
    if (html.classList.contains('electron-dark')) return 'dark';
    if (html.classList.contains('electron-light')) return 'light';
    if (html.hasAttribute('data-theme')) {
      return html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function resolvedShell() {
    const appearance = THEME.appearance || 'auto';
    if (appearance !== 'auto') return appearance;
    return detectShell();
  }

  // ── State Management ──────────────────────────────────────────────────────

  function getState() {
    try { return window[K.STATE] || null; } catch (_) { return null; }
  }

  function setState(state) {
    try { window[K.STATE] = state; } catch (_) {}
  }

  function initState(installToken) {
    if (window[K.STATE]) {
      const prev = window[K.STATE];
      if (prev.installToken === installToken && prev.styleMode && prev.rootPasses > 0) {
        return prev;
      }
    }
    const state = {
      installToken,
      styleMode: null,
      shell: null,
      rootPasses: 0,
      routePasses: 0,
      layoutReads: 0,
      attrWrites: 0,
      styleWrites: 0,
      styleRepairs: 0,
      analysis: null,
      artCacheKey: ART_KEY,
    };
    setState(state);
    return state;
  }

  // ── Style Installation ─────────────────────────────────────────────────────

  function installCSS(rawCSS) {
    const state = getState();
    if (!state || window[K.DISABLED]) return 'disabled';

    // Remove previous style element
    const oldEl = document.getElementById(K.STYLE_ID);
    if (oldEl) oldEl.remove();

    let styleMode;

    // Try adoptedStyleSheets (CSSStyleSheet API) — preferred
    if (typeof CSSStyleSheet !== 'undefined' && typeof document.adoptedStyleSheets !== 'undefined') {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(rawCSS);
        const reg = window[K.STYLE_REG] || new Set();
        reg.add(sheet);
        try { window[K.STYLE_REG] = reg; } catch (_) {}

        const current = document.adoptedStyleSheets;
        if (!current.includes(sheet)) {
          document.adoptedStyleSheets = [...current, sheet];
        }
        styleMode = 'adopted';
        if (state) state.styleMode = 'adopted';
        return 'adopted';
      } catch (e) {
        console.warn('[DreamSkin] adoptedStyleSheets failed, falling back:', e.message);
      }
    }

    // Fallback: <style> element injection
    try {
      const styleEl = document.createElement('style');
      styleEl.id = K.STYLE_ID;
      styleEl.textContent = rawCSS;
      const head = document.head || document.documentElement;
      head.appendChild(styleEl);
      styleMode = 'style';
      if (state) state.styleMode = 'style';
      return 'style';
    } catch (e) {
      console.warn('[DreamSkin] Style element injection failed:', e.message);
      return 'error';
    }
  }

  // ── Image Analysis ────────────────────────────────────────────────────────

  function analyzeArt(artUrl) {
    const state = getState();
    if (!artUrl || !artUrl.startsWith('data:')) return null;

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000);

      try {
        const img = new Image();
        const objectUrl = URL.createObjectURL(dataUrlToBlob(artUrl));

        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          try { clearTimeout(timer); } catch (_) {}

          const maxDim = 96;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          if (w > maxDim || h > maxDim) {
            const scale = maxDim / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          let data;
          try { data = ctx.getImageData(0, 0, w, h).data; }
          catch (_) { return resolve(null); }

          // Color binning: 24 hue bins weighted by saturation
          const hueBins = new Float32Array(HUE_BINS);
          let totalSat = 0;
          let satX = 0, satY = 0;
          const pixels = w * h;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const l = (max + min) / 2;
            const s = max === min ? 0 : (max - min) / (max + min || 1);

            if (s > 0.1) {
              let h = 0;
              if (max === r) h = ((g - b) / (max - min || 1)) * 60;
              else if (max === g) h = (2 + (b - r) / (max - min || 1)) * 60;
              else h = (4 + (r - g) / (max - min || 1)) * 60;
              if (h < 0) h += 360;

              const bin = Math.floor(h / (360 / HUE_BINS)) % HUE_BINS;
              hueBins[bin] += s;
              totalSat += s;
              const x = (i / 4) % w;
              const y = Math.floor((i / 4) / w);
              satX += x * s;
              satY += y * s;
            }
          }

          // Focus point: center of highest saturation area
          let focusX = w / 2, focusY = h / 2;
          if (totalSat > 0) {
            focusX = satX / totalSat;
            focusY = satY / totalSat;
          }

          // Safe area: information density comparison (left vs right zones)
          const leftZone = { variance: 0, edges: 0, count: 0 };
          const rightZone = { variance: 0, edges: 0, count: 0 };
          const midX = Math.floor(w / 2);

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const r = data[idx], g = data[idx + 1], b = data[idx + 2];
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              const variance = (lum - 128) ** 2;

              const zone = x < midX ? leftZone : rightZone;
              zone.variance += variance;
              zone.count++;

              // Simple edge detection (compare with neighbors)
              if (x > 0 && y > 0) {
                const prevIdx = (y * w + (x - 1)) * 4;
                const prevLum = 0.299 * data[prevIdx] + 0.587 * data[prevIdx + 1] + 0.114 * data[prevIdx + 2];
                if (Math.abs(lum - prevLum) > 30) zone.edges++;
              }
            }
          }

          const leftInfo = leftZone.count > 0 ? leftZone.variance / leftZone.count + leftZone.edges * 0.01 : 0;
          const rightInfo = rightZone.count > 0 ? rightZone.variance / rightZone.count + rightZone.edges * 0.01 : 0;

          let safeArea;
          if (Math.abs(leftInfo - rightInfo) < 0.5) {
            safeArea = 'center';
          } else if (leftInfo > rightInfo) {
            safeArea = 'left';
          } else {
            safeArea = 'right';
          }

          // Brightness (average luminance)
          let totalLum = 0;
          for (let i = 0; i < data.length; i += 4) {
            totalLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          }
          const brightness = totalLum / pixels;

          // Dominant hue
          let maxBin = 0, maxVal = 0;
          for (let b = 0; b < 24; b++) {
            if (hueBins[b] > maxVal) { maxVal = hueBins[b]; maxBin = b; }
          }
          const dominantHue = (maxBin * 15 + 7.5) % 360;

          resolve({
            hueBins: Array.from(hueBins),
            dominantHue,
            saturation: totalSat / pixels,
            focusX: focusX / w,
            focusY: focusY / h,
            safeArea,
            brightness,
            width: w,
            height: h,
          });

        };

        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
        img.src = objectUrl;
      } catch (_) {
        resolve(null);
      }
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/);
    const b64 = atob(parts[1]);
    const arr = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) arr[i] = b64.charCodeAt(i);
    return new Blob([arr], { type: mime ? mime[1] : 'image/png' });
  }

  // ── Adaptive Palette ──────────────────────────────────────────────────────

  function makeAdaptivePalette(analysis, shell) {
    const colors = THEME.colors || {};
    const themePalette = {
      background: colors.background || '#0a0a0f',
      panel: colors.panel || '#14141f',
      panelAlt: colors.panelAlt || '#1a1a2e',
      accent: colors.accent || '#7c3aed',
      accentAlt: colors.accentAlt || '#a78bfa',
      secondary: colors.secondary || '#06b6d4',
      highlight: colors.highlight || '#f59e0b',
      text: colors.text || '#e2e8f0',
      muted: colors.muted || '#64748b',
      line: colors.line || '#1e293b',
    };

    // If auto appearance, don't let bright wallpaper flip the shell detection
    const isDarkShell = shell === 'dark';

    // Image-derived accent tweaking
    if (analysis && analysis.saturation > 0.05) {
      const hue = analysis.dominantHue;
      const sat = Math.min(analysis.saturation * 2, 1);
      const lum = isDarkShell ? 0.55 : 0.45;

      // Shift accent hue toward dominant image hue
      themePalette.accent = hslToHex(hue, sat, lum);
      themePalette.accentAlt = hslToHex((hue + 30) % 360, sat * 0.7, lum);
      themePalette.secondary = hslToHex((hue + 180) % 360, sat * 0.6, lum * 0.9);
    }

    // Ensure text contrast
    if (isDarkShell) {
      themePalette.background = adjustBrightness(themePalette.background, analysis ? (analysis.brightness > 0.6 ? -0.05 : -0.15) : -0.15);
      themePalette.panel = adjustBrightness(themePalette.panel, analysis ? (analysis.brightness > 0.6 ? -0.03 : -0.1) : -0.1);
      themePalette.text = ensureContrast(themePalette.text, themePalette.background, '#ffffff', '#1a1a2e');
    } else {
      themePalette.background = adjustBrightness(themePalette.background, analysis ? (analysis.brightness < 0.3 ? 0.05 : 0.15) : 0.15);
      themePalette.panel = adjustBrightness(themePalette.panel, analysis ? (analysis.brightness < 0.3 ? 0.03 : 0.1) : 0.1);
      themePalette.text = ensureContrast(themePalette.text, themePalette.background, '#1a1a2e', '#ffffff');
    }

    return themePalette;
  }

  function hslToHex(h, s, l) {
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r, g, b;
    if (h < 60)      { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function hexToRgb(hex) {
    const m = hex.replace('#', '').match(/.{2}/g);
    if (!m || m.length < 3) return { r: 128, g: 128, b: 128 };
    return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
  }

  function rgbToHex(r, g, b) {
    const toH = v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${toH(r)}${toH(g)}${toH(b)}`;
  }

  function adjustBrightness(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(r + amount * 255, g + amount * 255, b + amount * 255);
  }

  function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function ensureContrast(fg, bgHex, darkFallback, lightFallback) {
    const bg = hexToRgb(bgHex);
    const fgC = hexToRgb(fg);
    const fgLum = luminance(fgC.r, fgC.g, fgC.b);
    const bgLum = luminance(bg.r, bg.g, bg.b);
    const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
    if (ratio < 4.5) {
      return bgLum > 0.5 ? darkFallback : lightFallback;
    }
    return fg;
  }

  // ── Dynamic Effects ───────────────────────────────────────────────────────

  function createParticle() {
    const el = document.createElement('div');
    el.className = 'ds-particle';
    const size = 2 + Math.random() * 4;
    el.style.cssText = `
      position:fixed; width:${size}px; height:${size}px;
      border-radius:50%; pointer-events:none; z-index:99999;
      left:${Math.random() * 100}vw; top:${Math.random() * 100}vh;
      opacity:${0.2 + Math.random() * 0.5};
      background: ${['rgba(124,58,237,0.6)','rgba(6,182,212,0.5)','rgba(167,139,250,0.4)','rgba(255,255,255,0.3)'][Math.floor(Math.random()*4)]};
      animation: ds-particle-float ${8 + Math.random() * 12}s linear infinite;
      animation-delay: -${Math.random() * 20}s;
    `;
    document.body.appendChild(el);
    return el;
  }

  function createGlowBlob() {
    const el = document.createElement('div');
    el.className = 'ds-glow';
    const size = 200 + Math.random() * 400;
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    el.style.cssText = `
      position:fixed; width:${size}px; height:${size}px;
      border-radius:50%; pointer-events:none; z-index:0;
      left:${x}vw; top:${y}vh;
      background: radial-gradient(circle, rgba(124,58,237,0.12) 0%, rgba(6,182,212,0.06) 50%, transparent 70%);
      filter: blur(40px);
      animation: ds-glow-drift ${20 + Math.random() * 30}s ease-in-out infinite alternate;
      animation-delay: -${Math.random() * 30}s;
    `;
    document.body.appendChild(el);
    return el;
  }

  function createSparkle(x, y) {
    const el = document.createElement('div');
    el.className = 'ds-sparkle';
    el.style.cssText = `
      position:fixed; left:${x}px; top:${y}px;
      width:6px; height:6px; border-radius:50%;
      background: rgba(255,255,255,0.9);
      pointer-events:none; z-index:100000;
      box-shadow: 0 0 6px 2px rgba(124,58,237,0.6);
      animation: ds-sparkle 0.8s ease-out forwards;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
    return el;
  }

  function injectDynamicStyles() {
    const id = 'dream-skin-dynamic-styles';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes ds-particle-float {
        0%   { transform: translateY(0) translateX(0); opacity: 0; }
        10%  { opacity: 0.6; }
        90%  { opacity: 0.1; }
        100% { transform: translateY(-100vh) translateX(${(Math.random()-0.5)*200}px); opacity: 0; }
      }
      @keyframes ds-glow-drift {
        0%   { transform: translate(0, 0) scale(1); }
        100% { transform: translate(${(Math.random()-0.5)*100}px, ${(Math.random()-0.5)*100}px) scale(1.3); }
      }
      @keyframes ds-sparkle {
        0%   { transform: scale(1); opacity: 1; }
        50%  { transform: scale(2); opacity: 0.5; }
        100% { transform: scale(0) translateY(-20px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function setupDynamicEffects(analysis) {
    injectDynamicStyles();

    // Particles
    const particles = [];
    for (let i = 0; i < 30; i++) {
      particles.push(createParticle());
    }

    // Glow blobs
    const blobs = [];
    for (let i = 0; i < 4; i++) {
      blobs.push(createGlowBlob());
    }

    // Mouse interaction
    const handleClick = (e) => {
      createSparkle(e.clientX, e.clientY);
      for (let i = 0; i < 3; i++) {
        setTimeout(() => createSparkle(
          e.clientX + (Math.random() - 0.5) * 40,
          e.clientY + (Math.random() - 0.5) * 40
        ), i * 50);
      }
    };

    // Mouse vignette
    let vignette = document.querySelector('.ds-mouse-vignette');
    if (!vignette) {
      vignette = document.createElement('div');
      vignette.className = 'ds-mouse-vignette';
      vignette.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 1;
        background: radial-gradient(circle 400px at 50% 50%, rgba(124,58,237,0.06) 0%, transparent 70%);
        transition: background 0.3s ease;
      `;
      document.body.appendChild(vignette);
    }

    const handleMouseMove = (e) => {
      if (vignette) {
        vignette.style.background = `radial-gradient(circle 400px at ${e.clientX}px ${e.clientY}px, rgba(124,58,237,0.08) 0%, transparent 70%)`;
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('mousemove', handleMouseMove, true);

    return {
      particles,
      blobs,
      vignette,
      cleanup() {
        particles.forEach(p => { try { p.remove(); } catch (_) {} });
        blobs.forEach(b => { try { b.remove(); } catch (_) {} });
        if (vignette) { try { vignette.remove(); } catch (_) {} }
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('mousemove', handleMouseMove, true);
        const dynStyle = document.getElementById('dream-skin-dynamic-styles');
        if (dynStyle) dynStyle.remove();
      }
    };
  }

  // ── Choten / Internet Angel Decorative Layer ──────────────────────────────

  function isChotenTheme() {
    const id = (THEME.id || THEME.name || '').toLowerCase();
    const desc = (THEME.description || '').toLowerCase();
    return /internet[- ]angel|choten|超天/.test(id + ' ' + desc);
  }

  function setupChotenDecorations() {
    if (!isChotenTheme()) return null;
    document.documentElement.setAttribute('data-dream-choten', 'true');

    const stage = document.createElement('div');
    stage.className = 'ds-angel-stage';
    stage.innerHTML = `
      <i class="ds-angel-halo"></i>
      <div class="ds-angel-live-ticker">
        <b>&hearts; LIVE CHAT</b><span>
          <i>CHOTEN ONLINE 9999+</i>
          <i>BLESS YOUR CODE</i>
          <i>INTERNET ANGEL FOREVER</i>
          <i>+1 +1 +1</i>
        </span>
      </div>
      <div class="ds-angel-spark-field">
        ${Array.from({length: 8}, () =>
          `<i style="left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:-${Math.random()*5}s"></i>`
        ).join('')}
      </div>
      <div class="ds-angel-id-chip"><b>KANGEL.SYS</b><span>STREAM ID 01</span><i>ONLINE</i></div>
      <div class="ds-angel-heartbeat"><b>LOVE SIGNAL</b><span></span><em>98%</em></div>
      <div class="ds-angel-now-playing"><span>&#9835; NOW PLAYING</span><b>INTERNET OVERDOSE</b></div>
      <div class="ds-angel-signal-wave"></div>
    `;
    document.body.appendChild(stage);

    return {
      cleanup() { try { stage.remove(); } catch (_) {} }
    };
  }

  // ── Main Ensure ───────────────────────────────────────────────────────────

  const aCache = new Map();

  function ensureMain(opts) {
    const state = getState();
    if (!state) return;

    state.rootPasses++;
    state.layoutReads++;
    const html = document.documentElement;
    const body = document.body;

    if (!body) return;

    // Shell
    const shell = resolvedShell();
    if (setAttr(html, 'data-dream-shell', shell)) state.attrWrites++;

    if (state.shell !== shell) {
      state.shell = shell;
      state.styleRepairs++;
    }

    // Active flag
    if (setAttr(html, 'data-dream-skin', 'active')) state.attrWrites++;

    // ── Theme ──────────────────────────────────────────────────────────────

    const palette = makeAdaptivePalette(state.analysis, shell);

    // Brand text
    if (THEME.name && setAttr(html, 'data-dream-skin-name', THEME.name)) state.attrWrites++;
    if (THEME.tagline && setAttr(html, 'data-dream-skin-tagline', THEME.tagline)) state.attrWrites++;
    if (THEME.style && setAttr(html, 'data-dream-style', THEME.style)) state.attrWrites++;
    if (THEME.projectPrefix && setAttr(html, 'data-dream-skin-project-prefix', THEME.projectPrefix)) state.attrWrites++;
    if (THEME.projectLabel && setAttr(html, 'data-dream-skin-project-label', THEME.projectLabel)) state.attrWrites++;
    if (THEME.brandSubtitle && setAttr(html, 'data-dream-skin-brand-subtitle', THEME.brandSubtitle)) state.attrWrites++;
    if (THEME.statusText && setAttr(html, 'data-dream-skin-status', THEME.statusText)) state.attrWrites++;
    if (THEME.quote && setAttr(html, 'data-dream-skin-quote', THEME.quote)) state.attrWrites++;
    if (artDataUrl && setAttr(html, 'data-dream-skin-art', artDataUrl)) state.attrWrites++;

    // ── Art positioning ────────────────────────────────────────────────────

    if (state.analysis) {
      const a = state.analysis;
      const fx = Math.round(a.focusX * 100);
      const fy = Math.round(a.focusY * 100);

      if (setAttr(html, 'data-dream-art-wide', a.wide ? 'true' : 'false')) state.attrWrites++;
      if (setAttr(html, 'data-dream-art-safe', a.safeArea || 'center')) state.attrWrites++;
      if (setAttr(html, 'data-dream-art-aspect', String(a.aspect || 1))) state.attrWrites++;

      setVar('--dream-skin-focus-x', `${fx}%`);
      setVar('--dream-skin-focus-y', `${fy}%`);
      setVar('--dream-art-focus-x', `${fx}%`);
      setVar('--dream-art-focus-y', `${fy}%`);
    }

    // ── Colors ─────────────────────────────────────────────────────────────

    const rgbPairs = {
      '--ds-bg-rgb': rgbStr(palette.background),
      '--ds-panel-rgb': rgbStr(palette.panel),
      '--ds-panel-2-rgb': rgbStr(palette.panelAlt),
      '--ds-accent-rgb': rgbStr(palette.accent),
      '--ds-accent-alt-rgb': rgbStr(palette.accentAlt),
      '--ds-secondary-rgb': rgbStr(palette.secondary),
      '--ds-highlight-rgb': rgbStr(palette.highlight),
      '--ds-text-rgb': rgbStr(palette.text),
      '--ds-muted-rgb': rgbStr(palette.muted),
      '--ds-line-rgb': rgbStr(palette.line),
    };

    const wrote = setVars({
      ...rgbPairs,
      '--ds-bg': palette.background,
      '--ds-panel': palette.panel,
      '--ds-panel-2': palette.panelAlt,
      '--ds-green': '#10b981',
      '--ds-lime': '#84cc16',
      '--ds-cyan': palette.secondary,
      '--ds-purple': palette.accent,
      '--ds-text': palette.text,
      '--ds-muted': palette.muted,
      '--ds-line': palette.line,
      '--ds-accent': palette.accent,
      '--ds-accent-soft': palette.accentAlt,
      '--ds-secondary': palette.secondary,
      '--ds-highlight': palette.highlight,
      '--ds-on-accent': '#ffffff',
      '--dream-art-position': state.analysis ? `${Math.round(state.analysis.focusX * 100)}% ${Math.round(state.analysis.focusY * 100)}%` : '50% 50%',
      '--dream-skin-art-position': state.analysis ? `${Math.round(state.analysis.focusX * 100)}% ${Math.round(state.analysis.focusY * 100)}%` : '50% 50%',
    });
    state.styleWrites += wrote;
  }

  function rgbStr(hex) {
    const m = hex.replace('#', '').match(/.{2}/g);
    if (!m || m.length < 3) return '10,11,15';
    return `${parseInt(m[0], 16)},${parseInt(m[1], 16)},${parseInt(m[2], 16)}`;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  function cleanup() {
    const html = document.documentElement;

    // Remove all data-dream-* attributes
    for (const attr of ROOT_ATTRS) {
      html.removeAttribute(attr);
    }

    // Remove CSS custom properties
    for (const v of THEME_VARS) {
      html.style.removeProperty(v);
    }

    // Remove adopted style sheets we registered
    try {
      const reg = window[K.STYLE_REG];
      if (reg) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => !reg.has(s));
        reg.clear();
      }
    } catch (_) {}

    // Remove style element
    const styleEl = document.getElementById(K.STYLE_ID);
    if (styleEl) styleEl.remove();

    // Remove dynamic styles
    const dynStyle = document.getElementById('dream-skin-dynamic-styles');
    if (dynStyle) dynStyle.remove();

    // Remove vignette
    const vignette = document.querySelector('.ds-mouse-vignette');
    if (vignette) vignette.remove();

    // Remove particles and glows
    document.querySelectorAll('.ds-particle, .ds-glow, .ds-sparkle').forEach(el => el.remove());

    // Revoke art object URL
    if (window[K.STATE] && window[K.STATE].artObjectUrl) {
      try { URL.revokeObjectURL(window[K.STATE].artObjectUrl); } catch (_) {}
    }

    // Reset install flag
    window.__DREAM_SKIN_EARLY_APPLIED__ = false;

    // Clear state
    try { window[K.STATE] = null; } catch (_) {}
  }

  // ── Shell Watcher ─────────────────────────────────────────────────────────

  let observer = null;
  let observerCleanup = null;

  function startShellWatcher() {
    if (observer) return;

    observer = new MutationObserver(() => {
      const state = getState();
      if (!state) return;
      const currentShell = resolvedShell();
      if (state.shell !== currentShell) {
        state.styleRepairs++;
        ensureMain();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
  }

  function stopShellWatcher() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  // ── Install ──────────────────────────────────────────────────────────────

  function install() {
    if (!cssText || window[K.DISABLED]) {
      return { installed: false, reason: 'no-css-or-disabled' };
    }

    const installToken = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const state = initState(installToken);

    if (state.installToken === installToken && state.rootPasses > 0 && state.styleMode) {
      // Re-entry with same token — just re-apply
      return ensureAndRun({ root: true, reentry: true });
    }

    // CSS installation
    const styleMode = installCSS(cssText);
    if (styleMode === 'error' || styleMode === 'disabled') {
      return { installed: false, styleMode, reason: 'install-failed' };
    }
    state.styleMode = styleMode;

    // Art object URL
    let artObjectUrl = null;
    if (artDataUrl) {
      try { artObjectUrl = URL.createObjectURL(dataUrlToBlob(artDataUrl)); } catch (_) {}
    }
    state.artObjectUrl = artObjectUrl;

    // Image analysis
    const artAnalysis = null;
    const analysisTimer = setTimeout(() => {
      const s = getState();
      if (s && s.installToken === installToken) {
        s.styleRepairs++;
        ensureMain({ root: true });
      }
    }, 200);

    state.analysisTimer = analysisTimer;

    const analysisPromise = analyzeArt(artDataUrl);
    analysisPromise.then((analysis) => {
      const state = getState();
      if (!analysis || state?.installToken !== installToken || window[K.DISABLED]) return;
      artAnalysis = analysis; state.analysis = analysis;
      if (ART_KEY) {
        aCache.set(ART_KEY, analysis);
        while (aCache.size > 8) aCache.delete(aCache.keys().next().value);
      }
      ensureMain({ root: true });
    }).catch(() => {});

    // Dynamic effects
    const effects = setupDynamicEffects(null);

    // Choten / Internet Angel decorative layer
    const chotenDecorations = setupChotenDecorations();

    // Shell watcher
    startShellWatcher();

    // Initial apply
    const result = ensureAndRun({ root: true, reentry: false });

    // Return state reference
    return {
      installed: true,
      styleMode,
      shell: state.shell,
      token: installToken,
    };
  }

  function ensureAndRun(opts) {
    const state = getState();
    if (!state) return null;

    const analysis = state.analysis;
    ensureMain(opts);

    return {
      rootPasses: state.rootPasses,
      routePasses: state.routePasses,
      layoutReads: state.layoutReads,
      attrWrites: state.attrWrites,
      styleWrites: state.styleWrites,
      styleRepairs: state.styleRepairs,
      styleMode: state.styleMode,
      shell: state.shell,
      analysis: !!analysis,
    };
  }

  // ── Entry Point ───────────────────────────────────────────────────────────

  install();
})(__DREAM_SKIN_CSS_JSON__, __DREAM_SKIN_ART_JSON__, __DREAM_SKIN_THEME_JSON__)
