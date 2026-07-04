# Overnight watchdog - relaunches the First Officer session until the mission is done.
# Usage:  powershell -ExecutionPolicy Bypass -File suite-design\overnight-watchdog.ps1
# Stop:   Ctrl+C, or let it find suite-design\overnight\DONE, or the 10:00 safety stop.

param(
    [string]$Repo = "C:\thisismydesign\shareWork",
    [int]$RetryMinutes = 15,          # wait between relaunch attempts (limit may still be active)
    [string]$HardStop = "10:00"       # safety stop next morning (local time)
)

Set-Location $Repo
$doneFile = Join-Path $Repo "suite-design\overnight\DONE"
$logFile  = Join-Path $Repo "suite-design\overnight\watchdog.log"
New-Item -ItemType Directory -Force -Path (Join-Path $Repo "suite-design\overnight") | Out-Null

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

$kickoffPrompt = "Read suite-design/OVERNIGHT-KICKOFF-PROMPT.md and execute everything below its --- line as your mission briefing. You are the First Officer."
$resumePrompt  = "Resume the overnight mission. Read suite-design/overnight/STATUS.md and PLAN.md, verify git state on ship-wave1, reconcile, and continue exactly where the previous instance left off. All rules from suite-design/OVERNIGHT-KICKOFF-PROMPT.md still apply."

$attempt = 0
Log "Watchdog started. Repo: $Repo"

while (-not (Test-Path $doneFile)) {

    # Safety stop in the morning (between HardStop and 20:00)
    $now = Get-Date
    $stopTime = [datetime]::ParseExact($HardStop, "HH:mm", $null).TimeOfDay
    if ($now.TimeOfDay -ge $stopTime -and $now.Hour -lt 20) {
        Log "Hard stop time reached without DONE marker. Exiting; check STATUS.md."
        break
    }

    $attempt++
    $isResume = Test-Path (Join-Path $Repo "suite-design\overnight\STATUS.md")
    if ($isResume) {
        Log "Attempt #$attempt - launching claude (resume)..."
        & claude --continue -p $resumePrompt --permission-mode bypassPermissions --output-format stream-json --verbose 2>&1 | Tee-Object -Append -FilePath $logFile
    } else {
        Log "Attempt #$attempt - launching claude (kickoff)..."
        & claude -p $kickoffPrompt --permission-mode bypassPermissions --output-format stream-json --verbose 2>&1 | Tee-Object -Append -FilePath $logFile
    }
    Log "claude exited (code $LASTEXITCODE)."

    if (Test-Path $doneFile) { Log "DONE marker found. Mission complete."; break }

    Log "No DONE marker - waiting $RetryMinutes min before relaunch (limit window may still be active)."
    Start-Sleep -Seconds ($RetryMinutes * 60)
}

Log "Watchdog finished after $attempt attempt(s)."
