<#
.SYNOPSIS
Read-only ASAR header-index inspection for an installed Electron application.

.DESCRIPTION
Parses only the ASAR header (the JSON file index that sits at the start of the
archive) and reports top-level entries, package.json metadata and aggregate
counts by file extension. It never reads, extracts or writes file payloads from
inside the archive, so application source, chat data and credentials stored in
bundled assets are not accessed.

This is metadata-level evidence: it can prove which framework packages ship in
the bundle and whether the app declares a plugin/extension surface. It cannot
prove runtime behaviour, and its absence of a hook is not proof one does not
exist through another mechanism.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AsarPath,
    [string]$OutputPath
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $AsarPath -PathType Leaf)) {
    throw "ASAR not found: $AsarPath"
}

function Read-AsarHeader([string]$Path) {
    # ASAR layout: pickle(total) -> pickle(header JSON).
    #   [0..3]   uint32: size of the outer pickle payload
    #   [4..7]   uint32: size of the header pickle
    #   [8..11]  uint32: outer pickle header size
    #   [12..15] uint32: length of the JSON string
    #   [16..]   UTF-8 JSON file index
    $fs = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
        $br = New-Object IO.BinaryReader($fs)
        $outerPayload = $br.ReadUInt32()
        $headerPickleSize = $br.ReadUInt32()
        $innerHeaderSize = $br.ReadUInt32()
        $jsonLength = $br.ReadUInt32()
        if ($jsonLength -le 0 -or $jsonLength -gt 64MB) {
            throw "Implausible ASAR JSON length $jsonLength (outer=$outerPayload headerPickle=$headerPickleSize innerHeader=$innerHeaderSize)"
        }
        $bytes = $br.ReadBytes([int]$jsonLength)
        if ($bytes.Length -ne $jsonLength) { throw 'Truncated ASAR header' }
        $text = [Text.Encoding]::UTF8.GetString($bytes)
        return [pscustomobject]@{
            Layout = "outer=$outerPayload headerPickle=$headerPickleSize innerHeader=$innerHeaderSize json=$jsonLength"
            Json   = ($text | ConvertFrom-Json)
        }
    } finally { $fs.Dispose() }
}

function Measure-Tree($Node) {
    $files = New-Object System.Collections.Generic.List[object]
    $dirs = 0
    $walk = {
        param($n, $prefix)
        foreach ($prop in $n.files.PSObject.Properties) {
            $child = $prop.Value
            $isDir = $child.PSObject.Properties.Name -contains 'files'
            if ($isDir) { $script:dirCount++; & $walk $child "$prefix$($prop.Name)/" }
            else {
                $files.Add([pscustomobject]@{ path = "$prefix$($prop.Name)"; size = [int64]$child.size; unpacked = [bool]($child.PSObject.Properties.Name -contains 'unpacked') })
            }
        }
    }
    $script:dirCount = 0
    & $walk $Node ''
    [pscustomobject]@{ Files = $files; DirectoryCount = $dirCount }
}

try {
    $header = Read-AsarHeader $AsarPath
    $root = $header.Json
    $topLevel = @($root.files.PSObject.Properties.Name)
    $tree = Measure-Tree $root

    $byExtension = @(
        $tree.Files |
            ForEach-Object { if ([string]::IsNullOrEmpty([IO.Path]::GetExtension($_.path))) { '(none)' } else { [IO.Path]::GetExtension($_.path).ToLowerInvariant() } } |
            Group-Object |
            Sort-Object -Property @{ Expression = 'Count'; Descending = $true } |
            Select-Object -First 25 |
            ForEach-Object { [pscustomobject]@{ extension = $_.Name; files = $_.Count } }
    )

    # Framework and toolchain fingerprints derived from bundled path prefixes only.
    $markers = [ordered]@{
        'package.json at archive root' = ($topLevel -contains 'package.json')
        'node_modules directory'       = ($topLevel -contains 'node_modules')
        'React runtime (react-dom)'    = [bool]($tree.Files | Where-Object { $_.path -match '^node_modules/react-dom/' })
        'React (react/)'               = [bool]($tree.Files | Where-Object { $_.path -match '^node_modules/react/' })
        'Vue'                          = [bool]($tree.Files | Where-Object { $_.path -match '^node_modules/(vue|@vue)/' })
        'Angular'                      = [bool]($tree.Files | Where-Object { $_.path -match '^node_modules/@angular/' })
        'Svelte'                       = [bool]($tree.Files | Where-Object { $_.path -match '^node_modules/svelte/' })
        'jQuery'                       = [bool]($tree.Files | Where-Object { $_.path -match '^node_modules/jquery/' })
        'Electron builder/updater'     = [bool]($tree.Files | Where-Object { $_.path -match '^node_modules/(electron-updater|electron-builder)/' })
        'Electron remote/store'        = [bool]($tree.Files | Where-Object { $_.path -match '^node_modules/(@electron/remote|electron-store)/' })
        'CSS bundled as .css files'    = [bool]($tree.Files | Where-Object { $_.path -match '\.css$' })
        'Style preprocessor output'    = [bool]($tree.Files | Where-Object { $_.path -match '\.(scss|less|styl)$' })
        'Plugin/extension directory'   = [bool]($tree.Files | Where-Object { $_.path -match '(?i)(^|/)(plugin|plugins|extension|extensions|theme|themes)/' })
    }

    # Depth-limited directory outline: names and immediate child counts only.
    $outline = @(
        foreach ($name in $topLevel) {
            $node = $root.files.$name
            if ($node.PSObject.Properties.Name -contains 'files') {
                $children = @($node.files.PSObject.Properties.Name)
                [pscustomobject]@{
                    entry = $name
                    kind = 'directory'
                    children = @($children | Select-Object -First 25)
                    childCount = $children.Count
                }
            } else {
                [pscustomobject]@{ entry = $name; kind = 'file'; children = @(); childCount = 0; size = [int64]$node.size }
            }
        }
    )

    # Path-name keyword matches only. No archive payload is opened.
    $customizationHits = @(
        foreach ($needle in @('theme', 'skin', 'plugin', 'extension', 'i18n', 'locale', 'lang', 'customize', 'customization')) {
            $matches = @($tree.Files | Where-Object { $_.path -match "(?i)$needle" } | Select-Object -First 10 -ExpandProperty path)
            [pscustomobject]@{ keyword = $needle; matchCount = $matches.Count; samplePaths = $matches }
        }
    )

    $pkg = $null
    if ($topLevel -contains 'package.json') {
        $entry = $root.files.'package.json'
        if ($entry.PSObject.Properties.Name -contains 'size') {
            $pkgShape = [pscustomobject]@{
                size = [int64]$entry.size
                unpacked = [bool]($entry.PSObject.Properties.Name -contains 'unpacked')
                note = 'Content deliberately not read. Size/placement recorded from the index only.'
            }
            $pkg = $pkgShape
        }
    }

    $report = [ordered]@{
        project = 'Zalo Apple Glass UI'
        stage = 'G4b / metadata-only ASAR index inspection'
        timestamp = (Get-Date).ToString('o')
        readOnly = $true
        payloadsRead = $false
        asarPathRedacted = [regex]::Replace($AsarPath, [regex]::Escape($env:USERPROFILE), '%USERPROFILE%', 'IgnoreCase')
        asarBytes = (Get-Item -LiteralPath $AsarPath).Length
        headerLayout = $header.Layout
        topLevelEntries = $topLevel
        counted = [pscustomobject]@{ files = $tree.Files.Count; directories = $tree.DirectoryCount }
        topLevelOutline = $outline
        extensionHistogram = $byExtension
        frameworkMarkers = $markers
        customizationKeywordHits = $customizationHits
        packageJsonIndexEntry = $pkg
        cautions = @(
            'Only the archive file index was parsed; no bundled file content was read.',
            'Framework presence is derived from bundled path names, not from executing the client.',
            'A missing plugin/theme directory does not prove no extension route exists elsewhere.'
        )
    }

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'reports'
        if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
        $OutputPath = Join-Path $outDir ('zalo-asar-index-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
    }
    $report | ConvertTo-Json -Depth 8 | Out-File -LiteralPath $OutputPath -Encoding UTF8
    Write-Host "Metadata-only ASAR index report: $OutputPath" -ForegroundColor Green
    Write-Host ("Files in index: {0}; top-level: {1}" -f $tree.Files.Count, ($topLevel -join ', '))
} catch {
    Write-Error $_
    exit 1
}
