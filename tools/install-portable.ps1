[CmdletBinding()]
param(
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$INSTALL_ROOT = Join-Path $env:LOCALAPPDATA 'ClaudeCodeDreamSkin'
$VERSION = '0.1.0'
$ZIP_URL = 'https://github.com/TQSY114514/claude-code-dream-skin/releases/latest/download/Claude-Code-Dream-Skin-v0.1.0-portable.zip'

function Show-Box {
  param([string]$Message, [string]$Kind = 'Info')
  if ($Silent) { return }
  Add-Type -AssemblyName System.Windows.Forms
  $icon = if ($Kind -eq 'Error') {
    [System.Windows.Forms.MessageBoxIcon]::Error
  } else {
    [System.Windows.Forms.MessageBoxIcon]::Information
  }
  [void][System.Windows.Forms.MessageBox]::Show($Message, 'Claude Code Dream Skin', [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
}

try {
  Write-Host '=== Claude Code Dream Skin Installer ==='
  Write-Host "Installing to: $INSTALL_ROOT"

  # Create install directory
  if (-not (Test-Path $INSTALL_ROOT)) {
    New-Item -ItemType Directory -Force -Path $INSTALL_ROOT | Out-Null
  }

  $zipPath = Join-Path $env:TEMP "ClaudeCodeDreamSkin-$VERSION.zip"

  # Download portable zip from GitHub releases
  Write-Host 'Downloading...'
  Invoke-WebRequest -Uri $ZIP_URL -OutFile $zipPath -UseBasicParsing

  # Extract
  Write-Host 'Extracting...'
  if (Test-Path $zipPath) {
    Expand-Archive -LiteralPath $zipPath -DestinationPath $INSTALL_ROOT -Force
    Remove-Item $zipPath -Force
  }

  # Create desktop shortcut
  $exePath = Join-Path $INSTALL_ROOT 'Claude Code Dream Skin.exe'
  if (-not (Test-Path $exePath)) {
    throw "Installation failed: executable not found at $exePath"
  }

  $desktopPath = [Environment]::GetFolderPath('Desktop')
  $shortcutPath = Join-Path $desktopPath 'Claude Code Dream Skin.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $exePath
  $shortcut.WorkingDirectory = $INSTALL_ROOT
  $shortcut.Description = 'Claude Code Dream Skin'
  $shortcut.Save()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null

  Write-Host ''
  Write-Host 'Installation complete!'
  Write-Host "Shortcut created on Desktop"

  if (-not $Silent) {
    $launch = [System.Windows.Forms.MessageBox]::Show(
      'Installation complete! Launch now?',
      'Claude Code Dream Skin',
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Information
    )
    if ($launch -eq [System.Windows.Forms.DialogResult]::Yes) {
      Start-Process $exePath
    }
  }
} catch {
  Show-Box -Message "Installation failed: $($_.Exception.Message)" -Kind Error
  Write-Error $_
  exit 1
}
