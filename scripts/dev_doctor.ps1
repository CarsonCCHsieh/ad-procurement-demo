Param()

$ErrorActionPreference = "Stop"

function Write-Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-WarnMsg($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Info "Repo: $repo"

$nodeHome = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.14.0-win-x64"
$nodeExe = Join-Path $nodeHome "node.exe"
$npmCmd = Join-Path $nodeHome "npm.cmd"
$npxCmd = Join-Path $nodeHome "npx.cmd"

$hasNode = Get-Command node -ErrorAction SilentlyContinue
if ($hasNode) {
  Write-Ok ("node found in PATH: " + (& node -v))
} elseif (Test-Path $nodeExe) {
  Write-WarnMsg "node not in PATH, but WinGet Node exists. Using local path fallback."
  Write-Ok ("node fallback: " + (& $nodeExe -v))
} else {
  Write-WarnMsg "node not found. Install: winget install -e --id OpenJS.NodeJS.LTS --scope user --accept-package-agreements --accept-source-agreements"
}

if (Test-Path $npmCmd) {
  Write-Ok ("npm fallback: " + (& $npmCmd -v))
} else {
  $hasNpm = Get-Command npm -ErrorAction SilentlyContinue
  if ($hasNpm) { Write-Ok ("npm in PATH: " + (& npm -v)) } else { Write-WarnMsg "npm not found." }
}

if (Test-Path $npxCmd) {
  Write-Ok ("npx fallback: " + (& $npxCmd --version))
}

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
  Write-Ok ("git: " + (& git --version))
} else {
  Write-WarnMsg "git not found in PATH."
}

$lock = Join-Path $repo ".git\index.lock"
if (Test-Path $lock) {
  Write-WarnMsg "Found .git/index.lock (another git process may be running)."
} else {
  Write-Ok "No .git/index.lock"
}

if (Test-Path (Join-Path $repo "node_modules\.bin\vite.cmd")) {
  Write-Ok "vite binary exists in node_modules/.bin"
} else {
  Write-WarnMsg "vite binary missing. Run npm install."
}

Write-Info "Doctor completed."

