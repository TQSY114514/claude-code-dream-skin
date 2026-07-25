[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AppId,
  [string]$Arguments = ''
)

# Use IApplicationActivationManager COM interface to launch a Store-packaged
# app with command-line arguments. This is the ONLY method that works for
# Store apps (Start-Process -AppUserModelId silently ignores arguments).
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("1762a24d-7864-4f9e-9258-54a3664ddcf5"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager {
    int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
                            [MarshalAs(UnmanagedType.LPWStr)] string args,
                            uint options);
}

[ComImport, Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c"),
 ClassInterface(ClassInterfaceType.None)]
class ApplicationActivationManager : IApplicationActivationManager {}
'@

$mgr = [ApplicationActivationManager]::new()
$hr = $mgr.ActivateApplication($AppId, $Arguments, 0)
if ($hr -ne 0) {
    throw [System.ComponentModel.Win32Exception]::new($hr, "ActivateApplication failed")
}
