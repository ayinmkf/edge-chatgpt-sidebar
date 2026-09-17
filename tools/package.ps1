$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectPath 'dist'
$archivePath = Join-Path $distPath 'edge-chatgpt-sidebar.zip'
$manifest = Get-Content -LiteralPath (Join-Path $projectPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @('manifest.json', 'README.md', 'background', 'content', 'panel', 'rules', 'icons', 'tools') |
    ForEach-Object { Join-Path $projectPath $_ }
New-Item -ItemType Directory -Path $distPath -Force | Out-Null
if (Test-Path -LiteralPath $archivePath) {
    $backupPath = Join-Path $distPath ('edge-chatgpt-sidebar-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.zip')
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
    if ($archive.Entries | Where-Object { $_.FullName -match '(^|[/\\])(_metadata|dist|_snapshots)([/\\]|$)' }) {
        throw 'Package unexpectedly contains caches or old releases'
    }
    Write-Host "Package verified: v$($packed.version), $($archive.Entries.Count) entries"
} finally { $archive.Dispose() }
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
