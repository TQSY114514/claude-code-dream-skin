/**
 * Dream Skin — CDP Injector
 *
 * Connects to Claude Desktop's embedded Chromium via CDP and injects themes.
 * Uses raw WebSocket (no chrome-remote-interface dependency).
 *
 * Architecture (Codex Dream Skin v1.3.5 patterns):
 *   1. BrowserIdentityAnchor — a browser-level WS that monitors identity
 *   2. Per-page CdpSession — dedicated WebSocket per page target
 *   3. probeSession — verify target is actually Claude Desktop
 *   4. Payload assembly — CSS + art + theme config + template into one string
 *   5. Early payload — Page.addScriptToEvaluateOnNewDocument for pre-load injection
 *   6. adoptedStyleSheets — CSSStyleSheet API with <style> fallback
 *   7. Watch mode — persistent daemon with target discovery, reconnection
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const SELECTORS_PATH = path.join(__dirname, '..', '..', 'tools', 'selectors.json');
const CSS_COMPILED_PATH = path.join(__dirname, '..', '..', 'runtime', 'dream-skin-compiled.css');
const INJECT_COMPILED_PATH = path.join(__dirname, '..', '..', 'runtime', 'renderer-inject-compiled.js');

// ── Browser Identity Anchor ────────────────────────────────────────────────

/**
 * A dedicated browser-level WebSocket that:
 * - Stays open for the entire session lifetime
 * - Detects browser identity changes (port hijacking)
 * - Closing this anchor stops the injector (security)
 */
class BrowserIdentityAnchor {
  constructor(cdpUrl, browserId) {
    this.cdpUrl = cdpUrl;
    this.browserId = browserId;
    this.ws = null;
    this.closed = false;
    this.onClose = null;
    this._commandId = 0;
    this._pending = new Map();
    this._msgQueue = [];
  }

  open() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('BrowserIdentityAnchor: open timeout'));
      }, 8000);

      this.ws = new WebSocket(this.cdpUrl, { handshakeTimeout: 5000 });

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.ws.on('message', (event) => this._onMessage(event));
        this.ws.on('error', () => this._handleClose('error'));
        this.ws.on('close', () => this._handleClose('close'));
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error('BrowserIdentityAnchor: WS open failed: ' + err.message));
      });
    });
  }

  _onMessage(event) {
    try {
      const msg = JSON.parse(event.data.toString());
      if (msg.id) {
        const waiter = this._pending.get(msg.id);
        if (waiter) {
          clearTimeout(waiter.timer);
          this._pending.delete(msg.id);
          if (msg.error) waiter.reject(new Error(`${msg.error.message} (${msg.error.code})`));
          else waiter.resolve(msg.result);
        }
      }
    } catch (e) { /* ignore */ }
  }

  _handleClose(reason) {
    if (this.closed) return;
    this.closed = true;
    this._drainRejectAll();
    if (this.onClose) this.onClose(reason);
  }

  send(method, params = {}) {
    if (this.closed || !this.ws) return Promise.reject(new Error('Anchor closed'));
    return new Promise((resolve, reject) => {
      const id = ++this._commandId;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Anchor command timed out: ${method}`));
      }, 15000);
      this._pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (err) { clearTimeout(timer); this._pending.delete(id); reject(err); }
    });
  }

  _drainRejectAll() {
    for (const [, waiter] of this._pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('BrowserIdentityAnchor closed'));
    }
    this._pending.clear();
  }

  close() {
    this.closed = true;
    this.onClose = null;
    this._drainRejectAll();
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}

// ── CdpSession ─────────────────────────────────────────────────────────────

/**
 * A per-page CDP session with its own WebSocket.
 * Handles message routing, timeout, and cleanup.
 */
class CdpSession {
  constructor(wsUrl, targetId) {
    this.wsUrl = wsUrl;
    this.targetId = targetId;
    this.ws = null;
    this.closed = false;
    this._commandId = 0;
    this._pending = new Map();
    this._listeners = new Map();
    this.onClose = null;
    this.styleSheetId = null;
    this.earlyPayloadId = null;
    this.probeResult = null;
    this.failureCount = 0;
    this.lastFailure = 0;
    this.backoffMs = 0;
  }

  async open() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`CdpSession open timeout for ${this.targetId.substring(0, 8)}`));
      }, 8000);

      this.ws = new WebSocket(this.wsUrl, { handshakeTimeout: 5000 });

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.ws.on('message', (event) => this._onMessage(event));
        this.ws.on('error', () => this._handleClose('error'));
        this.ws.on('close', () => this._handleClose('close'));
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`CdpSession WS open failed: ${err.message}`));
      });
    });
  }

  _onMessage(event) {
    try {
      const msg = JSON.parse(event.data.toString());
      if (msg.id) {
        const waiter = this._pending.get(msg.id);
        if (waiter) {
          clearTimeout(waiter.timer);
          this._pending.delete(msg.id);
          if (msg.error) waiter.reject(new Error(`${msg.error.message} (${msg.error.code})`));
          else waiter.resolve(msg.result);
        }
      } else {
        const listeners = this._listeners.get(msg.method) || [];
        for (const fn of listeners) fn(msg.params || {});
      }
    } catch (e) { /* ignore */ }
  }

  _handleClose(reason) {
    if (this.closed) return;
    this.closed = true;
    this._drainRejectAll();
    if (this.onClose) this.onClose(reason);
  }

  send(method, params = {}) {
    if (this.closed || !this.ws) return Promise.reject(new Error('Session closed'));
    return new Promise((resolve, reject) => {
      const id = ++this._commandId;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Session command timed out: ${method}`));
      }, 15000);
      this._pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (err) { clearTimeout(timer); this._pending.delete(id); reject(err); }
    });
  }

  on(method, listener) {
    const list = this._listeners.get(method) || [];
    list.push(listener);
    this._listeners.set(method, list);
    return () => {
      const l = this._listeners.get(method) || [];
      const idx = l.indexOf(listener);
      if (idx >= 0) l.splice(idx, 1);
    };
  }

  _drainRejectAll() {
    for (const [, waiter] of this._pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Session closed'));
    }
    this._pending.clear();
  }

  async close() {
    this.closed = true;
    this.onClose = null;
    this._drainRejectAll();
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}

// ── Payload Assembly ───────────────────────────────────────────────────────

/**
 * Assembles the complete injection payload by combining:
 * - Compiled CSS (from dream-skin-compiled.css)
 * - Theme CSS (from theme engine)
 * - Image analysis
 * - Theme config (colors, art settings, text)
 * - Renderer inject template (from renderer-inject-compiled.js)
 *
 * Replaces placeholder tokens with actual values.
 */
class PayloadAssembler {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.compiledCSS = null;
    this.injectTemplate = null;
    this.selectors = {};
    this.loaded = false;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    this._loadSelectors();
    this._loadCSS();
    this._loadTemplate();
    this.loaded = true;
  }

  _loadSelectors() {
    try {
      const contract = JSON.parse(fs.readFileSync(SELECTORS_PATH, 'utf-8'));
      for (const s of contract.selectors) this.selectors[s.key] = s.selector;
    } catch (e) {
      console.warn('[PayloadAssembler] selectors.json not found, using defaults');
    }
  }

  _loadCSS() {
    try {
      this.compiledCSS = fs.readFileSync(CSS_COMPILED_PATH, 'utf-8');
    } catch (e) {
      console.warn('[PayloadAssembler] compiled CSS not found');
      this.compiledCSS = '';
    }
  }

  _loadTemplate() {
    try {
      this.injectTemplate = fs.readFileSync(INJECT_COMPILED_PATH, 'utf-8');
    } catch (e) {
      console.warn('[PayloadAssembler] compiled injector not found');
      this.injectTemplate = '';
    }
  }

  async assemble(themeCSS, themeConfig, artDataUrl) {
    await this.ensureLoaded();
    if (!this.injectTemplate) {
      throw new Error('PayloadAssembler: injector template not loaded');
    }

    const cssJson = JSON.stringify(this.compiledCSS + '\n\n' + (themeCSS || ''));
    const artJson = JSON.stringify(artDataUrl || '');
    const themeJson = JSON.stringify(themeConfig || {});

    const styleRevision = crypto.createHash('sha256')
      .update(this.compiledCSS + '\n\n' + (themeCSS || ''), 'utf-8')
      .digest('hex').slice(0, 20);

    const payloadRevision = crypto.createHash('sha256')
      .update(JSON.stringify(SKIN_VERSION) + cssJson + artJson + themeJson, 'utf-8')
      .digest('hex').slice(0, 20);

    let payload = this.injectTemplate;

    // Replace runtime placeholders
    const replacements = {
      '__DREAM_SKIN_CSS_JSON__': cssJson,
      '__DREAM_SKIN_ART_JSON__': artJson,
      '__DREAM_SKIN_THEME_JSON__': themeJson,
      '__DREAM_SKIN_PAYLOAD_REVISION_JSON__': JSON.stringify(payloadRevision),
    };

    for (const [token, value] of Object.entries(replacements)) {
      payload = payload.split(token).join(value);
    }

    return {
      payload,
      styleRevision,
      payloadRevision,
      cssLength: cssJson.length,
    };
  }
}

const SKIN_VERSION = '1.3.5';

// ── Probe Session ──────────────────────────────────────────────────────────

/**
 * Probes a target to verify it's actually Claude Desktop.
 * Evaluates a marker detection script in the renderer.
 */
function probeExpression() {
  return `(() => {
    const markers = {
      shell: Boolean(document.querySelector('main, [role="main"], [class*="content"]')),
      sidebar: Boolean(document.querySelector('aside, nav, [class*="sidebar"], [class*="Navigation"]')),
      header: Boolean(document.querySelector('header, [class*="header"]')),
      composer: Boolean(document.querySelector('[contenteditable="true"], [role="textbox"], [class*="composer"], textarea')),
      main: Boolean(document.querySelector('[class*="home"], [class*="Welcome"], [role="main"]:has(*)')),
    };
    return {
      markers,
      claude: location.protocol === 'app:' &&
        ((markers.shell && (markers.sidebar || (markers.header && markers.composer))) || markers.main),
      protocol: location.protocol,
      title: typeof document.title === 'string' ? document.title.substring(0, 80) : '',
    };
  })()`;
}

async function probeSession(session) {
  try {
    const result = await session.send('Runtime.evaluate', {
      expression: probeExpression(),
      returnByValue: true,
      timeout: 8000,
    });
    if (result.exceptionDetails) {
      console.warn('[probe] Exception during probe:', result.exceptionDetails.text?.substring(0, 200));
      return null;
    }
    if (result.result && result.result.value) {
      const data = typeof result.result.value === 'string'
        ? JSON.parse(result.result.value) : result.result.value;
      return data.claude ? data : null;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ── CDP URL Validation ─────────────────────────────────────────────────────

function validatedDebuggerUrl(raw, expectedBrowserId) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try { parsed = new URL(raw); }
  catch (_) { return null; }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return null;
  if (!LOOPBACK.has(parsed.hostname)) return null;
  if (!/^\/devtools\/(?:page|browser)\/[A-Za-z0-9._-]{1,200}$/.test(parsed.pathname)) return null;
  return parsed.toString();
}

function browserIdFromVersion(version) {
  if (!version || !version.Browser) return null;
  const match = version.Browser.match(/DevTools\s+(.+?)(?:\s+\d|$)/);
  if (match) return match[1].trim();
  if (version.webSocketDebuggerUrl) {
    try {
      const url = new URL(version.webSocketDebuggerUrl);
      const m = url.pathname.match(/^\/devtools\/browser\/(.+)$/);
      if (m) return m[1];
    } catch (_) {}
  }
  return null;
}

function isValidCdpPageTarget(target) {
  if (!target || target.type !== 'page') return false;
  if (target.url && target.url.startsWith('devtools://')) return false;
  if (target.url && target.url.startsWith('chrome://')) return false;
  if (target.url && !target.url.startsWith('app://') && !target.url.startsWith('http')) return false;
  return true;
}

// ── Early Payload ──────────────────────────────────────────────────────────

/**
 * Registers a script to execute before any page scripts load.
 * Uses Page.addScriptToEvaluateOnNewDocument.
 */
async function registerEarlyPayload(session, source, sourceName, scriptId) {
  try {
    const result = await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source,
      worldName: 'dreamSkin',
    });
    return result.identifier || null;
  } catch (e) {
    console.warn(`[early-payload] Failed to register ${sourceName}: ${e.message}`);
    return null;
  }
}

async function removeEarlyPayload(session, identifier) {
  if (!identifier || !session || session.closed) return;
  try {
    await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  } catch (e) { /* ignore */ }
}

// ── Main CDP Injector ──────────────────────────────────────────────────────

class CDPInjector {
  constructor(port, options = {}) {
    this.port = port;
    this.anchor = null;
    this.browserId = null;
    this.expectedBrowserId = options.expectedBrowserId || null;
    this.sessions = new Map(); // targetId → CdpSession
    this.themeCSS = '';
    this.themeConfig = null;
    this.artDataUrl = null;
    this._disconnected = false;
    this._watchMode = options.watchMode || false;
    this._pauseFile = options.pauseFile || null;
    this._themeDir = options.themeDir || null;
    this._strongThemeAuditMs = options.strongThemeAuditMs || 30000;
    this._onInjection = null;
    this._onRemove = null;

    // Payload assembly
    this.payloadAssembler = new PayloadAssembler(path.join(__dirname, '..', '..'));

    // Runtime
    this._reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this._watchTimer = null;
    this._auditTimer = null;
    this._lastPayloadRevision = null;
  }

  // ── Connection ──────────────────────────────────────────────────────────

  async connect() {
    this._disconnected = false;
    this._reconnectAttempts = 0;

    // Get browser version and ID
    const version = await this._httpGet('/json/version');
    const rawWsUrl = validatedDebuggerUrl(version.webSocketDebuggerUrl, this.expectedBrowserId);
    if (!rawWsUrl) throw new Error('Invalid CDP browser URL');

    const extractedId = browserIdFromVersion(version);
    if (this.expectedBrowserId && extractedId !== this.expectedBrowserId) {
      throw new Error(`Browser ID mismatch: expected ${this.expectedBrowserId}, got ${extractedId}`);
    }
    this.browserId = extractedId;

    // Open browser identity anchor
    this.anchor = new BrowserIdentityAnchor(rawWsUrl, this.browserId);
    this.anchor.onClose = () => this._handleAnchorClose();

    try {
      await this.anchor.open();
    } catch (e) {
      throw new Error(`Failed to open CDP browser anchor: ${e.message}`);
    }

    // Enable browser-level domains
    try { await this.anchor.send('Target.enable'); } catch (_) {}
    try { await this.anchor.send('Page.enable'); } catch (_) {}
    try { await this.anchor.send('Runtime.enable'); } catch (_) {}

    // Monitor new targets at browser level
    this.anchor.on('Target.targetCreated', async (params) => {
      if (params.targetInfo.type === 'page' && !params.targetInfo.url.startsWith('devtools://')) {
        const delay = Math.min(500 + this.sessions.size * 200, 2000);
        setTimeout(() => this._tryTarget(params.targetInfo), delay);
      }
    });

    this.anchor.on('Target.targetDestroyed', (params) => {
      this._removeTarget(params.targetId);
    });

    this.anchor.on('Page.frameNavigated', async (params) => {
      if (params.frame.url && params.frame.url.startsWith('chrome://')) return;
      const targetId = params.frame.parentId ? undefined : params.frame.id;
      if (targetId) {
        const delay = Math.min(300 + this.sessions.size * 100, 1500);
        setTimeout(() => this._tryTargetById(targetId), delay);
      }
    });

    // Check if Claude is paused
    const paused = this._checkPaused();

    // Connect to existing pages
    const existing = await this._httpGet('/json/list');
    let injected = 0;
    for (const target of existing) {
      if (isValidCdpPageTarget(target)) {
        await this._tryTarget(target);
        injected++;
      }
    }

    // Start watch mode timers
    if (this._watchMode) {
      this._startWatchTimers(paused);
    }

    console.log(`[CDPInjector] Connected to port ${this.port} (browser: ${this.browserId}, ${injected} targets)`);
  }

  async _handleAnchorClose() {
    console.warn('[CDPInjector] BrowserIdentityAnchor closed — injector stopping');
    this._disconnected = true;
    this._cleanup();
  }

  _checkPaused() {
    try {
      if (this._pauseFile && fs.existsSync(this._pauseFile)) return true;
    } catch (_) {}
    return false;
  }

  // ── Target Management ───────────────────────────────────────────────────

  async _tryTarget(targetInfo) {
    const targetId = targetInfo.targetId;
    if (!targetId || this.sessions.has(targetId)) return;

    // Check backoff
    const now = Date.now();
    const session = this.sessions.get(targetId);
    if (session && session.backoffMs > 0 && now - session.lastFailure < session.backoffMs) {
      return;
    }

    // Validate URL
    if (!validatedDebuggerUrl(targetInfo.webSocketDebuggerUrl)) return;

    await this._tryTargetById(targetId, targetInfo);
  }

  async _tryTargetById(targetId, targetInfo) {
    if (this.sessions.has(targetId) && this.sessions.get(targetId).ws) {
      // Session exists, just probe
      const existing = this.sessions.get(targetId);
      if (existing && !existing.closed && existing.probeResult) {
        await this._maybeReinject(existing, this._checkPaused());
      }
      return;
    }

    // Get target info from browser if not provided
    if (!targetInfo) {
      try {
        const targets = await this._httpGet('/json/list');
        targetInfo = targets.find(t => t.targetId === targetId);
      } catch (_) { return; }
    }
    if (!targetInfo || !isValidCdpPageTarget(targetInfo)) return;

    const paused = this._checkPaused();
    const wsUrl = validatedDebuggerUrl(targetInfo.webSocketDebuggerUrl);
    if (!wsUrl) return;

    try {
      const session = new CdpSession(wsUrl, targetId);
      session.onClose = () => this._removeTarget(targetId);
      await session.open();

      // Probe: verify this is Claude Desktop
      const probe = await probeSession(session);
      session.probeResult = probe;

      if (!probe) {
        session.failureCount++;
        session.lastFailure = Date.now();
        session.backoffMs = Math.min(5000 * Math.pow(1.5, session.failureCount), 30000);
        await session.close();
        console.log(`[CDPInjector] Probed ${targetId.substring(0, 8)} — not Claude Desktop, backoff ${Math.round(session.backoffMs / 1000)}s`);
        return;
      }

      // Reset failure tracking on success
      session.failureCount = 0;
      session.backoffMs = 0;

      this.sessions.set(targetId, session);

      if (paused) {
        await this._removeFromSession(session);
      } else {
        await this._applyToSession(session);
      }

      console.log(`[CDPInjector] Session ${targetId.substring(0, 8)} — probe OK, ${paused ? 'paused' : 'applied'}`);
    } catch (e) {
      if (!e.message.includes('closed') && !e.message.includes('timeout')) {
        console.warn(`[CDPInjector] Target ${targetId.substring(0, 8)} error: ${e.message}`);
      }
    }
  }

  async _maybeReinject(session, paused) {
    if (session.probeResult && !paused && !session.styleSheetId) {
      await this._applyToSession(session);
    }
  }

  _removeTarget(targetId) {
    const session = this.sessions.get(targetId);
    if (session) {
      this._removeFromSession(session).catch(() => {});
      this.sessions.delete(targetId);
    }
  }

  // ── Injection ───────────────────────────────────────────────────────────

  async _applyToSession(session) {
    if (!session || session.closed || this._disconnected) return;

    try {
      // Enable domains
      try { await session.send('CSS.enable'); } catch (_) {}
      try { await session.send('Page.enable'); } catch (_) {}
      try { await session.send('Runtime.enable'); } catch (_) {}

      // Assemble payload
      const { payload, payloadRevision } = await this.payloadAssembler.assemble(
        this.themeCSS,
        this.themeConfig,
        this.artDataUrl
      );

      // Remove previous injection
      await this._removeFromSession(session, true);

      // Register early payload (injects before page scripts load)
      if (payload) {
        try {
          session.earlyPayloadId = await registerEarlyPayload(session, payload, 'dream-skin', payloadRevision);
          if (session.earlyPayloadId) {
            console.log(`[CDPInjector] Early payload registered for ${session.targetId.substring(0, 8)}`);
          }
        } catch (e) {
          console.warn(`[CDPInjector] Early payload failed: ${e.message}`);
        }

        // Also inject now (the page is already loaded)
        await this._injectPayload(session, payload);

        // Set up fallback: re-inject on load events
        const onLoad = async () => {
          if (session.closed) return;
          try {
            await this._injectPayload(session, payload);
          } catch (_) {}
        };
        const unlistenLoad = session.on('Page.loadEventFired', onLoad);
        const unlistenDom = session.on('Page.domContentEventFired', async () => {
          setTimeout(onLoad, 300);
        });
        session._unlistenLoad = unlistenLoad;
        session._unlistenDom = unlistenDom;
      }

      // Notify
      const result = { targetId: session.targetId, action: 'inject', styleSheetId: session.styleSheetId };
      if (this._onInjection) this._onInjection(result);

    } catch (e) {
      if (!e.message.includes('closed')) {
        console.warn(`[CDPInjector] Inject ${session.targetId.substring(0, 8)} error: ${e.message}`);
      }
    }
  }

  async _injectPayload(session, payload) {
    if (!payload || session.closed) return;

    // For payloads > 60KB, use blob URL injection
    if (payload.length > 60000) {
      const blobExpr = `
        (function() {
          if (window.__DREAM_SKIN_EARLY_APPLIED__) return 'already_present';
          window.__DREAM_SKIN_EARLY_APPLIED__ = true;
          try {
            var b = new Blob([${JSON.stringify(payload)}], { type: 'application/javascript' });
            var u = URL.createObjectURL(b);
            var s = document.createElement('script');
            s.src = u;
            s.onload = function() { URL.revokeObjectURL(u); };
            (document.head || document.documentElement).appendChild(s);
          } catch(e) { throw e; }
          return 'injected';
        })()
      `;
      await session.send('Runtime.evaluate', {
        expression: blobExpr,
        returnByValue: true,
        timeout: 20000,
      });
    } else {
      // Small enough for direct evaluation
      const evalExpr = `
        (function() {
          if (window.__DREAM_SKIN_EARLY_APPLIED__) return 'already_present';
          window.__DREAM_SKIN_EARLY_APPLIED__ = true;
          try { ${payload} } catch(e) { throw e; }
          return 'injected';
        })()
      `;
      await session.send('Runtime.evaluate', {
        expression: evalExpr,
        returnByValue: true,
        timeout: 15000,
      });
    }
  }

  async _removeFromSession(session, keepWs = false) {
    if (!session || session.closed) return;

    try {
      // Remove adopted style sheet
      if (session.styleSheetId) {
        try { await session.send('CSS.removeStyleSheet', { styleSheetId: session.styleSheetId }); } catch (_) {}
        session.styleSheetId = null;
      }

      // Remove early payload
      if (session.earlyPayloadId) {
        await removeEarlyPayload(session, session.earlyPayloadId);
        session.earlyPayloadId = null;
      }

      // Remove JS-injected style element via cleanup
      try {
        await session.send('Runtime.evaluate', {
          expression: `
            (function() {
              window.__DREAM_SKIN_EARLY_APPLIED__ = false;
              var el = document.getElementById('codex-dream-skin-style');
              if (el) el.remove();
              try {
                var reg = window.__CODEX_DREAM_SKIN_STYLE_SHEETS__;
                if (reg) { reg.forEach(function(id) {
                  try { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function(s) { return s !== id; }); } catch(e){}
                }); }
              } catch(e){}
              return 'removed';
            })()
          `,
          returnByValue: true,
          timeout: 5000,
        });
      } catch (_) {}

      // Remove fallback listeners
      if (session._unlistenLoad) session._unlistenLoad();
      if (session._unlistenDom) session._unlistenDom();
      session._unlistenLoad = null;
      session._unlistenDom = null;
    } catch (_) {}

    if (!keepWs) {
      await session.close();
    }
  }

  // ── Theme Management ────────────────────────────────────────────────────

  async setTheme(css, themeConfig, artDataUrl) {
    this.themeCSS = css || '';
    this.themeConfig = themeConfig || null;
    this.artDataUrl = artDataUrl || null;
    if (this._disconnected) return;

    await this.removeAllInjections();
    if (!this._disconnected) {
      await this.injectIntoAllSessions();
    }
  }

  async injectIntoAllSessions() {
    const sessions = Array.from(this.sessions.values()).filter(s => !s.closed);
    for (const session of sessions) {
      if (session.probeResult && !this._checkPaused()) {
        await this._applyToSession(session);
      }
    }
  }

  async refreshAllInjections() {
    await this.removeAllInjections();
    if (!this._disconnected) {
      await this.injectIntoAllSessions();
    }
  }

  async removeAllInjections() {
    const sessions = Array.from(this.sessions.values());
    const removals = sessions.map(s => this._removeFromSession(s));
    await Promise.allSettled(removals);
    for (const session of sessions) {
      if (!session.closed) {
        this.sessions.delete(session.targetId);
        session.close().catch(() => {});
      }
    }
    this.sessions.clear();
  }

  async restoreDefault() {
    if (this._disconnected || !this.anchor) return;
    await this.removeAllInjections();
    try {
      await this.anchor.send('Runtime.evaluate', {
        expression: `
          (function() {
            window.__DREAM_SKIN_EARLY_APPLIED__ = false;
            document.querySelectorAll('style[title="CDP-DreamSkin"], #codex-dream-skin-style').forEach(function(el) { el.remove(); });
            try { document.adoptedStyleSheets = []; } catch(e){}
            try {
              var reg = window.__CODEX_DREAM_SKIN_STYLE_SHEETS__;
              if (reg) { reg.forEach(function(id) {
                try { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function(s) { return s !== id; }); } catch(e){}
              }); }
            } catch(e){}
            return 'restored';
          })()
        `,
        returnByValue: true,
        timeout: 5000,
      });
    } catch (_) {}
  }

  // ── Watch Mode ──────────────────────────────────────────────────────────

  _startWatchTimers(paused) {
    this._stopWatchTimers();

    // Target discovery: poll for new pages
    this._watchTimer = setInterval(async () => {
      if (this._disconnected || this._checkPaused() !== paused) {
        // State changed, re-evaluate all
      }
      try {
        const targets = await this._httpGet('/json/list');
        for (const target of targets) {
          if (isValidCdpPageTarget(target) && !this.sessions.has(target.targetId)) {
            await this._tryTarget(target);
          }
        }
      } catch (e) {
        if (e.message.includes('ECONNREFUSED') || e.message.includes('ECONNRESET')) {
          this._disconnected = true;
          this._cleanup();
        }
      }
    }, 1200);

    // Strong theme audit
    this._auditTimer = setInterval(async () => {
      if (this._disconnected) return;
      try {
        const payloadInfo = await this.payloadAssembler.assemble(
          this.themeCSS,
          this.themeConfig,
          this.artDataUrl
        );
        if (this._lastPayloadRevision && this._lastPayloadRevision !== payloadInfo.payloadRevision) {
          console.log('[CDPInjector] Theme changed, re-injecting...');
          this._lastPayloadRevision = payloadInfo.payloadRevision;
          await this.injectIntoAllSessions();
        } else {
          this._lastPayloadRevision = payloadInfo.payloadRevision;
        }
      } catch (_) {}
    }, this._strongThemeAuditMs);
  }

  _stopWatchTimers() {
    if (this._watchTimer) { clearInterval(this._watchTimer); this._watchTimer = null; }
    if (this._auditTimer) { clearInterval(this._auditTimer); this._auditTimer = null; }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  async disconnect() {
    this._disconnected = true;
    this._stopWatchTimers();

    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();
    const closures = sessions.map(s => {
      if (!s.closed) {
        this._removeFromSession(s).catch(() => {});
        return s.close();
      }
      return Promise.resolve();
    });
    await Promise.allSettled(closures);

    if (this.anchor) {
      this.anchor.close();
      this.anchor = null;
    }

    console.log('[CDPInjector] Disconnected');
  }

  _cleanup() {
    this._stopWatchTimers();
    if (this.anchor) {
      this.anchor.close();
      this.anchor = null;
    }
    this.sessions.forEach(s => { if (!s.closed) s.close(); });
    this.sessions.clear();
  }

  onInjection(callback) {
    this._onInjection = callback;
    return () => { this._onInjection = null; };
  }

  // ── HTTP Helper ─────────────────────────────────────────────────────────

  _httpGet(resource) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${this.port}${resource}`, { timeout: 5000 }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }
}

module.exports = { CDPInjector, probeSession, validatedDebuggerUrl };
