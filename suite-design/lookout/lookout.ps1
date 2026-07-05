# Lookout - standalone Claude usage sensor.
#
# Sensor-only: reads Claude usage on a fixed interval and writes state files.
# It never launches, kills, resumes, or controls any other process.
#
# Usage: powershell -ExecutionPolicy Bypass -File suite-design\lookout\lookout.ps1

param(
    [int]$PollSeconds = 300,
    [int]$AlertAt = 80,
    [int]$PauseAt = 93,
    [string]$StateDir = "suite-design/lookout/state"
)

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$usageFile = Join-Path $StateDir "usage.json"
$alertFile = Join-Path $StateDir "ALERT"
$pauseFile = Join-Path $StateDir "PAUSE"
$logFile   = Join-Path $StateDir "lookout.log"

function Write-Log($pct, $resetsAt, $status) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $pct $resetsAt $status"
    Add-Content -Path $logFile -Value $line
}

while ($true) {
    try {
        $credPath = Join-Path $env:USERPROFILE ".claude\.credentials.json"
        $token = (Get-Content $credPath -Raw | ConvertFrom-Json).claudeAiOauth.accessToken

        $resp = Invoke-RestMethod -Uri "https://api.anthropic.com/api/oauth/usage" `
            -Headers @{ Authorization = "Bearer $token"; "anthropic-beta" = "oauth-2025-04-20" } `
            -TimeoutSec 20

        $pct = [double]$resp.five_hour.utilization
        $sevenDayPct = [double]$resp.seven_day.utilization
        $resetsAt = $resp.five_hour.resets_at

        $out = @{
            five_hour_pct = $pct
            seven_day_pct = $sevenDayPct
            resets_at     = $resetsAt
            checked_at    = (Get-Date).ToString("o")
        } | ConvertTo-Json
        Set-Content -Path $usageFile -Value $out

        $status = "ok"

        if ($pct -ge $PauseAt) {
            Set-Content -Path $pauseFile -Value $out
            $status = "PAUSE"
        } elseif (Test-Path $pauseFile) {
            Remove-Item $pauseFile -ErrorAction SilentlyContinue
        }

        if ($pct -ge $AlertAt) {
            Set-Content -Path $alertFile -Value $out
            if ($status -eq "ok") { $status = "ALERT" }
        } elseif (Test-Path $alertFile) {
            Remove-Item $alertFile -ErrorAction SilentlyContinue
        }

        Write-Log $pct $resetsAt $status
    } catch {
        # Endpoint is undocumented and rate-limited: on failure keep the last
        # usage.json and signal files untouched, log the error, and still
        # sleep the full interval below (never hammer on failure).
        Write-Log "NA" "NA" "error $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $PollSeconds
}
