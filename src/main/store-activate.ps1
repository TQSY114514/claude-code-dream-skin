[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AppId,
  [string]$Arguments = '',
  [string]$ArgumentsFile = ''
)

# IApplicationActivationManager COM activation for Store apps.
#
# Why this structure:
#   - [ComImport] coclasses with ClassInterface(ClassInterfaceType.None) require
#     explicit method implementations, but [ComImport] members must be
#     abstract/extern — impossible in C#. And [Type]::GetTypeFromCLSID returns
#     a late-bound __ComObject that rejects casts to a managed interface
#     (E_NOINTERFACE) because the CLR's QueryInterface doesn't match the
#     interface IID registered for the native object.
#   - Solution: declare only the interface, get the coclass via its ProgID
#     'Windows.ApplicationModel.Activation.ApplicationActivationManager' using
#     New-Object -ComObject (which creates a __ComObject via CoCreateInstance),
#     then call ActivateApplication dynamically through the IDispatch path
#     ([System.__ComObject] exposes IDispatch, so PowerShell's dynamic dispatch
#     resolves the method by name at runtime).

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace DreamSkin {
    [ComImport, Guid("1762a24d-7864-4f9e-9258-54a3664ddcf5"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IApplicationActivationManager {
        [PreserveSig]
        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
                                [MarshalAs(UnmanagedType.LPWStr)] string args,
                                uint options,
                                out uint processId);
    }
}
'@

if ($ArgumentsFile -and (Test-Path $ArgumentsFile)) {
  $Arguments = Get-Content $ArgumentsFile -Raw -Encoding UTF8
}

# Create the COM object via its ProgID (CoCreateInstance internally).
# Returns a __ComObject that exposes IDispatch; PowerShell invokes methods
# on it dynamically by name, bypassing the managed-interface QueryInterface
# that fails with E_NOINTERFACE when using [Type]::GetTypeFromCLSID.
$mgr = New-Object -ComObject 'Windows.ApplicationModel.Activation.ApplicationActivationManager' -ErrorAction Stop

# $PID is a read-only automatic variable in PowerShell — use a different name.
$procId = 0
# Dynamic dispatch: PowerShell resolves 'ActivateApplication' via IDispatch.
$hr = $mgr.ActivateApplication($AppId, $Arguments, 0, [ref]$procId)
if ($hr -ne 0) {
    throw [System.ComponentModel.Win32Exception]::new($hr, "ActivateApplication failed (HR=0x$($hr.ToString('X8')))")
}
Write-Host "Activated: PID=$procId"
