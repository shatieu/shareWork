# Lookout Guard - session-independent resurrection watchdog.
#
# Runs OUTSIDE any Claude session (Windows Task Scheduler, -Once mode every
# 2 minutes). Guarantees the mission check-in after a usage-window reset even
# if the FO session died at a hard token cap:
#   1. keeps the Lookout sensor alive (relaunches it if usage.json is stale),
#   2. when tokens are clearly available again (five_hour_pct < 20) and the
#      repo shows no FO activity for 15+ minutes, resurrects the FO session
#      headlessly: `claude -c -p <resume prompt>` in the repo - at most ONCE
#      per usage window (marker file keyed by resets_at).
#
# Install (per-user, no admin):
#   schtasks /create /f /tn ShipLookoutGuard /sc minute /mo 2 /tr
#     "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\thisismydesign\shareWork\suite-design\lookout\guard.ps1 -Once"
# Remove: schtasks /delete /f /tn ShipLookoutGuard

param([switch]$Once)

$root      = "C:\thisismydesign\shareWork"
$lookout   = Join-Path $root "suite-design\lookout"
$stateDir  = Join-Path $lookout "state"
$usageFile = Join-Path $stateDir "usage.json"
$logFile   = Join-Path $stateDir "guard.log"
$sensor    = Join-Path $lookout "lookout.ps1"
$promptTxt = Join-Path $lookout "resume-prompt.txt"

function Log($m) {
    Add-Content -Path $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"
}

function Invoke-Check {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

    # 1. Sensor freshness (poll is 300s; stale beyond 12 min = dead sensor).
    $fresh = $false
    if (Test-Path $usageFile) {
        $ageMin = ((Get-Date) - (Get-Item $usageFile).LastWriteTime).TotalMinutes
        $fresh = ($ageMin -lt 12)
    }
    if (-not $fresh) {
        Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$sensor) -WindowStyle Hidden
        Log "sensor stale or missing - relaunched"
        return   # give it a cycle to produce fresh data
    }

    # 2. Tokens available? (fresh window = low five_hour_pct)
    $u = Get-Content $usageFile -Raw | ConvertFrom-Json
    $pct = [double]$u.five_hour_pct
    if ($pct -ge 20) { return }

    # 3. FO liveness: newest of (last git commit, overnight tracking mtime).
    $lastCommitUnix = 0
    try { $lastCommitUnix = [int](git -C $root log -1 --format=%ct 2>$null) } catch {}
    $commitAgeMin = 99999
    if ($lastCommitUnix -gt 0) {
        $commitTime = [DateTimeOffset]::FromUnixTimeSeconds($lastCommitUnix).LocalDateTime
        $commitAgeMin = ((Get-Date) - $commitTime).TotalMinutes
    }
    $newest = Get-ChildItem (Join-Path $root "suite-design\overnight") -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $mtimeAgeMin = 99999
    if ($newest) { $mtimeAgeMin = ((Get-Date) - $newest.LastWriteTime).TotalMinutes }
    $idleMin = [Math]::Min($commitAgeMin, $mtimeAgeMin)
    # 30-min threshold pairs with the FO's <=25-min alive-touch heartbeat:
    # a living session can never look dead, so resurrection = real death only.
    if ($idleMin -lt 30) { return }

    # 4. At most one resurrection per usage window. Key on the reset time
    #    truncated to the minute - the API jitters resets_at by sub-seconds
    #    between polls, which defeated exact-string dedup (5 resurrections
    #    in one window on 2026-07-06).
    $windowKey = $u.resets_at
    # Round to nearest minute (add 30s, truncate) so jitter across a minute
    # boundary (06:29:59.9 vs 06:30:00.1) still yields one key.
    try { $windowKey = ([DateTimeOffset]::Parse($u.resets_at)).AddSeconds(30).ToString("yyyyMMdd-HHmm") } catch {}
    $windowKey = ($windowKey -replace '[^0-9A-Za-z-]', '-')
    $marker = Join-Path $stateDir ("resurrected-" + $windowKey)
    if (Test-Path $marker) { return }
    New-Item -ItemType File -Path $marker -Force | Out-Null

    Log ("FO idle " + [int]$idleMin + " min with five_hour_pct=" + $pct + " - resurrecting session")
    $prompt = (Get-Content $promptTxt -Raw).Trim()
    $outLog = Join-Path $stateDir "resurrect-out.log"
    # CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0: print-mode runs otherwise kill
    # still-running background workers 600s after the turn's final text
    # (observed killing a package-4 developer mid-build on 2026-07-06).
    $cmdLine = "cd /d `"$root`" && set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0&& claude -c -p `"$prompt`" --permission-mode bypassPermissions >> `"$outLog`" 2>&1"
    Start-Process cmd -ArgumentList @('/c', $cmdLine) -WindowStyle Hidden
}

if ($Once) {
    Invoke-Check
} else {
    while ($true) { Invoke-Check; Start-Sleep -Seconds 120 }
}
