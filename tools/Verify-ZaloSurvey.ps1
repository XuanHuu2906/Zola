<#
.SYNOPSIS
Re-runnable, read-only verification of the installed Zalo PC survey facts.

.DESCRIPTION
Regenerates the machine-readable evidence used by reports/ZALO_ARCH_RECON.md:
packaging hashes, update-manifest integrity match, PE machine types, Authenticode
status, Electron fuses and embedded Electron/Chromium version strings.

Nothing is written outside the report path, no process is attached, no ASAR
payload is extracted, and no user-data directory is read. Binary files are only
opened for reading.
#>
[CmdletBinding()]
param(
    [string]$InstallDir,
    [string]$OutputPath
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$sentinel = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
$latin1 = [Text.Encoding]::GetEncoding(28591)
$fuseNames = @(
    'RunAsNode',
    'EnableCookieEncryption',
    'EnableNodeOptionsEnvironmentVariable',
    'EnableNodeCliInspectArguments',
    'EnableEmbeddedAsarIntegrityValidation',
    'OnlyLoadAppFromAsar',
    'LoadBrowserProcessSpecificV8Snapshot'
)

function Sanitize-Path([string]$Path) {
    if ([string]::IsNullOrEmpty($Path)) { return $null }
    return [regex]::Replace($Path, [regex]::Escape($env:USERPROFILE), '%USERPROFILE%', 'IgnoreCase')
}

function Get-PeMachine([string]$Path) {
    $fs = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
        if ($fs.Length -lt 0x40) { return $null }
        $br = New-Object IO.BinaryReader($fs)
        $fs.Position = 0x3C
        $peOffset = $br.ReadUInt32()
        if ($peOffset -le 0 -or ($peOffset + 6) -gt $fs.Length) { return $null }
        $fs.Position = $peOffset
        if ($br.ReadUInt32() -ne 0x00004550) { return $null }
        $machine = $br.ReadUInt16()
        $name = switch ($machine) {
            0x014C { 'x86' }
            0x8664 { 'x64' }
            0xAA64 { 'arm64' }
            default { ('0x{0:X4}' -f $machine) }
        }
        return [pscustomobject]@{ Machine = $name; Raw = ('0x{0:X4}' -f $machine) }
    } finally { $fs.Dispose() }
}

function Read-BytesAt([string]$Path, [int64]$Offset, [int]$Length) {
    $fs = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
        $buf = New-Object byte[] $Length
        $fs.Position = $Offset
        $read = $fs.Read($buf, 0, $Length)
        if ($read -ne $Length) { throw "Short read at $Offset" }
        return $buf
    } finally { $fs.Dispose() }
}

# Single streaming pass: fuse sentinel plus embedded Electron/Chromium versions.
function Get-BinaryMarkers([string]$Path) {
    $chunk = 4MB
    $carry = 64
    $buf = New-Object byte[] ($chunk + $carry)
    $fs = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
        $baseOffset = [int64]0
        $carryLen = 0
        $fuseOffset = [int64]-1
        $electron = @{}
        $chrome = @{}
        while ($true) {
            $read = $fs.Read($buf, $carryLen, $chunk)
            if ($read -le 0) { break }
            $total = $carryLen + $read
            $text = $latin1.GetString($buf, 0, $total)
            if ($fuseOffset -lt 0) {
                $idx = $text.IndexOf($sentinel)
                if ($idx -ge 0) { $fuseOffset = $baseOffset + $idx }
            }
            foreach ($m in [regex]::Matches($text, 'Electron/\d+\.\d+\.\d+')) { $electron[$m.Value] = $true }
            foreach ($m in [regex]::Matches($text, 'Chrome/\d+\.\d+\.\d+\.\d+')) { $chrome[$m.Value] = $true }
            if ($total -gt $carry) {
                [Array]::Copy($buf, $total - $carry, $buf, 0, $carry)
                $baseOffset += $total - $carry
                $carryLen = $carry
            } else {
                $carryLen = $total
            }
        }
        $fuses = $null
        if ($fuseOffset -ge 0) {
            # Header after the 32-byte sentinel: version byte, count byte, then one
            # ASCII 0/1 byte per fuse. Both header bytes are raw, not ASCII digits.
            $wire = Read-BytesAt $Path ($fuseOffset + 32) 2
            $wireVersion = [int]$wire[0]
            $count = [int]$wire[1]
            $states = New-Object System.Collections.Generic.List[object]
            if ($count -gt 0 -and $count -le 16) {
                $raw = Read-BytesAt $Path ($fuseOffset + 34) $count
                for ($k = 0; $k -lt $count; $k++) {
                    $c = [int]$raw[$k]
                    $state = if ($c -eq 0x31) { 'enabled' } elseif ($c -eq 0x30) { 'disabled' } else { ('unknown(0x{0:X2})' -f $c) }
                    $name = if ($k -lt $fuseNames.Count) { $fuseNames[$k] } else { "fuse_$k" }
                    $states.Add([pscustomobject]@{ index = $k; name = $name; state = $state })
                }
            }
            $fuses = [pscustomobject]@{
                sentinelOffset = $fuseOffset
                wireVersion    = "$wireVersion"
                count          = $count
                states         = $states
            }
        }
        return [pscustomobject]@{
            fuses            = $fuses
            electronVersions = @($electron.Keys | Sort-Object)
            chromeVersions   = @($chrome.Keys | Sort-Object)
        }
    } finally { $fs.Dispose() }
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $proc = Get-CimInstance Win32_Process -Filter "Name='Zalo.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc -and $proc.ExecutablePath) { $InstallDir = Split-Path -Parent $proc.ExecutablePath }
}
if ([string]::IsNullOrWhiteSpace($InstallDir) -or -not (Test-Path -LiteralPath $InstallDir -PathType Container)) {
    throw 'Zalo install directory not found; pass -InstallDir.'
}

$exe = Join-Path $InstallDir 'Zalo.exe'
$asar = Join-Path $InstallDir 'resources\app.asar'
$meta = Join-Path $InstallDir 'update_meta.json'
$feed = Join-Path $InstallDir 'resources\app-update.yml'
foreach ($p in @($exe, $asar, $meta)) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "Missing expected file: $p" }
}

$asarItem = Get-Item -LiteralPath $asar
$asarSha1 = (Get-FileHash -LiteralPath $asar -Algorithm SHA1).Hash.ToLowerInvariant()
$asarSha256 = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = Get-Content -LiteralPath $meta -Raw | ConvertFrom-Json
$verify = @(
    foreach ($v in @($manifest.verify)) {
        [pscustomobject]@{
            file            = $v.file
            expectedSha1    = $v.sha1
            observedSha1    = $asarSha1
            match           = ($v.file -eq 'resources\app.asar' -and $v.sha1 -eq $asarSha1)
        }
    }
)

$signedPaths = @(
    $exe,
    (Join-Path $InstallDir 'ZaloExecutable.exe'),
    (Join-Path $InstallDir 'Update.exe'),
    (Join-Path $InstallDir 'sl.exe'),
    (Join-Path $InstallDir 'plugins\capture\ZaloCall.exe'),
    (Join-Path $InstallDir 'plugins\capture\ZaloCap.exe'),
    (Join-Path $InstallDir 'plugins\capture\ZaviMeet.exe'),
    (Join-Path $InstallDir 'plugins\ocr\zocr-host.exe'),
    (Join-Path $InstallDir 'plugins\ocr\onnxruntime.dll')
)
$binaries = @(
    foreach ($p in $signedPaths) {
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
            [pscustomobject]@{ path = Sanitize-Path $p; present = $false }
            continue
        }
        $item = Get-Item -LiteralPath $p
        $sig = Get-AuthenticodeSignature -LiteralPath $p
        $pe = Get-PeMachine $p
        [pscustomobject]@{
            path             = Sanitize-Path $p
            present          = $true
            bytes            = [int64]$item.Length
            fileVersion      = [string]$item.VersionInfo.FileVersion
            productVersion   = [string]$item.VersionInfo.ProductVersion
            signatureStatus  = [string]$sig.Status
            signer           = if ($sig.SignerCertificate) { [string]$sig.SignerCertificate.Subject } else { $null }
            peMachine        = if ($pe) { $pe.Machine } else { $null }
            peMachineRaw     = if ($pe) { $pe.Raw } else { $null }
        }
    }
)

$markers = Get-BinaryMarkers $exe

$asarIndex = Join-Path $InstallDir 'resources\app.asar'
$indexTool = Join-Path $PSScriptRoot 'query-asar-index.cjs'
$topLevel = $null
if ((Test-Path -LiteralPath $indexTool) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $topLevel = @(& node $indexTool $asarIndex top 2>$null)
}

$processes = @(
    Get-CimInstance Win32_Process -Filter "Name='Zalo.exe' OR Name='ZaloCall.exe' OR Name='ZaloCap.exe' OR Name='ZaviMeet.exe'" -ErrorAction SilentlyContinue |
        ForEach-Object {
            [pscustomobject]@{
                name            = $_.Name
                processId       = [int]$_.ProcessId
                parentProcessId = [int]$_.ParentProcessId
                executablePath  = Sanitize-Path $_.ExecutablePath
            }
        }
)

$report = [ordered]@{
    project          = 'Zalo Apple Glass UI'
    stage            = 'G4b - read-only survey verification'
    timestamp        = (Get-Date).ToString('o')
    readOnly         = $true
    modified         = $false
    installDir       = Sanitize-Path $InstallDir
    environment      = [pscustomobject]@{
        psVersion = $PSVersionTable.PSVersion.ToString()
        os        = [string](Get-CimInstance Win32_OperatingSystem).Version
    }
    packaging        = [pscustomobject]@{
        appAsarBytes  = [int64]$asarItem.Length
        appAsarSha1   = $asarSha1
        appAsarSha256 = $asarSha256
        updateFeed    = (Get-Content -LiteralPath $feed -Raw).Trim()
        updateMode    = [string]$manifest.'update-version'.mode
        verify        = $verify
    }
    markers          = [pscustomobject]@{
        fuses             = $markers.fuses
        electronVersions  = $markers.electronVersions
        chromeVersions    = $markers.chromeVersions
    }
    binaries         = $binaries
    asarTopLevel     = $topLevel
    processes        = $processes
    notInspected     = @(
        'resources/app.asar file payloads beyond package.json and JavaScript needed to identify UI surfaces',
        '%APPDATA%\ZaloData (profile, cache, chat and session data)',
        'Process memory, debugger attachment and DevTools',
        'Network traffic and any authentication or message protocol'
    )
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'reports'
    if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
    $OutputPath = Join-Path $outDir ('zalo-deep-survey-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
}
$report | ConvertTo-Json -Depth 10 | Out-File -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Survey evidence: $OutputPath" -ForegroundColor Green
Write-Host ("ASAR {0} B  sha1 {1}" -f $asarItem.Length, $asarSha1)
Write-Host ("Fuses: {0}  Electron: {1}" -f ($markers.fuses.count), ($markers.electronVersions -join ', '))
