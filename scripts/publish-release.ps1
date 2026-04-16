<#
.SYNOPSIS
    Publish a DocuFlow Desktop Agent installer to the app server.

.DESCRIPTION
    Uploads a single platform installer to the server and registers it as
    the latest release for that platform. Other platforms are not affected.

    Per-platform independent: run once for Windows now, again for macOS later,
    again for Linux whenever — each is a separate publish operation.

.PARAMETER Version
    Semver version string, e.g. "0.1.6". Must match the built artifact version.

.PARAMETER Platform
    Target platform: windows | macos | linux

.PARAMETER FilePath
    Path to the installer file on this machine.

.PARAMETER ApiUrl
    Base URL of the DocuFlow server (e.g. https://docuflow.replit.app).
    Defaults to the content of ~/.docuflow-url, then $env:DOCUFLOW_API_URL.

.PARAMETER Token
    DESKTOP_RELEASE_CI_TOKEN secret. Defaults to $env:DESKTOP_RELEASE_CI_TOKEN.

.EXAMPLE
    .\scripts\publish-release.ps1 `
        -Version  "0.1.6" `
        -Platform "windows" `
        -FilePath "desktop-agent\out\make\squirrel.windows\x64\DocuFlow-Agent-0.1.6-windows-setup.exe"

.EXAMPLE
    # Override API URL explicitly:
    .\scripts\publish-release.ps1 -Version "0.1.6" -Platform "windows" `
        -FilePath "C:\builds\DocuFlow-Agent-0.1.6-windows-setup.exe" `
        -ApiUrl "https://my-docuflow.replit.app"

.NOTES
    Requires: PowerShell 5.1+ (built into Windows 10/11) or PowerShell 7+
    The DESKTOP_RELEASE_CI_TOKEN must match the server-side environment variable.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $Version,

    [Parameter(Mandatory)]
    [ValidateSet("windows", "macos", "linux")]
    [string] $Platform,

    [Parameter(Mandatory)]
    [string] $FilePath,

    [string] $ApiUrl,
    [string] $Token
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Resolve API URL ──────────────────────────────────────────────────────────
if (-not $ApiUrl) { $ApiUrl = $env:DOCUFLOW_API_URL }
if (-not $ApiUrl) {
    $urlFile = Join-Path $env:USERPROFILE ".docuflow-url"
    if (Test-Path $urlFile) {
        $ApiUrl = (Get-Content $urlFile -Raw).Trim()
    }
}
if (-not $ApiUrl) {
    throw "API URL not found. Set DOCUFLOW_API_URL, pass -ApiUrl, or create ~/.docuflow-url"
}
$ApiUrl = $ApiUrl.TrimEnd("/")

# ── Resolve auth token ───────────────────────────────────────────────────────
if (-not $Token) { $Token = $env:DESKTOP_RELEASE_CI_TOKEN }
if (-not $Token) {
    throw "Auth token not found. Set DESKTOP_RELEASE_CI_TOKEN or pass -Token"
}

# ── Validate file ────────────────────────────────────────────────────────────
$FilePath = Resolve-Path $FilePath -ErrorAction Stop | Select-Object -ExpandProperty Path
if (-not (Test-Path $FilePath -PathType Leaf)) {
    throw "File not found: $FilePath"
}
$FileInfo = Get-Item $FilePath
$OriginalFilename = $FileInfo.Name
$FileSizeBytes = $FileInfo.Length
$FileSizeMB = [math]::Round($FileSizeBytes / 1MB, 1)

# ── Compute SHA256 locally ────────────────────────────────────────────────────
Write-Host ""
Write-Host "DocuFlow Release Publisher" -ForegroundColor Cyan
Write-Host "──────────────────────────────────────────────"
Write-Host "  Version  : $Version"
Write-Host "  Platform : $Platform"
Write-Host "  File     : $OriginalFilename"
Write-Host "  Size     : $FileSizeMB MB ($FileSizeBytes bytes)"
Write-Host ""
Write-Host "  Computing SHA256..." -NoNewline
$sha256 = (Get-FileHash $FilePath -Algorithm SHA256).Hash.ToLower()
Write-Host " done"
Write-Host "  SHA256   : $sha256"
Write-Host ""

# ── Confirm ───────────────────────────────────────────────────────────────────
$confirm = Read-Host "Upload to $ApiUrl ? [y/N]"
if ($confirm -notmatch "^[Yy]") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

# ── Upload ────────────────────────────────────────────────────────────────────
$uploadUrl = "$ApiUrl/api/internal/desktop-releases/upload"
$headers = @{
    "Authorization" = "Bearer $Token"
    "X-Version"     = $Version
    "X-Platform"    = $Platform
    "X-Filename"    = $OriginalFilename
    "X-SHA256"      = $sha256
}

Write-Host ""
Write-Host "  Uploading $FileSizeMB MB to $uploadUrl ..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod `
        -Method      POST `
        -Uri         $uploadUrl `
        -InFile      $FilePath `
        -ContentType "application/octet-stream" `
        -Headers     $headers `
        -TimeoutSec  300

    Write-Host ""
    Write-Host "  Published successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  version     : $($response.version)"
    Write-Host "  platform    : $($response.platform)"
    Write-Host "  filename    : $($response.filename)"
    Write-Host "  size        : $([math]::Round($response.fileSize / 1MB, 1)) MB"
    Write-Host "  sha256      : $($response.sha256)"
    Write-Host "  storageUrl  : $($response.storageUrl)"
    Write-Host "  publishedAt : $($response.publishedAt)"
    Write-Host ""
    Write-Host "  Download URL: $ApiUrl$($response.storageUrl)" -ForegroundColor Cyan
    Write-Host ""
} catch {
    $statusCode = $_.Exception.Response?.StatusCode?.value__
    $body = $null
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $body = $reader.ReadToEnd()
    } catch { }

    Write-Host ""
    Write-Host "  Upload failed (HTTP $statusCode)" -ForegroundColor Red
    if ($body) { Write-Host "  $body" -ForegroundColor Red }
    Write-Host ""
    exit 1
}
