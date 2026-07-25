[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AppId,
  [string]$Arguments = '',
  [string]$ArgumentsFile = ''
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("1762a24d-7864-4f9e-9258-54a3664ddcf5"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager {
    [PreserveSig]
    int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
                            [MarshalAs(UnmanagedType.LPWStr)] string args,
                            uint options,
                            out uint processId);
}

[ComImport, Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c"),
 ClassInterface(ClassInterfaceType.None)]
class ApplicationActivationManager : IApplicationActivationManager {}
'@

if ($ArgumentsFile -and (Test-Path $ArgumentsFile)) {
  $Arguments = Get-Content $ArgumentsFile -Raw -Encoding UTF8
}

$mgr = [ApplicationActivationManager]::new()
$pid = 0
$hr = $mgr.ActivateApplication($AppId, $Arguments, 0, [ref]$pid)
if ($hr -ne 0) {
    throw [System.ComponentModel.Win32Exception]::new($hr, "ActivateApplication failed (HR=0x$($hr.ToString('X8')))")
}
Write-Host "Activated: PID=$pid"
