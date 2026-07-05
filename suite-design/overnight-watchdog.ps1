# Overnight watchdog v2 - quota-aware supervisor for the First Officer session.
#
# What it does:
#   - Polls Claude usage (undocumented oauth endpoint) every few minutes in a background job.
#   - At >= 90% of the 5-hour window it creates suite-design\overnight\PAUSE.
#     The First Officer (per the kickoff prompt) stops STARTING new work when PAUSE exists,
#     finishes in-flight steps, checkpoints, and exits cleanly.
#   - When the session exits, the watchdog waits until the window resets (resets_at from the
#     usage endpoint, fallback: retry every 15 min), removes PAUSE, and relaunches with resume.
#   - Stops when suite-design\overnight\DONE exists, or at the morning hard stop.
#
# This is the prototype of the suite's Scheduler reset-detector (see Trio_Specs.md, section C).
#
# Usage:  powershell -ExecutionPolicy Bypass -File suite-design\overnight-watchdog.ps1
# Stop:   Ctrl+C, or DONE marker, or the 10:00 safety stop.

param(
    [string]$Repo = "C:\thisismydesign\shareWork",
    [int]$PauseAtPercent = 90,
    [int]$PollMinutes = 5,
    [int]$FallbackRetryMinutes = 15,
    [string]$HardStop = "10:00",
    [switch]$AllowExtraUsage      # spend mode: never pause at the threshold; keep working into
                                  # Anthropic extra usage (paid). Default: pause-and-wait (free).
)

Set-Location $Repo
$overnight = Join-Path $Repo "suite-design\overnight"
$doneFile  = Join-Path $overnight "DONE"
$pauseFile = Join-Path $overnight "PAUSE"
$usageFile = Join-Path $overnight "usage.json"
$logFile   = Join-Path $overnight "watchdog.log"
New-Item -ItemType Directory -Force -Path $overnight | Out-Null

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

# ---------------------------------------------------------------- usage poller (background job)
$pollerScript = {
    param($usageFile, $pauseFile, $pauseAtPercent, $pollMinutes)
    while ($true) {
        try {
            $credPath = Join-Path $env:USERPROFILE ".claude\.credentials.json"
            $token = (Get-Content $credPath -Raw | ConvertFrom-Json).claudeAiOauth.accessToken
            $resp = Invoke-RestMethod -Uri "https://api.anthropic.com/api/oauth/usage" `
                -Headers @{ Authorization = "Bearer $token"; "anthropic-beta" = "oauth-2025-04-20" } `
                -TimeoutSec 20
            $pct = [double]$resp.five_hour.utilization
            $out = @{
                five_hour_pct = $pct
                resets_at     = $resp.five_hour.resets_at
                seven_day_pct = $resp.seven_day.utilization
                checked_at    = (Get-Date).ToString("o")
            } | ConvertTo-Json
            Set-Content -Path $usageFile -Value $out
            if ($pauseAtPercent -gt 0 -and $pct -ge $pauseAtPercent -and -not (Test-Path $pauseFile)) {
                Set-Content -Path $pauseFile -Value $out
            }
        } catch {
            # Endpoint is undocumented and rate-limited: on failure keep the last usage.json
            # and do nothing. Behavior then degrades to hard-limit-exit + timed retry.
        }
        Start-Sleep -Seconds ($pollMinutes * 60)
    }
}
$effectivePauseAt = if ($AllowExtraUsage) { 0 } else { $PauseAtPercent }   # 0 = never pause
$poller = Start-Job -ScriptBlock $pollerScript -ArgumentList $usageFile, $pauseFile, $effectivePauseAt, $PollMinutes
if ($AllowExtraUsage) {
    Log "Watchdog v2 started in EXTRA-USAGE mode: no quota pause, work continues into paid usage. Repo: $Repo"
} else {
    Log "Watchdog v2 started in PAUSE mode. Repo: $Repo  PauseAt: $PauseAtPercent%  Poll: every $PollMinutes min."
}

# ---------------------------------------------------------------- helpers
function WaitForReset {
    $target = $null
    if (Test-Path $usageFile) {
        try { $target = [datetime]((Get-Content $usageFile -Raw | ConvertFrom-Json).resets_at) } catch {}
    }
    if ($target) {
        $wait = ($target - (Get-Date)).TotalSeconds + 120   # 2 min safety margin
        if ($wait -gt 0) {
            Log "Waiting for window reset at $target (+2 min margin, $([int]($wait/60)) min)..."
            Start-Sleep -Seconds $wait
            return
        }
    }
    Log "No reliable reset time - fallback wait $FallbackRetryMinutes min."
    Start-Sleep -Seconds ($FallbackRetryMinutes * 60)
}

$kickoffPrompt = "Read suite-design/OVERNIGHT-KICKOFF-PROMPT.md and execute everything below its --- line as your mission briefing. You are the First Officer."
$resumePrompt  = "Resume the overnight mission. Read suite-design/overnight/STATUS.md and PLAN.md, verify git state on ship-wave1, reconcile, and continue exactly where the previous instance left off. All rules from suite-design/OVERNIGHT-KICKOFF-PROMPT.md still apply."

# ---------------------------------------------------------------- main loop
$attempt = 0
try {
    while (-not (Test-Path $doneFile)) {

        # Morning safety stop (between HardStop and 20:00)
        $now = Get-Date
        $stopTime = [datetime]::ParseExact($HardStop, "HH:mm", $null).TimeOfDay
        if ($now.TimeOfDay -ge $stopTime -and $now.Hour -lt 20) {
            Log "Hard stop time reached without DONE marker. Exiting; check STATUS.md."
            break
        }

        # If paused for quota, wait for the reset, then clear the pause
        if (Test-Path $pauseFile) {
            Log "PAUSE active (>= $PauseAtPercent% used). Waiting for refresh."
            WaitForReset
            Remove-Item $pauseFile -ErrorAction SilentlyContinue
            Log "Window refreshed - PAUSE cleared."
        }

        $attempt++
        # --- session pinning: never use bare --continue (it grabs whatever session in this
        # directory was touched last, incl. unrelated interactive ones). We mint our own
        # session id once, store it, and always target exactly that session.
        $sidFile = Join-Path $overnight "SESSION_ID"
        $isFreshSid = -not (Test-Path $sidFile)
        if ($isFreshSid) {
            $sid = [guid]::NewGuid().ToString()
            Set-Content -Path $sidFile -Value $sid
        } else {
            $sid = (Get-Content $sidFile -Raw).Trim()
        }
        $isResume = Test-Path (Join-Path $overnight "STATUS.md")
        $prompt = if ($isResume) { $resumePrompt } else { $kickoffPrompt }
        if ($isFreshSid) {
            Log "Attempt #$attempt - launching claude (new pinned session $sid, $(if ($isResume) {'resume-from-files'} else {'kickoff'}))..."
            & claude -p $prompt --session-id $sid --permission-mode bypassPermissions --output-format stream-json --verbose 2>&1 | Tee-Object -Append -FilePath $logFile
        } else {
            Log "Attempt #$attempt - launching claude (resume pinned session $sid)..."
            & claude -p $resumePrompt --resume $sid --permission-mode bypassPermissions --output-format stream-json --verbose 2>&1 | Tee-Object -Append -FilePath $logFile
        }
        Log "claude exited (code $LASTEXITCODE)."

        if (Test-Path $doneFile) { Log "DONE marker found. Mission complete."; break }

        if (Test-Path $pauseFile) {
            Log "Session exited under PAUSE (graceful checkpoint)."
            # loop top will wait for reset and clear PAUSE
        } else {
            Log "Session exited without PAUSE (hard limit or crash) - fallback wait $FallbackRetryMinutes min."
            Start-Sleep -Seconds ($FallbackRetryMinutes * 60)
        }
    }
} finally {
    Stop-Job $poller -ErrorAction SilentlyContinue
    Remove-Job $poller -Force -ErrorAction SilentlyContinue
    Log "Watchdog finished after $attempt attempt(s)."
}
