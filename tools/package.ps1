$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectPath 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $projectPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$archiveName = "chatgpt-sidebar-edge-chrome-v$($manifest.version).zip"
$archivePath = Join-Path $distPath $archiveName
$checksumPath = "$archivePath.sha256"
$files = @('manifest.json', 'README.md', 'README.en.md', 'PROJECT_CONTEXT.md', 'CHANGELOG.md', 'background', 'content', 'panel', 'rules', 'icons', 'tools', 'docs') |
    ForEach-Object { Join-Path $projectPath $_ }
New-Item -ItemType Directory -Path $distPath -Force | Out-Null
if (Test-Path -LiteralPath $archivePath) {
    $backupPath = Join-Path $distPath ('chatgpt-sidebar-edge-chrome-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.zip')
    Copy-Item -LiteralPath $archivePath -Destination $backupPath
}
Compress-Archive -LiteralPath $files -DestinationPath $archivePath -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entry = $archive.GetEntry('manifest.json')
    if (-not $entry) { throw 'Missing root manifest.json in package' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $packed = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($packed.version -ne $manifest.version) { throw 'Package version does not match source' }
    if (-not $archive.GetEntry('README.en.md')) { throw 'Missing English README in package' }
    if ($archive.Entries | Where-Object { $_.FullName -match '(^|[/\\])(_metadata|dist|_snapshots)([/\\]|$)' }) {
        throw 'Package unexpectedly contains caches or old releases'
    }
    Write-Host "Package verified: v$($packed.version), $($archive.Entries.Count) entries"
} finally { $archive.Dispose() }
$hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
Set-Content -LiteralPath $checksumPath -Value "$($hash.Hash.ToLowerInvariant())  $archiveName" -Encoding ASCII
$hash
Get-Item -LiteralPath $archivePath, $checksumPath | Select-Object FullName, Length
