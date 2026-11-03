# Starts Gym Tracker locally.
#   .\run.ps1        build the frontend and serve everything on http://127.0.0.1:8100
#   .\run.ps1 -Port N  use another port (default 8100)
#   .\run.ps1 -Dev   backend with auto-reload + Vite dev server (hot reload) on http://localhost:5173
param([switch]$Dev, [int]$Port = 8100)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$python = Join-Path $backend ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Host "Setting up the Python environment..."
    python -m venv (Join-Path $backend ".venv")
    & $python -m pip install -q -r (Join-Path $backend "requirements.txt")
}
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "Installing frontend packages..."
    Push-Location $frontend; npm install; Pop-Location
}

if ($Dev) {
    Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--port", "$Port" -WorkingDirectory $backend
    $env:GYM_API_PORT = "$Port"
    Push-Location $frontend
    try { npm run dev } finally { Pop-Location }
} else {
    Push-Location $frontend
    try { npm run build } finally { Pop-Location }
    Write-Host "Gym Tracker: http://127.0.0.1:$Port  (Ctrl+C to stop)"
    Start-Process "http://127.0.0.1:$Port"
    Push-Location $backend
    try { & $python -m uvicorn app.main:app --port $Port } finally { Pop-Location }
}
