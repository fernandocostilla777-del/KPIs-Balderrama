# Genera un ZIP solo con archivos cambiados para actualizar el servidor.
# Uso:
#   .\scripts\pack-server-update.ps1 -Since "2026-07-22"
#   .\scripts\pack-server-update.ps1 -SinceCommit "HEAD~5"
#   .\scripts\pack-server-update.ps1 -Since "2026-07-22" -IncludeData

param(
  [string]$Since = "",
  [string]$SinceCommit = "",
  [switch]$IncludeData,
  [string]$OutDir = "$env:USERPROFILE\Desktop"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  throw "No se encontro la raiz del proyecto (package.json)."
}

Set-Location $Root
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$zipName = "dashboard-update-$stamp.zip"
$listName = "dashboard-update-$stamp.txt"
$zipPath = Join-Path $OutDir $zipName
$listPath = Join-Path $OutDir $listName

$excludeDirNames = @(
  "node_modules", ".git", ".angular", ".cursor",
  "stitch_liquid_glass_analytics", "stitch_automotive_analytics_dashboard"
)
$excludeFilePatterns = @("*.log", ".env", ".env.*", "*.db-shm")

function Test-ExcludedPath([string]$rel) {
  $parts = $rel -split '[\\/]'
  foreach ($p in $parts) {
    if ($excludeDirNames -contains $p) { return $true }
  }
  $name = Split-Path $rel -Leaf
  if ($name -eq ".env" -or $name -like ".env.*") { return $true }
  if ($name -like "*.log") { return $true }
  if (-not $IncludeData -and $rel -match '(?i)^backend[\\/]+data[\\/]') {
    # Datos locales solo si se pide -IncludeData
    return $true
  }
  return $false
}

$files = New-Object System.Collections.Generic.List[string]

if ($SinceCommit) {
  Write-Host "Modo Git: cambios desde $SinceCommit"
  $gitFiles = git diff --name-only --diff-filter=ACMRT "$SinceCommit" HEAD 2>$null
  if ($LASTEXITCODE -ne 0) { throw "git diff fallo. Revisa -SinceCommit." }
  foreach ($f in $gitFiles) {
    if (-not $f) { continue }
    $norm = $f -replace '/', '\'
    if (Test-ExcludedPath $norm) { continue }
    $full = Join-Path $Root $norm
    if (Test-Path $full -PathType Leaf) { [void]$files.Add($norm) }
  }
  # Incluir untracked relevantes (nuevos archivos)
  $untracked = git ls-files --others --exclude-standard 2>$null
  foreach ($f in $untracked) {
    if (-not $f) { continue }
    $norm = $f -replace '/', '\'
    if (Test-ExcludedPath $norm) { continue }
    $full = Join-Path $Root $norm
    if (Test-Path $full -PathType Leaf) { [void]$files.Add($norm) }
  }
}
elseif ($Since) {
  $sinceDate = Get-Date $Since
  Write-Host "Modo fecha: archivos modificados desde $($sinceDate.ToString('yyyy-MM-dd HH:mm'))"
  Get-ChildItem $Root -Recurse -File -Force | ForEach-Object {
    if ($_.LastWriteTime -lt $sinceDate) { return }
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\')
    if (Test-ExcludedPath $rel) { return }
    [void]$files.Add($rel)
  }
}
else {
  throw "Indica -Since 'YYYY-MM-DD' o -SinceCommit 'hash|HEAD~n'"
}

$unique = $files | Sort-Object -Unique
if (-not $unique -or $unique.Count -eq 0) {
  Write-Host "No hay archivos para empaquetar."
  exit 0
}

$staging = Join-Path $env:TEMP "dashboard-update-$stamp"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

foreach ($rel in $unique) {
  $src = Join-Path $Root $rel
  $dst = Join-Path $staging $rel
  $dstDir = Split-Path $dst -Parent
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
  Copy-Item $src $dst -Force
}

$unique | Set-Content -Path $listPath -Encoding UTF8

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force
Remove-Item $staging -Recurse -Force

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "OK: $zipPath ($sizeMb MB)"
Write-Host "Lista: $listPath ($($unique.Count) archivos)"
Write-Host ""
Write-Host "En el servidor: detener app -> descomprimir encima del proyecto -> npm run install:all solo si cambio package.json -> npm start"
