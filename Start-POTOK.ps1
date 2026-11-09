param(
    [switch]$PrepareOnly,
    [switch]$Dev,
    [switch]$SkipBuild,
    [ValidateRange(1024, 65535)][int]$Port = 5173
)
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$potokNode = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $potokNode) {
    $runtime = Get-ChildItem -LiteralPath 'C:\Program Files\WindowsApps' -Directory -Filter 'OpenAI.CodexPrimaryRuntime.*' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'dependencies\node\bin\node.exe') } |
        Select-Object -First 1
    if ($runtime) { $potokNode = Join-Path $runtime.FullName 'dependencies\node\bin\node.exe' }
}
if (-not $potokNode) { throw 'Install Node.js 24+ and pnpm 11.25+, then run this script again.' }
$potokArgs = @('scripts/local.mjs', '--port', "$Port")
if ($PrepareOnly) { $potokArgs += '--prepare' }
if ($Dev) { $potokArgs += '--dev' }
if ($SkipBuild) { $potokArgs += '--skip-build' }
Push-Location (Join-Path $PSScriptRoot 'app')
try { & $potokNode @potokArgs; if ($LASTEXITCODE -ne 0) { throw "Startup failed (exit $LASTEXITCODE)." } }
finally { Pop-Location }
