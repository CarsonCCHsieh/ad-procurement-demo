param(
    [int]$MaxMinutes = 180,
    [int]$IntervalSeconds = 30
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Domain = "usadanews.com"
$ExpectedNs = @(
    "leia.ns.cloudflare.com",
    "rory.ns.cloudflare.com"
)
$MarkerUrl = "https://$Domain/migration-check-20260310.txt"
$ReportDir = "C:\Users\User\hsieh\reports"
$ReportPath = Join-Path $ReportDir "dns_cutover_watch_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

if (-not (Test-Path $ReportDir)) {
    New-Item -Path $ReportDir -ItemType Directory -Force | Out-Null
}

function LogLine([string]$msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    $line | Tee-Object -FilePath $ReportPath -Append
}

function Get-CurrentNs {
    $ns = @()
    try {
        $items = Resolve-DnsName -Name $Domain -Type NS -Server "1.1.1.1" -ErrorAction Stop
        foreach ($i in $items) {
            if ($i.NameHost) {
                $ns += $i.NameHost.TrimEnd(".").ToLower()
            }
        }
    }
    catch {
        # Fallback: parse nslookup output, swallowing non-zero/stderr noise
        $raw = (cmd /c "nslookup -type=NS $Domain 1.1.1.1 2^>nul") | Out-String
        $matches = [regex]::Matches($raw, "nameserver = ([^\s]+)")
        foreach ($m in $matches) {
            $ns += $m.Groups[1].Value.Trim().TrimEnd(".").ToLower()
        }
    }
    return ($ns | Sort-Object -Unique)
}

function Test-Marker {
    try {
        $resp = Invoke-WebRequest -Uri $MarkerUrl -UseBasicParsing -TimeoutSec 20
        if ($resp.StatusCode -eq 200 -and $resp.Content -match "usada migration ok") {
            return $true
        }
        return $false
    }
    catch {
        return $false
    }
}

$deadline = (Get-Date).AddMinutes($MaxMinutes)
LogLine "Start DNS cutover watch for $Domain"
LogLine "Expect NS: $($ExpectedNs -join ', ')"
LogLine "Marker URL: $MarkerUrl"

while ((Get-Date) -lt $deadline) {
    $currentNs = Get-CurrentNs
    $nsOk = @($ExpectedNs | Where-Object { $currentNs -contains $_ }).Count -eq $ExpectedNs.Count
    $markerOk = Test-Marker

    LogLine "NS=[$($currentNs -join ', ')] ns_ok=$nsOk marker_ok=$markerOk"

    if ($nsOk -and $markerOk) {
        LogLine "CUTOVER_CONFIRMED"
        exit 0
    }
    Start-Sleep -Seconds $IntervalSeconds
}

LogLine "TIMEOUT_NOT_CUTOVER"
exit 1
