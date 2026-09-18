$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$edgePaths = @(
    $env:EDGE_PATH,
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$edgePath = $edgePaths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $edgePath) { throw 'Microsoft Edge was not found. Set EDGE_PATH and retry.' }
$templatePath = Join-Path $projectPath 'docs\social-card-template.html'
$outputPath = Join-Path $projectPath 'docs\images\social-preview.png'
$profilePath = Join-Path $projectPath '.tools\social-card-profile'
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
$templateUrl = ([Uri]$templatePath).AbsoluteUri
$arguments = @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1280,640', "--user-data-dir=`"$profilePath`"", "--screenshot=`"$outputPath`"", "`"$templateUrl`""
)
$process = Start-Process -FilePath $edgePath -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
    throw "Social preview render failed with exit code $($process.ExitCode)."
}
Add-Type -AssemblyName System.Drawing
$image = [Drawing.Image]::FromFile($outputPath)
try {
    if ($image.Width -ne 1280 -or $image.Height -ne 640) { throw 'Social preview must be 1280 x 640.' }
} finally { $image.Dispose() }
if ((Get-Item -LiteralPath $outputPath).Length -ge 1MB) { throw 'Social preview must be smaller than 1 MB.' }
Get-Item -LiteralPath $outputPath | Select-Object FullName, Length
