$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$edgeCandidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edgePath) { throw 'Microsoft Edge was not found.' }

Push-Location $projectPath
try {
    Write-Host '=== Edge full extension flow ==='
    $env:BROWSER_PATH = $edgePath
    node tools/verify-stable.mjs
    if ($LASTEXITCODE -ne 0) { throw "Edge verification failed with exit code $LASTEXITCODE" }

    Write-Host '=== Chrome for Testing extension load ==='
    Remove-Item Env:BROWSER_PATH -ErrorAction SilentlyContinue
    node tools/verify-chrome-load.mjs
    if ($LASTEXITCODE -ne 0) { throw "Chrome load verification failed with exit code $LASTEXITCODE" }

    $chromeForTesting = node -e "require('puppeteer').executablePath().then(x=>process.stdout.write(x))"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $chromeForTesting)) {
        throw 'Puppeteer Chrome for Testing executable was not found.'
    }
    Write-Host '=== Chrome full extension flow ==='
    $env:BROWSER_PATH = $chromeForTesting
    node tools/verify-stable.mjs
    if ($LASTEXITCODE -ne 0) { throw "Chrome verification failed with exit code $LASTEXITCODE" }
} finally {
    Remove-Item Env:BROWSER_PATH -ErrorAction SilentlyContinue
    Pop-Location
}
