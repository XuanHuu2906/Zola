$reaRuntime = 'C:\nvm4w\nodejs\node.exe'
$reaEntry = 'C:\Users\huung\AppData\Local\npm-cache\_npx\af752b90495482d7\node_modules\rea-agents\scripts\rea.mjs'
if (!(Test-Path -LiteralPath $reaRuntime) -or !(Test-Path -LiteralPath $reaEntry)) {
    throw 'REA runtime is missing. Restore the existing rea-agents 6.8.0 installation before running this launcher.'
}
rtk proxy $reaRuntime $reaEntry @args
exit $LASTEXITCODE
