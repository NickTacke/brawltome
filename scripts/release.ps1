# scripts/release.ps1
#
# Bumps the desktop app version in apps/desktop/Cargo.toml + apps/desktop/app/tauri.conf.json,
# commits the change, and creates a v$VERSION tag locally.
# Manual `git push origin master --tags` is intentional - gives a chance to inspect
# before triggering CI.
#
# Usage: ./scripts/release.ps1 0.1.0

param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# Strip leading 'v' if user typed v0.1.0
$Version = $Version.TrimStart('v')

# Validate semver-ish (X.Y.Z, optionally with -suffix)
if ($Version -notmatch '^\d+\.\d+\.\d+(-[\w\.]+)?$') {
    Write-Error "Version '$Version' is not in X.Y.Z[-suffix] form"
    exit 1
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CargoToml = Join-Path $RepoRoot "apps/desktop/Cargo.toml"
$TauriConf = Join-Path $RepoRoot "apps/desktop/app/tauri.conf.json"

if (-not (Test-Path $CargoToml)) {
    Write-Error "Could not find $CargoToml"
    exit 1
}
if (-not (Test-Path $TauriConf)) {
    Write-Error "Could not find $TauriConf"
    exit 1
}

# Update Cargo.toml [workspace.package] version
# The line we want is `version = "X.Y.Z"` under [workspace.package].
# That is the only `^version = "..."$` line in the file (other crates use version.workspace = true).
$cargoContent = Get-Content $CargoToml -Raw
if (-not ($cargoContent -match '(?m)^version = "[^"]*"$')) {
    Write-Error "Could not find a 'version = \"...\"' line to replace in $CargoToml"
    exit 1
}
$cargoUpdated = $cargoContent -replace '(?m)^version = "[^"]*"$', "version = `"$Version`""
Set-Content -Path $CargoToml -Value $cargoUpdated -NoNewline -Encoding utf8

# Update tauri.conf.json "version" via targeted regex (NOT ConvertTo-Json,
# which reformats indentation + reorders properties + corrupts the file).
# -Encoding utf8 explicitly so Windows PowerShell 5.1 doesn't write a different
# default encoding.
$confContent = Get-Content $TauriConf -Raw
if (-not ($confContent -match '"version"\s*:\s*"[^"]*"')) {
    Write-Error "Could not find a '\"version\": \"...\"' line to replace in $TauriConf"
    exit 1
}
$confUpdated = $confContent -replace '("version"\s*:\s*)"[^"]*"', "`$1`"$Version`""
Set-Content -Path $TauriConf -Value $confUpdated -NoNewline -Encoding utf8

Write-Host "Bumped version to $Version in:" -ForegroundColor Green
Write-Host "  - $CargoToml"
Write-Host "  - $TauriConf"

# Stage; commit only if there's actually a diff (handles the case where the
# version is already what we want, e.g., cutting v0.1.0 when both files
# already say 0.1.0). Tag points at HEAD either way.
git add $CargoToml $TauriConf
$staged = git diff --cached --name-only
if ($staged) {
    git commit -m "chore(release): v$Version"
} else {
    Write-Host "No file changes (version was already $Version). Tagging current HEAD." -ForegroundColor Yellow
}
git tag "v$Version"

Write-Host ""
Write-Host "Tagged v$Version locally." -ForegroundColor Green
Write-Host "To trigger the release CI workflow, run:"
Write-Host "  git push origin master --tags" -ForegroundColor Cyan
