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

# Helper: write UTF-8 WITHOUT a byte-order mark.
# Windows PowerShell 5.1's `Set-Content -Encoding utf8` writes UTF-8 WITH BOM
# (uses the .NET Framework Encoding.UTF8). PowerShell 7+ added `utf8NoBOM` but
# we can't rely on that. Use .NET directly with UTF8Encoding($false) for an
# encoding that is consistent across PS 5.1 and 7+.
function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

# Update Cargo.toml [workspace.package] version.
# `\s*$` instead of `$` so the regex tolerates CRLF line endings on Windows
# (the \r between the closing quote and \n is whitespace).
# This is the only `version = "..."` line in the file; other crates use
# version.workspace = true.
$cargoContent = Get-Content $CargoToml -Raw
if (-not ($cargoContent -match '(?m)^version = "[^"]*"\s*$')) {
    Write-Error "Could not find a version = `"...`" line to replace in $CargoToml"
    exit 1
}
$cargoUpdated = $cargoContent -replace '(?m)^version = "[^"]*"', "version = `"$Version`""
Write-Utf8NoBom -Path $CargoToml -Content $cargoUpdated

# Update tauri.conf.json "version" via targeted regex (NOT ConvertTo-Json,
# which reformats indentation + reorders properties + corrupts the file).
$confContent = Get-Content $TauriConf -Raw
if (-not ($confContent -match '"version"\s*:\s*"[^"]*"')) {
    Write-Error "Could not find a `"version`": `"...`" line to replace in $TauriConf"
    exit 1
}
$confUpdated = $confContent -replace '("version"\s*:\s*)"[^"]*"', "`$1`"$Version`""
Write-Utf8NoBom -Path $TauriConf -Content $confUpdated

Write-Host "Bumped version to $Version in:" -ForegroundColor Green
Write-Host "  - $CargoToml"
Write-Host "  - $TauriConf"

# Pre-flight: run the same build CI will run, with the same env vars.
# Refuses to tag if the local build fails. Would have caught multiple
# release-pipeline bugs we hit during v0.1.0 setup.
Write-Host "Running pre-flight release build (this is what CI will run)..." -ForegroundColor Cyan
$keyPath = "$HOME/.tauri/brawltome-updater.key"
if (-not (Test-Path $keyPath)) {
    Write-Error "Cannot find Ed25519 key at $keyPath. Required for pre-flight build."
    exit 1
}
$keyBytes = [System.IO.File]::ReadAllBytes($keyPath)
if ($keyBytes.Length -ge 3 -and $keyBytes[0] -eq 0xEF -and $keyBytes[1] -eq 0xBB -and $keyBytes[2] -eq 0xBF) {
    $keyBytes = $keyBytes[3..($keyBytes.Length-1)]
}
$env:TAURI_SIGNING_PRIVATE_KEY = [System.Text.Encoding]::UTF8.GetString($keyBytes)

# If the key is password-protected, prompt for it. Empty = passwordless key.
# The previous version hardcoded "" here, which caused tauri-bundler's signing
# step to silently hang on stdin waiting for the password (no TTY = silent
# hang). Symptom: "Finished 1 bundle at ..." prints, then nothing. Read-Host
# -AsSecureString avoids echoing the password to the terminal; we convert to
# plaintext only inside this process's env vars and clear them after.
$securePass = Read-Host "Signing-key password (press Enter if none)" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
try {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    # Dispose the SecureString to zero its encrypted pinned buffer instead of
    # waiting for GC finalization. The BSTR cleanup above only handles the
    # decrypted copy.
    $securePass.Dispose()
}

& bun run --filter @brawltome/desktop build
$buildExit = $LASTEXITCODE

# Clear the signing key from this script's process env now that the build is
# done. PowerShell process scope is bounded by the script, but defense in depth:
# any further commands (logging, debugging) shouldn't see the key.
$env:TAURI_SIGNING_PRIVATE_KEY = $null
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $null
Remove-Variable keyBytes -ErrorAction SilentlyContinue

if ($buildExit -ne 0) {
    Write-Error "Pre-flight build failed. Refusing to tag. Fix the build issue and re-run the release script."
    exit 1
}
Write-Host "Pre-flight build succeeded." -ForegroundColor Green

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
