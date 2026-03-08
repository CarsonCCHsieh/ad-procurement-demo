param(
    [switch]$VerboseMode
)

$ErrorActionPreference = "Stop"

function Step([string]$msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] $msg"
}

function Ok([string]$msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Warn([string]$msg) {
    Write-Host "  [WARN] $msg" -ForegroundColor Yellow
}

function Fail([string]$msg) {
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
}

function Get-Env([string]$name) {
    return (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value
}

function Load-EnvFile([string]$path) {
    if (-not (Test-Path -Path $path)) {
        return
    }
    $lines = Get-Content -Path $path -Encoding UTF8
    foreach ($line in $lines) {
        $trimmed = ($line -as [string]).Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
        if ($trimmed.StartsWith("#")) { continue }
        $idx = $trimmed.IndexOf("=")
        if ($idx -lt 1) { continue }
        $k = $trimmed.Substring(0, $idx).Trim()
        $v = $trimmed.Substring($idx + 1).Trim()
        if ([string]::IsNullOrWhiteSpace($k)) { continue }
        if ([string]::IsNullOrWhiteSpace((Get-Env $k))) {
            [Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
}

function Test-HttpJson {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $false)][hashtable]$Headers
    )
    try {
        $res = Invoke-RestMethod -Method Get -Uri $Url -Headers $Headers -TimeoutSec 30
        return @{ ok = $true; data = $res }
    }
    catch {
        return @{ ok = $false; err = $_.Exception.Message }
    }
}

$failed = 0
$warned = 0

Step "USADA migration preflight started"

# Load env files if present (without overriding existing process env)
Load-EnvFile ".env.migration"
Load-EnvFile ".env.migration.local"

# 1) Required env vars
Step "Check required environment variables"
$required = @(
    "LINODE_TOKEN",
    "CF_API_TOKEN",
    "CF_ZONE_ID",
    "CF_ZONE_NAME"
)
foreach ($k in $required) {
    $v = Get-Env $k
    if ([string]::IsNullOrWhiteSpace($v)) {
        Fail "$k is missing"
        $failed++
    }
    else {
        Ok "$k is present"
    }
}

# Optional env vars for migration automation
$optional = @(
    "USADA_FTP_HOST",
    "USADA_FTP_USER",
    "USADA_FTP_PASS",
    "USADA_A2_CPANEL_URL",
    "USADA_BACKUP_PATH"
)
foreach ($k in $optional) {
    $v = Get-Env $k
    if ([string]::IsNullOrWhiteSpace($v)) {
        Warn "$k is not set (optional)"
        $warned++
    }
    else {
        Ok "$k is present"
    }
}

# 2) Linode token validation
$linodeToken = Get-Env "LINODE_TOKEN"
if (-not [string]::IsNullOrWhiteSpace($linodeToken)) {
    Step "Validate Linode API token"
    $headers = @{ Authorization = "Bearer $linodeToken" }
    $ret = Test-HttpJson -Url "https://api.linode.com/v4/account" -Headers $headers
    if ($ret.ok) {
        $email = $ret.data.email
        if ([string]::IsNullOrWhiteSpace($email)) {
            Ok "Linode token valid"
        }
        else {
            Ok "Linode token valid (account: $email)"
        }
    }
    else {
        Fail "Linode token invalid or network blocked: $($ret.err)"
        $failed++
    }
}

# 3) Cloudflare token validation
$cfToken = Get-Env "CF_API_TOKEN"
if (-not [string]::IsNullOrWhiteSpace($cfToken)) {
    Step "Validate Cloudflare API token"
    $headers = @{ Authorization = "Bearer $cfToken" }
    $verify = Test-HttpJson -Url "https://api.cloudflare.com/client/v4/user/tokens/verify" -Headers $headers
    if (-not $verify.ok) {
        Fail "Cloudflare token verify failed: $($verify.err)"
        $failed++
    }
    elseif (-not $verify.data.success) {
        Fail "Cloudflare token verify response indicates failure"
        $failed++
    }
    else {
        Ok "Cloudflare token valid"
    }

    $zoneId = Get-Env "CF_ZONE_ID"
    if (-not [string]::IsNullOrWhiteSpace($zoneId)) {
        Step "Check Cloudflare zone access"
        $zone = Test-HttpJson -Url "https://api.cloudflare.com/client/v4/zones/$zoneId" -Headers $headers
        if (-not $zone.ok) {
            Fail "Cloudflare zone read failed: $($zone.err)"
            $failed++
        }
        elseif (-not $zone.data.success) {
            Fail "Cloudflare zone read returned success=false"
            $failed++
        }
        else {
            $zoneName = $zone.data.result.name
            Ok "Cloudflare zone accessible ($zoneName)"
            $expected = Get-Env "CF_ZONE_NAME"
            if (-not [string]::IsNullOrWhiteSpace($expected) -and $zoneName -ne $expected) {
                Warn "CF_ZONE_NAME mismatch. expected=$expected actual=$zoneName"
                $warned++
            }
        }
    }
}

# 4) Optional local backup file check
$backupPath = Get-Env "USADA_BACKUP_PATH"
if (-not [string]::IsNullOrWhiteSpace($backupPath)) {
    Step "Check backup path exists"
    if (Test-Path -Path $backupPath) {
        Ok "Backup path exists: $backupPath"
    }
    else {
        Warn "Backup path not found: $backupPath"
        $warned++
    }
}

# 5) Summary
Step "Preflight summary"
Write-Host "  failures = $failed"
Write-Host "  warnings = $warned"

if ($failed -gt 0) {
    Fail "Preflight failed. Resolve errors before migration."
    exit 1
}

Ok "Preflight passed. Ready for migration execution."
exit 0
