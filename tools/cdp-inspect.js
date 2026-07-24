/**
 * Claude Code Dream Skin — CDP DOM Inspector
 *
 * Usage: node tools/cdp-inspect.js
 *
 * This script will:
 * 1. Kill Claude Desktop
 * 2. Relaunch with --remote-debugging-port=9222
 * 3. Connect via CDP
 * 4. Inject a test CSS (colored borders on all elements)
 * 5. Dump the DOM structure to a JSON file
 * 6. Wait for you to inspect Claude Desktop
 * 7. Restore original state when you press Enter
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');

const DEBUG_PORT = 9222;
const USER_DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'Claude-3p');
const CLAUDE_EXE = 'C:\\Program Files\\WindowsApps\\Claude_1.24012.1.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe';
const OUTPUT_DIR = path.join(os.homedir(), '.claude-dream-skin', 'inspect');

// Test CSS that reveals element boundaries and classes
const TEST_CSS = `
/* TEST: Element boundary visualization */
* {
  outline: 1px solid rgba(255, 0, 0, 0.15) !important;
}

/* Highlight common Claude Desktop areas */
[class*="sidebar"] { outline: 2px solid #ff0000 !important; background: rgba(255,0,0,0.05) !important; }
[class*="Sidebar"] { outline: 2px solid #ff0000 !important; }
[class*="message"] { outline: 2px solid #00ff00 !important; background: rgba(0,255,0,0.03) !important; }
[class*="Message"] { outline: 2px solid #00ff00 !important; }
[class*="chat"] { outline: 2px solid #0088ff !important; }
[class*="Chat"] { outline: 2px solid #0088ff !important; }
[class*="input"] { outline: 2px solid #ff00ff !important; }
[class*="Input"] { outline: 2px solid #ff00ff !important; }
[class*="composer"] { outline: 2px solid #ff00ff !important; }
[class*="textbox"] { outline: 2px solid #ffff00 !important; }
[contenteditable="true"] { outline: 2px solid #ffff00 !important; }
[role="textbox"] { outline: 2px solid #ffff00 !important; }
[class*="code"] { outline: 2px solid #00ffff !important; background: rgba(0,255,255,0.03) !important; }
[class*="Code"] { outline: 2px solid #00ffff !important; }
pre { outline: 2px solid #00ffff !important; }
[class*="markdown"] { outline: 2px solid #ff8800 !important; }
[class*="nav"] { outline: 2px solid #ff0000 !important; }
nav { outline: 2px solid #ff0000 !important; }
aside { outline: 2px solid #ff0000 !important; }
[class*="button"] { outline: 1px solid #ffffff !important; }
button { outline: 1px solid rgba(255,255,255,0.3) !important; }
[class*="header"] { outline: 2px solid #ffffff !important; }
[class*="Header"] { outline: 2px solid #ffffff !important; }
[class*="footer"] { outline: 2px solid #ffffff !important; }
[class*="panel"] { outline: 2px solid #888888 !important; }
[class*="Panel"] { outline: 2px solid #888888 !important; }
`;

// Color legend for the output
const COLOR_LEGEND = `
Color Legend (element outlines):
  RED    = sidebar / nav
  GREEN  = message
  BLUE   = chat container
  MAGENTA= input / composer
  YELLOW = textbox / editable
  CYAN   = code block
  ORANGE = markdown
  WHITE  = buttons, headers, footers
  GRAY   = panels
`;

async function isPortInUse(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port, '127.0.0.1');
    setTimeout(() => { server.close(); resolve(false); }, 500);
  });
}

async function waitForCDP(port, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const data = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 2000 }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
          });
        }).on('error', reject);
      });
      if (data.Browser && data.Browser.includes('Electron')) return data;
    } catch (e) { /* not ready */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`CDP not available on port ${port}`);
}

function killClaude() {
  console.log('[1] Killing Claude Desktop...');
  try {
    execSync('taskkill /F /IM Claude.exe', { timeout: 5000, stdio: 'pipe' });
  } catch (e) { /* ignore */ }

  // Wait for processes to die
  let attempts = 0;
  while (attempts < 20) {
    try {
      const output = execSync('tasklist /FI "IMAGENAME eq Claude.exe" /FO CSV /NH', {
        encoding: 'utf8', timeout: 3000
      });
      if (!output.includes('Claude.exe')) break;
    } catch (e) { break; }
    attempts++;
    console.log(`    Waiting for Claude to close... (${attempts}/20)`);
    require('child_process').execSync('timeout /t 1 /nobreak >nul');
  }
  console.log('    Claude Desktop stopped.');
}

function launchClaudeWithCDP() {
  console.log('[2] Launching Claude Desktop with CDP...');
  exec('cmd.exe /C start "" "' + CLAUDE_EXE + '" --remote-debugging-port=' + DEBUG_PORT, (error) => {
    if (error) {
      console.error('    Failed to launch:', error);
      process.exit(1);
    }
    console.log('    Claude launched. Waiting for CDP...');
  });
}

async function connectCDP(port) {
  const CDP = require('chrome-remote-interface');
  const client = await CDP({ port });
  const { Target, CSS, Runtime, Page, DOM } = client;

  await Target.enable();
  await Page.enable();
  await DOM.enable();

  return { client, Target, CSS, Runtime, Page, DOM };
}

async function injectTestCSS(client, CSS) {
  console.log('[3] Injecting test CSS...');

  // Method 1: CSS.addStyleSheet
  await CSS.enable();
  const result = await CSS.addStyleSheet({
    source: TEST_CSS,
    title: 'CDP-Test-Overlay',
  });
  console.log(`    Stylesheet injected (id: ${result.styleSheetId})`);
  return result.styleSheetId;
}

async function dumpDOM(client, Runtime, DOM) {
  console.log('[4] Dumping DOM structure...');

  // Get the full document tree
  const { root } = await DOM.getDocument({ depth: 2, pierce: true });

  // Also get a summary of all elements with their classes
  const domSummary = await Runtime.evaluate({
    expression: `
      (function() {
        const results = {
          url: location.href,
          title: document.title,
          bodyClasses: document.body?.className || '',
          bodyId: document.body?.id || '',
          htmlClasses: document.documentElement?.className || '',
          htmlId: document.documentElement?.id || '',
          elements: [],
          allClasses: {},
          sidebarHints: [],
          chatHints: [],
          inputHints: [],
          codeHints: [],
          navHints: []
        };

        // Scan all elements (limit to first 500 to avoid timeout)
        const all = document.querySelectorAll('*');
        const limit = Math.min(all.length, 500);
        for (let i = 0; i < limit; i++) {
          const el = all[i];
          const info = {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            classes: (el.className || '').toString().trim(),
            classList: Array.from(el.classList || []),
            role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            textContent: (el.textContent || '').trim().substring(0, 50),
            childCount: el.children.length,
          };
          results.elements.push(info);

          // Collect all unique classes
          for (const cls of info.classList) {
            results.allClasses[cls] = (results.allClasses[cls] || 0) + 1;
          }

          // Classify elements
          const cls = info.classes.toLowerCase();
          if (cls.includes('sidebar') || cls.includes('nav') || el.tagName === 'NAV' || el.tagName === 'ASIDE') {
            results.navHints.push({ tag: info.tag, classes: info.classes, id: info.id, role: info.role });
          }
          if (cls.includes('message') || cls.includes('chat') || cls.includes('conversation')) {
            results.chatHints.push({ tag: info.tag, classes: info.classes, id: info.id, role: info.role });
          }
          if (cls.includes('input') || cls.includes('composer') || cls.includes('textbox') || el.getAttribute('contenteditable') === 'true' || info.role === 'textbox') {
            results.inputHints.push({ tag: info.tag, classes: info.classes, id: info.id, role: info.role });
          }
          if (cls.includes('code') || el.tagName === 'PRE' || el.tagName === 'CODE') {
            results.codeHints.push({ tag: info.tag, classes: info.classes, id: info.id, role: info.role });
          }
        }

        // Sort classes by frequency
        results.topClasses = Object.entries(results.allClasses)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 50)
          .map(([name, count]) => ({ name, count }));

        return results;
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });

  return domSummary.result?.value || domSummary.result;
}

function saveResults(data) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Save full DOM dump
  const domPath = path.join(OUTPUT_DIR, `dom-${timestamp}.json`);
  fs.writeFileSync(domPath, JSON.stringify(data, null, 2));
  console.log(`    DOM dump saved: ${domPath}`);

  // Save a readable summary
  const summaryPath = path.join(OUTPUT_DIR, `summary-${timestamp}.txt`);
  let summary = `Claude Code Desktop DOM Inspector Results\n`;
  summary += `========================================\n`;
  summary += `URL: ${data.url}\n`;
  summary += `Title: ${data.title}\n`;
  summary += `Body classes: ${data.bodyClasses}\n`;
  summary += `Body ID: ${data.bodyId}\n`;
  summary += `HTML classes: ${data.htmlClasses}\n`;
  summary += `HTML ID: ${data.htmlId}\n\n`;

  summary += `TOP 50 CSS CLASSES (by frequency):\n`;
  summary += '-'.repeat(40) + '\n';
  for (const c of data.topClasses) {
    summary += `  ${c.name.padEnd(40)} (${c.count})\n`;
  }

  if (data.navHints.length) {
    summary += `\nSIDEBAR / NAV ELEMENTS:\n`;
    summary += '-'.repeat(40) + '\n';
    for (const h of data.navHints) {
      summary += `  <${h.tag} class="${h.classes}" id="${h.id}" role="${h.role}">\n`;
    }
  }

  if (data.chatHints.length) {
    summary += `\nCHAT / MESSAGE ELEMENTS:\n`;
    summary += '-'.repeat(40) + '\n';
    for (const h of data.chatHints.slice(0, 20)) {
      summary += `  <${h.tag} class="${h.classes}" id="${h.id}" role="${h.role}">\n`;
    }
  }

  if (data.inputHints.length) {
    summary += `\nINPUT / COMPOSER ELEMENTS:\n`;
    summary += '-'.repeat(40) + '\n';
    for (const h of data.inputHints) {
      summary += `  <${h.tag} class="${h.classes}" id="${h.id}" role="${h.role}">\n`;
    }
  }

  if (data.codeHints.length) {
    summary += `\nCODE BLOCK ELEMENTS:\n`;
    summary += '-'.repeat(40) + '\n';
    for (const h of data.codeHints.slice(0, 20)) {
      summary += `  <${h.tag} class="${h.classes}" id="${h.id}" role="${h.role}">\n`;
    }
  }

  summary += `\nTotal elements scanned: ${data.elements.length}\n`;
  fs.writeFileSync(summaryPath, summary);
  console.log(`    Summary saved: ${summaryPath}`);

  return { domPath, summaryPath };
}

async function main() {
  console.log(COLOR_LEGEND);
  console.log('Claude Code Dream Skin — CDP DOM Inspector');
  console.log('='.repeat(50));
  console.log(`Output directory: ${OUTPUT_DIR}\n`);

  // Step 1: Kill Claude
  killClaude();

  // Step 2: Launch with CDP
  launchClaudeWithCDP();

  // Step 3: Wait for CDP
  console.log('[3] Waiting for CDP endpoint...');
  let cdpInfo;
  try {
    cdpInfo = await waitForCDP(DEBUG_PORT, 20000);
    console.log(`    Connected! Browser: ${cdpInfo.Browser}`);
  } catch (e) {
    console.error('    ERROR: ' + e.message);
    console.log('\nMake sure Claude Desktop is installed and can launch.');
    process.exit(1);
  }

  // Step 4: Connect CDP
  let client, CSS, styleSheetId;
  try {
    const cdp = await connectCDP(DEBUG_PORT);
    client = cdp.client;
    CSS = cdp.CSS;

    // Step 5: Inject test CSS
    styleSheetId = await injectTestCSS(client, CSS);

    console.log('\n' + '='.repeat(50));
    console.log('TEST CSS INJECTED INTO CLAUDE DESKTOP!');
    console.log('='.repeat(50));
    console.log('\nLook at Claude Desktop window — you should see colored outlines:');
    console.log(COLOR_LEGEND);
    console.log('\nTake a screenshot if possible, then note which elements');
    console.log('are highlighted. This tells us the actual CSS class names.');
    console.log('\nPress Enter to dump DOM structure and restore...');
    console.log('(Waiting 60 seconds max...)');

    // Wait for user input or timeout
    await new Promise((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.once('data', () => {
        stdin.setRawMode(false);
        stdin.pause();
        resolve();
      });
      setTimeout(() => {
        stdin.setRawMode(false);
        stdin.pause();
        console.log('\n(Timeout — proceeding automatically)');
        resolve();
      }, 60000);
    });

  } catch (e) {
    console.error('CDP Error:', e.message);
  }

  // Step 6: Dump DOM
  if (client) {
    try {
      const Runtime = client;
      // Need to get Runtime from the client
      const { Runtime: RT, DOM: DM } = client;
      const data = await dumpDOM(client, RT, DM);
      const paths = saveResults(data);

      console.log('\n' + '='.repeat(50));
      console.log('DOM STRUCTURE DUMPED');
      console.log('='.repeat(50));
      console.log(`\n  Full JSON: ${paths.domPath}`);
      console.log(`  Readable:  ${paths.summaryPath}`);
      console.log('\nOpen the summary file and look for:');
      console.log('  - TOP CSS CLASSES section');
      console.log('  - SIDEBAR / NAV ELEMENTS');
      console.log('  - CHAT / MESSAGE ELEMENTS');
      console.log('  - INPUT / COMPOSER ELEMENTS');
      console.log('  - CODE BLOCK ELEMENTS');

      // Print top classes to console
      console.log('\nTop CSS classes found:');
      for (const c of data.topClasses.slice(0, 20)) {
        console.log(`  ${c.name.padEnd(40)} (${c.count})`);
      }
    } catch (e) {
      console.error('DOM dump error:', e.message);
    }
  }

  // Step 7: Restore
  console.log('\n[Restore] Removing test CSS...');
  if (client && CSS) {
    try {
      await CSS.removeStyleSheet({ styleSheetId });
    } catch (e) { /* ignore */ }
    try {
      await client.close();
    } catch (e) { /* ignore */ }
  }
  console.log('[Restore] Done. Claude Desktop retains the injected CSS until next reload.');
  console.log('\nNext steps:');
  console.log('  1. Share the summary file content (dom-inspect/summary-*.txt)');
  console.log('  2. Or describe which elements got colored outlines in Claude Desktop');
  console.log('  3. We will refine CSS selectors based on actual class names');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
