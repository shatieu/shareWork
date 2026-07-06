# Lookout Guard - uninstaller / teardown.
#
# Removes the ShipLookoutGuard scheduled task and (optionally) stops the
# processes it spawned, which OUTLIVE the task itself:
#   - the sensor          : a persistent `powershell ... lookout.ps1` while-loop
#   - resurrected sessions : headless `claude` runs launched via cmd in the repo
#
# Deleting the scheduled task stops NEW resurrections, but does NOT touch
# anything already running. Use -StopRunning to also stop those.
#
# Usage (run in a normal PowerShell or cmd prompt):
#   powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1 -StopRunning
#   powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1 -StopRunning -Purge
#
# Switches:
#   -StopRunning  also stop the live sensor and any running resurrected session
#   -Purge        also delete the per-window marker/signal files in state\
#                 (resurrected-*, ALERT, PAUSE) so a future reinstall starts clean
#   -WhatIf       show what WOULD be done without doing it

[CmdletBinding()]
param(
    [switch]$StopRunning,
    [switch]$Purge,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$taskName = 'ShipLookoutGuard'
$root     = 'C:\thisismydesign\shareWork'
$lookout  = Join-Path $root 'suite-design\lookout'
$stateDir = Join-Path $lookout 'state'

function Act($desc, [scriptblock]$do) {
    if ($WhatIf) { Write-Host "[whatif] $desc" -ForegroundColor Yellow }
    else         { Write-Host "  $desc";           & $do }
}

Write-Host "Lookout Guard teardown" -ForegroundColor Cyan
Write-Host "======================"

# 1. Delete the scheduled task (idempotent - fine if it's already gone).
$taskExists = $false
try { schtasks /query /tn $taskName *>$null; $taskExists = ($LASTEXITCODE -eq 0) } catch {}

if ($taskExists) {
    Act "delete scheduled task '$taskName'" { schtasks /delete /tn $taskName /f | Out-Null }
} else {
    Write-Host "  scheduled task '$taskName' not present - nothing to delete"
}

# 2. Optionally stop the live processes the task spawned.
if ($StopRunning) {
    # 2a. The sensor: powershell processes whose command line runs lookout.ps1.
    $sensors = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'lookout\.ps1' }
    if ($sensors) {
        foreach ($p in $sensors) {
            Act "stop sensor (PID $($p.ProcessId))" { Stop-Process -Id $p.ProcessId -Force }
        }
    } else {
        Write-Host "  no running sensor found"
    }

    # 2b. Resurrected sessions: any cmd/claude/node process whose command line
    #     references this repo AND 'claude'. Matched conservatively so unrelated
    #     node/claude processes elsewhere on the machine are left alone.
    $repoPattern = [regex]::Escape($root)
    $sessions = Get-CimInstance Win32_Process |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match $repoPattern -and
            $_.CommandLine -match 'claude'
        }
    if ($sessions) {
        Write-Host "  found running resurrected session(s):" -ForegroundColor Yellow
        foreach ($p in $sessions) {
            $short = ($p.CommandLine -replace '\s+', ' ')
            if ($short.Length -gt 120) { $short = $short.Substring(0,120) + '...' }
            Write-Host "    PID $($p.ProcessId): $short"
        }
        foreach ($p in $sessions) {
            Act "stop resurrected session (PID $($p.ProcessId))" { Stop-Process -Id $p.ProcessId -Force }
        }
    } else {
        Write-Host "  no running resurrected session found"
    }
} else {
    Write-Host "  (skipping live-process cleanup; pass -StopRunning to also stop the sensor / running sessions)"
}

# 3. Optionally purge per-window markers so a reinstall starts from a clean slate.
if ($Purge) {
    if (Test-Path $stateDir) {
        $targets = @()
        $targets += Get-ChildItem $stateDir -Filter 'resurrected-*' -ErrorAction SilentlyContinue
        foreach ($f in @('ALERT','PAUSE')) {
            $fp = Join-Path $stateDir $f
            if (Test-Path $fp) { $targets += Get-Item $fp }
        }
        if ($targets) {
            foreach ($t in $targets) {
                Act "remove state file '$($t.Name)'" { Remove-Item $t.FullName -Force }
            }
        } else {
            Write-Host "  no marker/signal files to purge"
        }
        Write-Host "  (logs guard.log / lookout.log kept for reference)"
    } else {
        Write-Host "  state dir not present - nothing to purge"
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
if (-not $StopRunning) {
    Write-Host "Note: any sensor or resurrected 'claude' already running was left alone." -ForegroundColor DarkYellow
    Write-Host "      Re-run with -StopRunning to stop those too."
}
