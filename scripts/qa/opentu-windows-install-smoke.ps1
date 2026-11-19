param([Parameter(Mandatory=$true)][string]$Installer, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path $Installer).Path
$lab = Join-Path $env:RUNNER_TEMP 'opentu-beta5-installed-smoke'
if (-not $env:CI -or -not $env:RUNNER_TEMP) { throw 'Disposable CI runner required' }
if (Test-Path $lab) { throw 'Use a fresh smoke directory' }
New-Item -ItemType Directory -Path $lab | Out-Null
$destination = Join-Path $lab 'OpenTu Preview'
$before = @(Get-ChildItem Cert:\CurrentUser\Root,Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'Tuzi Claude' } | ForEach-Object { $_.Thumbprint } | Sort-Object)
$report = [ordered]@{ installerSha256=(Get-FileHash $installerPath -Algorithm SHA256).Hash.ToLower(); installed=$false; windowOpened=$false; restarted=$false; localCertificateUnchanged=$false; claudeConversationVerified=$false }
$app = $null
try {
    $setup = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$destination") -PassThru
    if (-not $setup.WaitForExit(180000)) { $setup.Kill(); throw 'Installer timed out' }
    if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
    $binary = Join-Path $destination 'tuzi-opentu-preview.exe'
    if (-not (Test-Path -LiteralPath $binary)) { throw 'Installed application missing' }
    $report.installed = $true
    $report.productVersion = (Get-Item -LiteralPath $binary).VersionInfo.ProductVersion
    foreach ($round in 1,2) {
        $app = Start-Process -FilePath $binary -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        do {
            Start-Sleep -Milliseconds 500
            $app.Refresh()
            if ($app.HasExited) { throw "Installed app exited during startup: $($app.ExitCode)" }
        } until ($app.MainWindowHandle -ne 0 -or [DateTime]::UtcNow -gt $deadline)
        if ($app.MainWindowHandle -eq 0) { throw 'Installed app did not open a native window' }
        if ($round -eq 1) { $report.windowOpened = $true } else { $report.restarted = $true }
        Stop-Process -Id $app.Id
        $app.WaitForExit()
        $app = $null
    }
    $after = @(Get-ChildItem Cert:\CurrentUser\Root,Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'Tuzi Claude' } | ForEach-Object { $_.Thumbprint } | Sort-Object)
    if (($before -join ',') -ne ($after -join ',')) { throw 'Claude local certificate store changed' }
    $report.localCertificateUnchanged = $true
} finally {
    if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Output -Encoding utf8
}
