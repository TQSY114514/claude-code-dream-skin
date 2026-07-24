# Architecture Reference

## Claude Code Desktop Analysis

### Version Detected
- **Version**: 1.24012.1
- **Electron**: 42.7.0
- **Chromium**: ~120 (based on Electron 42)
- **Platform**: Windows (MSIX Store package)

### Installation Path
```
C:\Program Files\WindowsApps\Claude_1.24012.1.0_x64__pzs8sxrjxfjjc\app\
├── Claude.exe              (Main executable, GUI PE32+)
├── resources\
│   ├── app.asar            (Application bundle)
│   ├── app.asar.unpacked\
│   │   ├── node_modules\
│   │   └── resources\
│   └── *.pak               (Chromium resources)
├── locales\                 (i18n files)
├── chrome_100_percent.pak
├── vk_swiftshader.dll      (Vulkan renderer)
└── ...
```

### Process Architecture
```
Claude.exe (main process, PID 21336)
├── --type=gpu-process
├── --type=utility (network service)
├── --type=utility (node service) x4
├── --type=crashpad-handler
└── --type=renderer (UI process)
    └── --app-path="...\resources\app.asar"
```

### User Data Directories
| Path | Purpose |
|------|---------|
| `%LOCALAPPDATA%\Claude-3p\` | Main user data (profiles, cache) |
| `%LOCALAPPDATA%\Claude-3p\claude-code\2.1.217\` | CLI binary cache |
| `%APPDATA%\AnthropicClaude\claude_desktop_config.json` | Desktop config |

### Key Findings

1. **NOT Electron CLI** — The CLI (`@anthropic-ai/claude-code`) is a Node.js console tool. Claude Desktop is a SEPARATE Electron app.
2. **CDP Not Enabled** — No `--remote-debugging-port` flag in process command lines. No `DevTools ActivePort` file.
3. **Custom Schemes** — `app:`, `cowork-artifact:`, `claude-media:`, `claude-simulator:`, `sentry-ipc:`
4. **Helper Service** — `cowork-svc.exe` runs alongside the main process
5. **MSIX Package** — Installed via Windows Store, read-only, requires relaunch with debug flags

## CDP Injection Strategy

### Phase 1: Detection
```javascript
// Scan for Claude process
const output = execSync('wmic process where "name=\'Claude.exe\'" get CommandLine /format:list');
```

### Phase 2: Relaunch with CDP
```javascript
// Kill existing and relaunch with --remote-debugging-port
exec('taskkill /F /IM Claude.exe');
setTimeout(() => {
  exec('cmd.exe /C start "" "C:\\Program Files\\WindowsApps\\...\\Claude.exe" --remote-debugging-port=9222');
}, 2000);
```

### Phase 3: Connect and Inject
```javascript
const CDP = require('chrome-remote-interface');
const client = await CDP({ port: 9222 });

// Inject CSS stylesheet
const { CSS } = client;
await CSS.addStyleSheet({
  source: ':root { --ds-bg: #0a0a0f; } body { background: var(--ds-bg); }'
});
```

### Phase 4: Monitor Navigation
```javascript
client.on('Target.targetCreated', async (event) => {
  if (event.targetInfo.type === 'page') {
    setTimeout(() => injectIntoTarget(event.targetInfo.targetId), 500);
  }
});
```

## Security Model

- CDP binds to `127.0.0.1` only (loopback)
- No remote access possible
- Theme files stored in `~/.claude-dream-skin/` (user home directory)
- No modification to official Claude installation
- All changes reversible via backup system

## Injection Selectors

Since Claude Desktop's actual CSS class names are unknown (app.asar is bundled),
we use broad selectors that will match common patterns:

```css
.dream-skin-active [class*="sidebar"] { ... }
.dream-skin-active [class*="message"] { ... }
.dream-skin-active [class*="markdown"] { ... }
.dream-skin-active [class*="code"] { ... }
.dream-skin-active [contenteditable="true"] { ... }
```

These selectors will match elements regardless of the exact class naming.
