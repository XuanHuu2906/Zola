[CmdletBinding()]
param([switch]$Preview)

$ErrorActionPreference = 'Stop'
$reaRuntime = 'C:\nvm4w\nodejs\node.exe'
$reaEntry = 'C:\Users\huung\AppData\Local\npm-cache\_npx\af752b90495482d7\node_modules\rea-agents\scripts\rea.mjs'
if (!(Test-Path -LiteralPath $reaRuntime) -or !(Test-Path -LiteralPath $reaEntry)) {
    throw 'REA runtime is missing. Restore the existing rea-agents 6.8.0 installation before setup.'
}

# Run from this known directory; do not resolve packages through another project.
Push-Location $PSScriptRoot
try {
    Write-Host 'Client: Codex'
    Write-Host 'Configuration: C:\Users\huung\.codex\config.toml'
    Write-Host 'Backup: C:\Users\huung\.codex\config.toml.rea.backup (additional recovery backup if needed)'
    Write-Host 'Skill: C:\Users\huung\.agents\skills\reverse-engineer-anything'
    Write-Host 'The official REA setup preserves unrelated configuration and backs up changed files.'
    if ($Preview) {
        rtk proxy $reaRuntime $reaEntry setup --client codex --dry-run --json
        if ($LASTEXITCODE -ne 0) { throw 'REA setup preview failed.' }
        return
    }
    rtk proxy $reaRuntime $reaEntry setup --client codex --yes
    if ($LASTEXITCODE -ne 0) { throw 'REA setup failed. Read the diagnostic above before retrying.' }
    rtk proxy $reaRuntime $reaEntry doctor --client codex --skill --json
    if ($LASTEXITCODE -ne 0) { throw 'REA verification reported an issue. Read the diagnostic above.' }
    rtk proxy $reaRuntime $reaEntry mcp doctor --json
    if ($LASTEXITCODE -ne 0) { throw 'REA MCP startup verification failed. Read the diagnostic above.' }
    Write-Host 'Setup verified. Restart Codex to load the REA tools.'
    Write-Host 'Keep this REA npm cache entry and Node runtime installed; MCP uses their absolute paths.'
} finally {
    Pop-Location
}
