param(
    [string]$Domain = "usadanews.com"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ReportDir = "C:\Users\User\hsieh\reports"
$ReportPath = Join-Path $ReportDir "post_cutover_verify_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
if (-not (Test-Path $ReportDir)) { New-Item -Path $ReportDir -ItemType Directory -Force | Out-Null }

function W([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
    $line | Tee-Object -FilePath $ReportPath -Append
}

function CheckUrl([string]$url) {
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
        W ("OK  {0} -> {1}" -f $url, [int]$resp.StatusCode)
    }
    catch {
        W ("ERR {0} -> {1}" -f $url, $_.Exception.Message)
    }
}

W "Start post-cutover verify for $Domain"
W "NS lookup:"
$nsRaw = Resolve-DnsName -Name $Domain -Type NS -Server "1.1.1.1" -ErrorAction SilentlyContinue
if ($nsRaw) {
    ($nsRaw | Select-Object -ExpandProperty NameHost) | ForEach-Object { W ("NS: " + $_.TrimEnd(".")) }
} else {
    W "NS: resolve failed"
}

W "Core URL checks:"
$urls = @(
    "https://$Domain/",
    "https://$Domain/vtuber/",
    "https://$Domain/sitemap_index.xml",
    "https://$Domain/vtuber-sitemap.xml",
    "https://$Domain/wp-json/"
)
foreach ($u in $urls) { CheckUrl $u }

W "Header checks:"
foreach ($u in @("https://$Domain/","https://$Domain/vtuber/")) {
    try {
        $h = curl.exe -s -I $u
        W "---- $u ----"
        ($h | Out-String).Trim().Split("`n") | Select-Object -First 20 | ForEach-Object { W $_.TrimEnd() }
    }
    catch {
        W "Header check error for ${u}: $($_.Exception.Message)"
    }
}

W "Done"
W "Report: $ReportPath"
