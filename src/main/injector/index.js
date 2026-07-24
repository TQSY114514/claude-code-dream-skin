const CDP = require('chrome-remote-interface');
const http = require('http');

/**
 * CDP-based CSS injector for Electron apps.
 *
 * Connects to an Electron app via Chrome DevTools Protocol,
 * injects CSS themes, and monitors for navigation events to re-inject.
 *
 * Uses per-target sessions for reliable multi-window injection.
 */
class CDPInjector {
  constructor(port) {
    this.port = port;
    this.client = null;
    this.attachedSessions = new Map();   // targetId -> { session, pageClient, styleSheetId }
    this.themeCSS = '';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimer = null;
    this.injectionCallbacks = [];
    this._domContentHandler = null;
    this._targetCreatedHandler = null;
    this._frameNavigatedHandler = null;
    this._disconnected = false;
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

    // Inject into any existing pages
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
      // Attach to the target to get a session
      const { sessionId } = await this.client.Target.attachToTarget({
        targetId,
        flatten: true,
      });

      // Create a CDP client scoped to this session
      const pageClient = await CDP({ target: `${sessionId}` });

      // Enable CSS domain
      await pageClient.CSS.enable();

      // Remove previous injection for this target
      const existing = this.attachedSessions.get(targetId);
      if (existing) {
        try {
          await pageClient.CSS.removeStyleSheet({ styleSheetId: existing.styleSheetId });
        } catch (_) { /* already removed */ }
        try { await existing.pageClient.close(); } catch (_) { /* ignore */ }
      }

      // Inject theme CSS
      let styleSheetId = null;
      if (this.themeCSS) {
        const result = await pageClient.CSS.addStyleSheet({
          source: this.themeCSS,
          title: 'CDP-DreamSkin',
        });
        styleSheetId = result.styleSheetId;
      }

      // Inject JS guard to track injection state
      await pageClient.Runtime.evaluate({
        expression: this._guardCode(),
        returnByValue: true,
      });

      this.attachedSessions.set(targetId, {
        sessionId,
        pageClient,
        styleSheetId,
      });

      const cbResult = { targetId, action: 'inject', styleSheetId };
      for (const cb of this.injectionCallbacks) cb(cbResult);

    } catch (e) {
      // Clean up stale session entry
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
        console.log(`[CDPInjector] Connection lost, reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        await this._doReconnect();
      } else {
        console.error('[CDPInjector] Max reconnect attempts reached, giving up.');
        this._disconnected = true;
      }
    }
  }

  async setTheme(css) {
    this.themeCSS = css;
    if (this._disconnected) return;

    // Remove all existing injections, then re-apply
    await this.removeAllInjections();
    if (css && this.client) {
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
    try {
      if (entry.styleSheetId && entry.pageClient) {
        await entry.pageClient.CSS.removeStyleSheet({ styleSheetId: entry.styleSheetId });
      }
    } catch (_) { /* ignore */ }
    try {
      if (entry.pageClient) await entry.pageClient.close();
    } catch (_) { /* ignore */ }
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
    } catch (_) { /* ignore */ }
  }

  async disconnect() {
    this._disconnected = true;
    clearTimeout(this.reconnectTimer);
    await this.removeAllInjections();
    if (this.client) {
      try { await this.client.close(); } catch (_) { /* ignore */ }
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
    try {
      await this.disconnect();
    } catch (_) { /* ignore */ }
    await new Promise(r => setTimeout(r, 2000));
    try {
      await this.connect();
    } catch (e) {
      console.warn(`[CDPInjector] Reconnect failed: ${e.message}`);
    }
  }

  _guardCode() {
    return `
      (function() {
        const INJECTION_ID = '__cdp_dream_skin__';
        if (document.getElementById(INJECTION_ID)) return 'already_present';
        const marker = document.createElement('meta');
        marker.id = INJECTION_ID;
        marker.name = 'cdp-dream-skin';
        document.head.appendChild(marker);
        return 'guarded';
      })()
    `;
  }

  _restoreCode() {
    return `
      (function() {
        let removed = 0;
        document.querySelectorAll('style, link[rel="stylesheet"]').forEach(function(el) {
          if (el.id && (el.id.includes('cdp') || el.id.includes('dream-skin') || el.id.includes('CDP'))) {
            el.remove();
            removed++;
          }
        });
        document.querySelectorAll('meta[id="__cdp_dream_skin__"]').forEach(function(el) {
          el.remove();
        });
        return removed;
      })()
    `;
  }
}

module.exports = CDPInjector;
