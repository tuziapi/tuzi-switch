# Diagnose the pinned NSIS restart helper on a disposable Windows runner.
# This does not install the desktop app or count as upgrade acceptance.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP 'tuzi-nsis-environment-probe'
if (Test-Path $root) { throw 'Refusing to reuse probe directory' }
New-Item -ItemType Directory -Path $root | Out-Null
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ProbeDesktop {
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
}
'@
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$report = [ordered]@{
  kind = 'windows-nsis-environment-diagnostic'
  officialUpgradeAcceptance = $false
  administratorToken = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  shellWindowPresent = [ProbeDesktop]::GetShellWindow() -ne [IntPtr]::Zero
  sessionId = (Get-Process -Id $PID).SessionId
  nsisVersion = '3.11'
  restartHelperVersion = '0.5.3'
}
$report | ConvertTo-Json | Set-Content (Join-Path $root 'environment.json')

# Exact upstream tools and checksums used by the locked Tauri CLI 2.10.1.
$archive = Join-Path $root 'nsis.zip'
Invoke-WebRequest 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip' -OutFile $archive
if ((Get-FileHash $archive -Algorithm SHA1).Hash -ne 'EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D') { throw 'NSIS checksum mismatch' }
Expand-Archive $archive (Join-Path $root 'toolchain')
$compiler = @(Get-ChildItem (Join-Path $root 'toolchain') -Filter makensis.exe -Recurse | Where-Object { $_.Directory.Name -ne 'Bin' })
if ($compiler.Count -ne 1) { throw 'Expected one NSIS compiler' }
$compilerPath = $compiler[0].FullName
$plugins = Join-Path $root 'plugins'
New-Item -ItemType Directory -Path $plugins | Out-Null
$helper = Join-Path $plugins 'nsis_tauri_utils.dll'
Invoke-WebRequest 'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll' -OutFile $helper
if ((Get-FileHash $helper -Algorithm SHA1).Hash -ne '75197FEE3C6A814FE035788D1C34EAD39349B860') { throw 'Restart helper checksum mismatch' }

$childSource = Join-Path $root 'probe-child.cs'
@'
using System;
using System.IO;
class ProbeChild {
  static void Main(string[] args) {
    if (args.Length != 1) Environment.Exit(2);
    bool preserved = Environment.GetEnvironmentVariable("TUZI_SYNTHETIC_RESTART_PROBE") == "SYNTHETIC";
    File.WriteAllText(args[0], "{\"environmentPreserved\":" + (preserved ? "true" : "false") + ",\"argumentCount\":1}");
  }
}
'@ | Set-Content $childSource
$child = Join-Path $root 'probe-child.exe'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$child" $childSource
if ($LASTEXITCODE -ne 0) { throw 'Synthetic child compilation failed' }
$env:TUZI_SYNTHETIC_RESTART_PROBE = 'SYNTHETIC'
& $child (Join-Path $root 'direct-child.json')
if ($LASTEXITCODE -ne 0) { throw 'Direct synthetic child failed' }

$script = @'
Unicode true
Name "Tuzi restart environment probe"
OutFile "restart-probe.exe"
RequestExecutionLevel user
SilentInstall silent
!addplugindir "plugins"
Section
  nsis_tauri_utils::RunAsUser "$EXEDIR\probe-child.exe" '"$EXEDIR\restarted-child.json"'
  Pop $0
  FileOpen $1 "$EXEDIR\helper-result.txt" w
  FileWrite $1 "$0"
  FileClose $1
SectionEnd
'@
$script | Set-Content (Join-Path $root 'probe.nsi')
Push-Location $root
try {
  & $compilerPath /V2 probe.nsi
  if ($LASTEXITCODE -ne 0) { throw 'NSIS probe compilation failed' }
  $process = Start-Process (Join-Path $root 'restart-probe.exe') -PassThru -Wait
  $report.installerExitCode = $process.ExitCode
  $report.helperReturn = (Get-Content (Join-Path $root 'helper-result.txt') -Raw).Trim()
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  $restarted = Join-Path $root 'restarted-child.json'
  while (!(Test-Path $restarted) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
  $report.directChild = Get-Content (Join-Path $root 'direct-child.json') -Raw | ConvertFrom-Json
  $report.restartedChildPresent = Test-Path $restarted
  if ($report.restartedChildPresent) { $report.restartedChild = Get-Content $restarted -Raw | ConvertFrom-Json }
  $report | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'environment.json')
  $report | ConvertTo-Json -Depth 4 | Write-Output
} finally { Pop-Location }
