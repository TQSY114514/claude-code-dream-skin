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

# Create the COM object directly via CoCreateInstance with the known CLSID
# {45ba127d-10a8-46ea-8ab7-56ea9078943c}. The ProgID
# 'Windows.ApplicationModel.Activation.ApplicationActivationManager' is NOT
# registered on some Windows installs (Store components missing it), so
# New-Object -ComObject fails with REGDB_E_CLASSNOTREG. CoCreateInstance
# with an explicit CLSID + IID_IUnknown works as long as the CLSID is
# registered (it is — it ships with Windows).
$CLSID_AAM = [Guid]'45ba127d-10a8-46ea-8ab7-56ea9078943c'
$IID_IUnknown = [Guid]'00000000-0000-0000-C000-000000000046'
$type = [Type]::GetTypeFromCLSID($CLSID_AAM)
if ($null -eq $type) {
    throw "GetTypeFromCLSID returned null — CLSID {45ba127d-...} not registered"
}
$mgr = [Activator]::CreateInstance($type)
if ($null -eq $mgr) {
    throw "Activator.CreateInstance returned null"
}

# $PID is a read-only automatic variable in PowerShell — use a different name.
$procId = 0
# Dynamic dispatch: PowerShell resolves 'ActivateApplication' via IDispatch,
# which the __ComObject exposes regardless of whether the
# IApplicationActivationManager interface is registered.
try {
    $hr = $mgr.ActivateApplication($AppId, $Arguments, 0, [ref]$procId)
} catch [System.Runtime.InteropServices.COMException] {
    # Late-binding COM calls sometimes surface HRESULTs as exceptions.
    $hr = $_.Exception.HResult
    if ($hr -eq 0) { throw }
}
if ($hr -ne 0) {
    throw [System.ComponentModel.Win32Exception]::new($hr, "ActivateApplication failed (HR=0x$($hr.ToString('X8')))")
}
Write-Host "Activated: PID=$procId"
