# Claude Code Dream Skin - Installation Guide (Windows)

## Requirements
- Windows 10/11 (64-bit)
- Node.js >= 18 (for development build)
- Claude Code Desktop installed (from Microsoft Store)

## Quick Install (Development)

1. Clone or download this repository
2. Open PowerShell in the project directory
3. Run:
   ```powershell
   npm install
   npm start
   ```

## Build Installer

```powershell
npm run build:win
```

The installer will be generated in `dist/`.

## Using the App

1. Make sure Claude Code Desktop is installed and you can launch it
2. Launch "Claude Code Dream Skin" from the desktop shortcut or start menu
3. If Claude is not running with CDP, click "Launch Claude + CDP" in Settings tab
4. Select a theme from the Themes tab
5. Click "Apply" to inject the theme into Claude Desktop
6. Minimize to system tray when not in use

## How It Works

Dream Skin Manager is a background tray app that:
1. Detects Claude Desktop processes
2. Optionally restarts Claude with `--remote-debugging-port=9222`
3. Connects via Chrome DevTools Protocol
4. Injects CSS themes into the renderer process

No files in the Claude Desktop installation are ever modified.

## Restore Default

Click "Restore Default" in the tray menu or manager window to remove all theme injection and restore the original appearance.

## Uninstall

- Use Windows "Add or Remove Programs" to uninstall
- Theme data is preserved in `%USERPROFILE%\.claude-dream-skin\` (safe to delete)
- Claude Desktop settings are untouched
