@echo off
chcp 65001 >nul
echo === Registering IApplicationActivationManager interface ===

reg add "HKCR\Interface\{1762A24D-7864-4F9E-9258-54A3664DDCF5}" /ve /d "IApplicationActivationManager" /f
reg add "HKCR\Interface\{1762A24D-7864-4F9E-9258-54A3664DDCF5}\NumMethods" /ve /d "4" /f
reg add "HKCR\Interface\{1762A24D-7864-4F9E-9258-54A3664DDCF5}\ProxyStubCls32" /ve /d "{00020424-0000-0000-C000-000000000046}" /f
reg add "HKCR\Interface\{1762A24D-7864-4F9E-9258-54A3664DDCF5}\ProxyStubCls32\{00020424-0000-0000-C000-000000000046}" /ve /d "oleaut32.dll" /f

echo.
echo === Verify registration ===
reg query "HKCR\Interface\{1762A24D-7864-4F9E-9258-54A3664DDCF5}" 2>nul

echo.
echo === Testing COM activation (activator.exe) ===
cd /d "d:\claude-code-dream-skin-main"
tools\activator.exe "Claude_pzs8sxrjxfjjc!Claude" "--remote-debugging-port=9222"
echo Exit code: %ERRORLEVEL%

echo.
echo === Waiting 12s for Claude to start ===
timeout /t 12 /nobreak >nul

echo === Claude processes ===
tasklist /fi "imagename eq Claude.exe" 2>nul

echo === Port 9222 check ===
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 3; Write-Host ('CDP READY! ' + $r.Content.Substring(0,200)) } catch { Write-Host ('CDP down: ' + $_.Exception.Message) }"

echo.
echo === DONE - press any key to close ===
pause >nul
