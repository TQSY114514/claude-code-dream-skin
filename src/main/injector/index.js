const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');

// Token → selector key mapping (mirrors tools/sync-runtime-assets.mjs)
const TOKEN_MAP = {
  '__DREAM_SELECTOR_SHELL_MAIN__':        'shell-main',
  '__DREAM_SELECTOR_LEFT_PANEL__':        'left-panel',
  '__DREAM_SELECTOR_HEADER_TINT__':       'header-tint',
  '__DREAM_SELECTOR_COMPOSER_CHROME__':   'composer-chrome',
  '__DREAM_SELECTOR_HOME_ROUTE__':        'home-route',
  '__DREAM_SELECTOR_HOME_SUGGESTIONS__':  'home-suggestions',
  '__DREAM_SELECTOR_MARKDOWN__':          'markdown',
  '__DREAM_SELECTOR_MESSAGE__':           'message',
  '__DREAM_SELECTOR_CODE_BLOCK__':        'code-block',
  '__DREAM_SELECTOR_SEND_BUTTON__':       'send-button',
};

const SELECTORS = {
  'shell-main':       'main, [role="main"], [class*="content"]',
  'left-panel':       'aside, nav, [class*="sidebar"], [class*="Sidebar"], [class*="nav-"], [class*="Navigation"]',
  'header-tint':      'header, [class*="header"], [class*="Header"], [class*="top-bar"], [class*="TopBar"]',
  'composer-chrome':  '[contenteditable="true"], [role="textbox"], [class*="composer"], [class*="Composer"], [class*="input"], textarea',
  'home-route':       '[class*="home"], [class*="Home"], [class*="welcome"], [class*="Welcome"]',
  'home-suggestions': '[class*="suggestion"], [class*="Suggestion"], [class*="starter"], [class*="Starter"]',
  'markdown':         '[class*="markdown"], [class*="Markdown"], .markdown-body, [class*="prose"], article',
  'message':          '[class*="message"], [class*="Message"], [class*="chat-message"], [class*="ChatMessage"]',
  'code-block':       'pre, code, [class*="code"], [class*="Code"], pre[class*="language-"]',
  'send-button':      '[class*="send"], [class*="Submit"], [class*="submit"], button[type="submit"]',
};

/**
 * CDP-based CSS injector for Electron apps.
 *
 * Architecture:
 *   1. Injects COMPILED CSS (dream-skin-compiled.css + theme CSS) via CSS.addStyleSheet
 *      — this is the primary styling layer
 *   2. Injects renderer-inject.js via Runtime.evaluate (chunked) for dynamic features
 *      — image analysis, adaptive palette, shell detection
 *   3. Passes theme metadata via window.__dreamSkinThemeMeta__
 *   4. Large background images stored in sessionStorage to avoid expression limits
 */
class CDPInjector {
  constructor(port) {
    this.port = port;
    this.client = null;
    this.attachedSessions = new Map();
    this.themeCSS = '';
    this.themeMeta = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimer = null;
    this.injectionCallbacks = [];
    this._domContentHandler = null;
    this._targetCreatedHandler = null;
    this._frameNavigatedHandler = null;
    this._disconnected = false;
    this._injectorCode = this._loadInjectorScript();
  }

  _loadInjectorScript() {
    const injectorPath = path.join(__dirname, '..', '..', '..', 'runtime', 'renderer-inject.js');
    try {
      return fs.readFileSync(injectorPath, 'utf-8');
    } catch (e) {
      console.warn('[CDPInjector] renderer-inject.js not found');
      return null;
    }
  }

  _loadSkinCSS() {
    // Try compiled first, fall back to source with runtime token resolution
    const compiledPath = path.join(__dirname, '..', '..', '..', 'runtime', 'dream-skin-compiled.css');
    const sourcePath = path.join(__dirname, '..', '..', '..', 'runtime', 'dream-skin.css');

    // Prefer compiled (tokens already replaced at build time)
    if (fs.existsSync(compiledPath)) {
      try {
        return fs.readFileSync(compiledPath, 'utf-8');
      } catch (_) {}
    }

    // Fall back to source — replace tokens at runtime using pre-defined selectors
    try {
      let css = fs.readFileSync(sourcePath, 'utf-8');
      for (const [token, key] of Object.entries(TOKEN_MAP)) {
        const selector = SELECTORS[key] || '*';
        css = css.split(token).join(selector);
      }
      return css;
    } catch (e) {
      console.warn('[CDPInjector] Skin CSS not found:', e.message);
      return null;
    }
  }

  async connect() {
    this._disconnected = false;

    try {
      this.client = await CDP({ port: this.port });
    } catch (e) {
      throw new Error(`Cannot connect to CDP on port ${this.port}: ${e.message}`);
    }

    const { Target, Page, Runtime } = this.client;
    await Target.enable();
    await Page.enable();
    await Runtime.enable();

    // Monitor new pages/targets
    this._targetCreatedHandler = async (event) => {
      if (event.targetInfo.type === 'page') {
        const url = event.targetInfo.url;
        if (url.startsWith('devtools://')) return;
        console.log(`[CDPInjector] New page: ${url}`);
        setTimeout(() => this.injectIntoTarget(event.targetInfo.targetId), 500);
      }
    };
    this.client.on('Target.targetCreated', this._targetCreatedHandler);

    // Re-inject when page navigates
    this._frameNavigatedHandler = async (event) => {
      const url = event.frame.url;
      if (url.startsWith('chrome://') || url === 'chrome://newtab/') return;
      setTimeout(() => this.injectIntoTarget(event.frame.id), 300);
    };
    this.client.on('Page.frameNavigated', this._frameNavigatedHandler);

    // Re-inject on DOM content loaded
    this._domContentHandler = async () => {
      setTimeout(() => this.refreshAllInjections(), 200);
    };
    this.client.on('Page.domContentEventFired', this._domContentHandler);

    await this.injectIntoExistingPages();
    this.reconnectAttempts = 0;
    console.log(`[CDPInjector] Connected to port ${this.port}`);
  }

  async injectIntoExistingPages() {
    const { Target } = this.client;
    let { targetInfos } = await Target.getTargets();
    let injected = 0;

    for (const target of targetInfos) {
      if (target.type === 'page' &&
          !target.url.startsWith('devtools://') &&
          target.url !== 'chrome://newtab/') {
        await this.injectIntoTarget(target.targetId);
        injected++;
      }
    }
    console.log(`[CDPInjector] Initial injection into ${injected} page(s)`);
    return injected;
  }

  async injectIntoTarget(targetId) {
    if (this._disconnected) return;

    try {
      const { sessionId } = await this.client.Target.attachToTarget({
        targetId,
        flatten: true,
      });

      const pageClient = await CDP({ target: `${sessionId}` });

      await pageClient.CSS.enable();
      await pageClient.Runtime.enable();

      // Remove previous injection
      const existing = this.attachedSessions.get(targetId);
      if (existing) {
        try { await pageClient.CSS.removeStyleSheet({ styleSheetId: existing.styleSheetId }); } catch (_) {}
        try { await existing.pageClient.close(); } catch (_) {}
      }

      // Step 1: Inject full CSS via CDP (skin + theme overrides)
      const skinCSS = this._loadSkinCSS();
      const fullCSS = skinCSS ? skinCSS + '\n\n' + this.themeCSS + '\n' : this.themeCSS;
      let styleSheetId = null;
      if (fullCSS) {
        try {
          const result = await pageClient.CSS.addStyleSheet({
            source: fullCSS,
            title: 'CDP-DreamSkin',
          });
          styleSheetId = result.styleSheetId;
        } catch (e) {
          console.warn(`[CDPInjector] CSS injection warning: ${e.message}`);
        }
      }

      // Step 2: Inject renderer engine (JS) — the script IS the IIFE itself,
      // so we inject the whole thing in one go. If it's too large (>65KB),
      // we fall back to creating a blob URL approach.
      if (this._injectorCode) {
        const code = this._injectorCode;
        try {
          if (code.length <= 60000) {
            // Small enough for single expression
            await pageClient.Runtime.evaluate({
              expression: code,
              returnByValue: true,
              timeout: 15000,
            });
          } else {
            // Large script: inject via script element creation
            await pageClient.Runtime.evaluate({
              expression: `
                (function() {
                  if (window.__dreamSkinInjected) return 'already_present';
                  window.__dreamSkinInjected = true;
                  var s = document.createElement('script');
                  s.textContent = ${JSON.stringify(code)};
                  document.head.appendChild(s);
                  s.remove();
                  return 'injected';
                })()
              `,
              returnByValue: true,
              timeout: 15000,
            });
          }
        } catch (e) {
          console.warn(`[CDPInjector] JS injection error: ${e.message}`);
        }
      }

      // Step 3: Pass theme metadata and trigger renderer
      if (this.themeMeta) {
        const metaForJS = { ...this.themeMeta };

        // Large base64 → sessionStorage to avoid expression length limits
        if (this.themeMeta.backgroundBase64 && this.themeMeta.backgroundBase64.length > 10000) {
          try {
            await pageClient.Runtime.evaluate({
              expression: `(() => { try { sessionStorage.setItem('__dreamSkin_bg', ${JSON.stringify(this.themeMeta.backgroundBase64)}); } catch(e) {} })()`,
              returnByValue: true,
            });
          } catch (_) {}
          metaForJS.backgroundBase64 = null;
          metaForJS._bgFromStorage = true;
        }

        // Store meta on window
        try {
          await pageClient.Runtime.evaluate({
            expression: `(() => { try { window.__dreamSkinThemeMeta__ = ${JSON.stringify(metaForJS)}; } catch(e) {} })()`,
            returnByValue: true,
          });
        } catch (e) {
          console.warn(`[CDPInjector] Meta injection warning: ${e.message}`);
        }

        // Trigger theme application
        try {
          await pageClient.Runtime.evaluate({
            expression: `(() => { try { if (window.__dreamSkinApi) window.__dreamSkinApi.apply(window.__dreamSkinThemeMeta__); } catch(e) {} })()`,
            returnByValue: true,
          });
        } catch (_) {}
      }

      this.attachedSessions.set(targetId, {
        sessionId,
        pageClient,
        styleSheetId,
      });

      const cbResult = { targetId, action: 'inject', styleSheetId };
      for (const cb of this.injectionCallbacks) cb(cbResult);

    } catch (e) {
      this.attachedSessions.delete(targetId);
      if (!e.message.includes('No target with id') && !e.message.includes('Session closed')) {
        console.warn(`[CDPInjector] Inject failed for ${targetId.substring(0, 8)}: ${e.message}`);
      }
    }
  }

  async refreshAllInjections() {
    if (this._disconnected || !this.client) return;
    try {
      const { Target } = this.client;
      const { targetInfos } = await Target.getTargets();
      for (const target of targetInfos) {
        if (target.type === 'page' &&
            !target.url.startsWith('devtools://') &&
            target.url !== 'chrome://newtab/') {
          await this.injectIntoTarget(target.targetId);
        }
      }
    } catch (e) {
      this.reconnectAttempts++;
      if (this.reconnectAttempts <= this.maxReconnectAttempts) {
        console.log(`[CDPInjector] Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        await this._doReconnect();
      } else {
        console.error('[CDPInjector] Max reconnect attempts reached.');
        this._disconnected = true;
      }
    }
  }

  async setTheme(css, themeMeta) {
    this.themeCSS = css;
    this.themeMeta = themeMeta || null;
    if (this._disconnected) return;
    await this.removeAllInjections();
    if (this.client) {
      await this.injectIntoExistingPages();
    }
  }

  async removeAllInjections() {
    const removals = [];
    for (const [targetId, entry] of this.attachedSessions) {
      removals.push(this._removeFromTarget(targetId, entry));
    }
    await Promise.allSettled(removals);
    this.attachedSessions.clear();
  }

  async _removeFromTarget(targetId, entry) {
    try { if (entry.styleSheetId && entry.pageClient) await entry.pageClient.CSS.removeStyleSheet({ styleSheetId: entry.styleSheetId }); } catch (_) {}
    try {
      if (entry.pageClient) {
        // Clean up JS state too
        try {
          await entry.pageClient.Runtime.evaluate({
            expression: '(() => { try { removeTheme(); } catch(e) {} })()',
            returnByValue: true,
          });
        } catch (_) {}
        await entry.pageClient.close();
      }
    } catch (_) {}
  }

  async restoreDefault() {
    if (this._disconnected || !this.client) return;
    await this.removeAllInjections();
    try {
      const { Runtime } = this.client;
      await Runtime.evaluate({
        expression: this._restoreCode(),
        returnByValue: true,
      });
    } catch (_) {}
  }

  async disconnect() {
    this._disconnected = true;
    clearTimeout(this.reconnectTimer);
    await this.removeAllInjections();
    if (this.client) {
      try { await this.client.close(); } catch (_) {}
      this.client = null;
    }
    console.log('[CDPInjector] Disconnected');
  }

  onInjection(callback) {
    this.injectionCallbacks.push(callback);
    return () => {
      this.injectionCallbacks = this.injectionCallbacks.filter(cb => cb !== callback);
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  async _doReconnect() {
    try { await this.disconnect(); } catch (_) {}
    await new Promise(r => setTimeout(r, 2000));
    try { await this.connect(); } catch (e) {
      console.warn(`[CDPInjector] Reconnect failed: ${e.message}`);
    }
  }

  _restoreCode() {
    return `
      (function() {
        // Remove CSS injected via CDP
        document.querySelectorAll('style[title="CDP-DreamSkin"], link[title="CDP-DreamSkin"]').forEach(function(el) {
          el.remove();
        });
        // Clean up JS state
        try { removeTheme(); } catch(e) {}
        try { sessionStorage.removeItem('__dreamSkin_bg'); } catch(e) {}
        return 'restored';
      })()
    `;
  }

  _chunkCode(code, maxLen) {
    if (!code || code.length <= maxLen) return [code];
    const chunks = [];
    let remaining = code;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) { chunks.push(remaining); break; }
      let splitAt = remaining.lastIndexOf(';', maxLen);
      if (splitAt < maxLen * 0.5) splitAt = maxLen;
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt);
    }
    return chunks;
  }
}

module.exports = CDPInjector;
