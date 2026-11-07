<#
.SYNOPSIS
Read-only architecture reconnaissance for a locally installed Windows Zalo PC app.
.DESCRIPTION
Collects process metadata, version, signature, common runtime markers, and
aggregate counts of UI-related file types in the installation directory.
Does not modify Zalo, attach to any process, access chat data, read credentials,
inspect user profile caches, or connect to the network.
.EXAMPLE
powershell -NoProfile -File .\tools\Inspect-Zalo.ps1
.EXAMPLE
powershell -NoProfile -File .\tools\Inspect-Zalo.ps1 -InstallPath 'C:\Path\To\Zalo'
#>
[CmdletBinding()]
param(
    [string]$InstallPath,
    [string]$OutputPath
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Sanitize-Path([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    if ($env:USERPROFILE) {
        return [regex]::Replace($Value, [regex]::Escape($env:USERPROFILE), '%USERPROFILE%', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    return $Value
}

$processes = @()
try {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object { $_.Name -match '(?i)zalo' })
} catch {
    Write-Warning "Cannot query processes with CIM: $($_.Exception.Message)"
}

$firstExe = @($processes | Where-Object { $_.ExecutablePath -and (Test-Path -LiteralPath $_.ExecutablePath) } |
    Select-Object -First 1 -ExpandProperty ExecutablePath)

if ([string]::IsNullOrWhiteSpace($InstallPath)) {
    if ($firstExe.Count -gt 0) { $InstallPath = Split-Path -Parent $firstExe[0] }
}
if ([string]::IsNullOrWhiteSpace($InstallPath)) {
    throw 'Zalo is not running or its executable path is not visible. Open Zalo, then retry, or pass -InstallPath explicitly.'
}
if (-not (Test-Path -LiteralPath $InstallPath -PathType Container)) {
    throw "Install directory not found: $InstallPath"
}
$installDirectory = (Resolve-Path -LiteralPath $InstallPath).Path

$markerPaths = @(
    'resources\app.asar',
    'resources\app\package.json',
    'resources\app.asar.unpacked',
    'chrome_100_percent.pak',
    'chrome_200_percent.pak',
    'resources.pak',
    'icudtl.dat',
    'v8_context_snapshot.bin',
    'libEGL.dll',
    'libGLESv2.dll'
)
$markers = @(
    foreach ($relative in $markerPaths) {
        [pscustomobject]@{
            marker = $relative
            exists = [bool](Test-Path -LiteralPath (Join-Path $installDirectory $relative))
        }
    }
)

$exeFiles = @(Get-ChildItem -LiteralPath $installDirectory -Filter '*.exe' -File -ErrorAction SilentlyContinue)
$exeInfo = @(
    foreach ($exe in ($exeFiles | Select-Object -First 10)) {
        $sigStatus = 'not-checked'
        $publisher = $null
        try {
            $sig = Get-AuthenticodeSignature -LiteralPath $exe.FullName -ErrorAction Stop
            $sigStatus = [string]$sig.Status
            if ($sig.SignerCertificate) { $publisher = [string]$sig.SignerCertificate.Subject }
        } catch { $sigStatus = 'unavailable' }
        [pscustomobject]@{
            name = $exe.Name
            fileVersion = $exe.VersionInfo.FileVersion
            productName = $exe.VersionInfo.ProductName
            productVersion = $exe.VersionInfo.ProductVersion
            signatureStatus = $sigStatus
            signatureSubject = $publisher
        }
    }
)

# Inventory by extension only; avoid exporting installation file names/content.
$allowExt = @('.asar','.css','.html','.js','.mjs','.json','.pak')
$inventoryFiles = @(Get-ChildItem -LiteralPath $installDirectory -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $allowExt -contains $_.Extension.ToLowerInvariant() })
$inventory = @(
    foreach ($grp in ($inventoryFiles | Group-Object Extension | Sort-Object Name)) {
        [pscustomobject]@{
            extension = $grp.Name
            files = $grp.Count
            totalMB = [math]::Round((($grp.Group | Measure-Object -Property Length -Sum).Sum / 1MB), 2)
        }
    }
)

$hasAsar = @($markers | Where-Object { $_.marker -eq 'resources\app.asar' -and $_.exists }).Count -gt 0
$chromiumMarkers = @($markers | Where-Object { $_.exists -and $_.marker -in @('chrome_100_percent.pak','chrome_200_percent.pak','icudtl.dat','v8_context_snapshot.bin') }).Count
$hypothesis = 'Unknown runtime; more investigation is needed.'
if ($hasAsar) { $hypothesis = 'Strong Electron packaging indicator (app.asar); not a definitive version confirmation.' }
elseif ($chromiumMarkers -ge 2) { $hypothesis = 'Chromium-family runtime indicators found; Electron is not proven.' }

$report = [ordered]@{
    project = 'Zalo Apple Glass UI'
    stage = 'G0 / passive architecture reconnaissance'
    timestamp = (Get-Date).ToString('o')
    readOnly = $true
    noCredentialsOrChatsCollected = $true
    installDirectoryRedacted = Sanitize-Path $installDirectory
    processes = @($processes | ForEach-Object {
        [pscustomobject]@{
            name = $_.Name
            pid = $_.ProcessId
            parentPid = $_.ParentProcessId
            executablePathRedacted = Sanitize-Path $_.ExecutablePath
        }
    })
    executables = $exeInfo
    runtimeMarkers = $markers
    extensionInventory = $inventory
    runtimeHypothesis = $hypothesis
    cautions = @('Marker presence is evidence, not a guarantee of framework or compatibility.',
      'This script does not inject CSS, patch app.asar, modify binaries or access accounts.')
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'reports'
    if (-not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    $OutputPath = Join-Path $outDir ('zalo-recon-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
}
$report | ConvertTo-Json -Depth 8 | Out-File -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Read-only report: $OutputPath" -ForegroundColor Green
Write-Host "Architecture hypothesis: $hypothesis"
Write-Host 'Share the JSON report after checking it contains no private local path details you want to keep hidden.'
