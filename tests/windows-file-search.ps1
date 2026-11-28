param(
    [Parameter(Mandatory)][int]$WindowProcessId,
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [string]$AlternateRoot,
    [switch]$GitScope,
    [switch]$GitRepositoryRoot,
    [switch]$GitMetadataRoot,
    [switch]$Remote,
    [string]$SwitchToSpace,
    [string]$DelayControlDirectory,
    [string]$RelayObserverMachine,
    [switch]$Measure
)

$ErrorActionPreference = 'Stop'
$app = (Get-Command herdr-app).Source
$window = Get-Process -Id $WindowProcessId
if ($window.ProcessName -ne 'herdr-app' -or !$window.MainWindowHandle) {
    throw 'Select the Herdr window in the isolated verification profile.'
}
if (!$env:HERDR_APP_HOME -or !$env:HC_SESSION) {
    throw 'Set the isolated profile and core session before running the test.'
}

function Get-HerdrStatus {
    $result = & $app status | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Herdr status failed: $result" }
    $result | ConvertFrom-Json
}

function Send-HerdrKeys([string[]]$Keys, [switch]$Timestamp) {
    @'
import ctypes as c
from ctypes import wintypes
import sys
import time

u = c.windll.user32
u.SetProcessDPIAware()
window = int(sys.argv[1])
measuring = sys.argv[2] == "True"
u.SetForegroundWindow(window)
time.sleep(0.2)
if u.GetForegroundWindow() != window:
    u.keybd_event(0x12, 0, 0, 0)
    u.SetForegroundWindow(window)
    u.keybd_event(0x12, 0, 2, 0)
    time.sleep(0.2)
if u.GetForegroundWindow() != window:
    raise SystemExit("The isolated Herdr window did not gain focus")
started = c.c_longlong()
c.windll.kernel32.QueryPerformanceCounter(c.byref(started))
for chord in sys.argv[3:]:
    if chord.startswith("click="):
        point = wintypes.POINT(*map(int, chord[6:].split(",")))
        u.ClientToScreen(window, c.byref(point))
        u.SetCursorPos(point.x, point.y)
        u.mouse_event(2, 0, 0, 0, 0)
        u.mouse_event(4, 0, 0, 0, 0)
        continue
    keys = [int(key, 16) for key in chord.split("+")]
    for key in keys:
        u.keybd_event(key, 0, 0, 0)
    for key in reversed(keys):
        u.keybd_event(key, 0, 2, 0)
    time.sleep(0.015 if measuring else 0.06)
if measuring:
    print(started.value)
'@ | uv run --isolated --python 3.13 python - $window.MainWindowHandle.ToInt64() $Timestamp.IsPresent.ToString() @Keys
    if ($LASTEXITCODE -ne 0) { throw 'Native keyboard input failed.' }
}

function Save-HerdrShot([string]$Name) {
    $path = Join-Path (Resolve-Path -LiteralPath $EvidenceDirectory).Path "$Name.png"
    $capture = Start-Process -FilePath $app -ArgumentList 'shot', ('"{0}"' -f $path) -WindowStyle Hidden -Wait -PassThru
    if ($capture.ExitCode -ne 0 -or !(Test-Path -LiteralPath $path)) {
        throw "Herdr did not write $path."
    }
    return $path
}

function Assert-HerdrText([string]$Name, [int[]]$Crop, [string[]]$Labels, [string[]]$Excluded = @(), [switch]$Timestamp) {
    $ocr = Join-Path $PSScriptRoot 'assert_herdr_panel.py'
    $excludeArgs = foreach ($label in $Excluded) { '--exclude'; $label }
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        $path = Save-HerdrShot $Name
        $observed = [Diagnostics.Stopwatch]::GetTimestamp()
        $result = uv run --isolated --python 3.13 --with pillow --with winrt-Windows.Media.Ocr --with winrt-Windows.Graphics.Imaging --with winrt-Windows.Storage --with winrt-Windows.Storage.Streams python $ocr $path @Labels --crop @Crop @excludeArgs 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PASS $Name at $path"
            if ($Timestamp) { return $observed }
            return
        }
    } while ($deadline.Elapsed.TotalSeconds -lt $(if ($Measure) {45} else {8}))
    throw "$Name failed at ${path}: $result"
}

$before = Get-HerdrStatus
if ($before.layout -ne 'swifttree' -or !$before.focused_pane -or
    $before.overlays.Count -or $before.errors.Count) {
    throw 'Start in SwiftTree with an active terminal and no overlays or errors.'
}
$listing = & $app ls | Out-String | ConvertFrom-Json
$activeSpace = $listing.spaces | Where-Object active
$activeTab = $activeSpace.tabs | Where-Object active
$terminalAddress = ($activeTab.terminals | Where-Object pane -eq $before.focused_pane).terminal
if (!$terminalAddress) { throw 'No terminal is associated with the focused pane.' }
& $app do layout.hide --id panel | Out-String | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not hide the Files panel.' }
if ($Measure) {
    function Convert-Keys([string]$Text) {
        $Text.ToUpperInvariant().ToCharArray() | ForEach-Object { '{0:x2}' -f [int]$_ }
    }
    $crop = @(410, 80, 780, 150)
    $sample = foreach ($index in 1..3) {
        $first = Send-HerdrKeys (@('11+50') + (Convert-Keys 'measureneedlea')) -Timestamp
        $firstFrame = Assert-HerdrText "measure-first-$index" $crop @('measureneedlea', 'MeasureNeedleA.txt') -Timestamp
        Send-HerdrKeys (@('11+41') + (Convert-Keys 'zznoentry'))
        Assert-HerdrText "measure-ready-$index" $crop @('zznoentry', '파일이 없습니다')
        $warm = Send-HerdrKeys (@('11+41') + (Convert-Keys 'refreshproof')) -Timestamp
        $warmFrame = Assert-HerdrText "measure-warm-$index" $crop @('refreshproof', 'RefreshProof.txt') @('MeasureNeedleA.txt') -Timestamp
        Send-HerdrKeys @('1b')
        $frequency = [Diagnostics.Stopwatch]::Frequency
        [pscustomobject]@{
            Sample = $index
            FirstFrameMs = [Math]::Round(1000 * ($firstFrame - [long]$first) / $frequency)
            WarmFrameMs = [Math]::Round(1000 * ($warmFrame - [long]$warm) / $frequency)
        }
    }
    $sample | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'measure-samples.json') -Encoding utf8
    $sample
    return
}
function Open-HerdrSearch {
    Send-HerdrKeys @('11+50')
    $capturePath = Save-HerdrShot 'ctrl-p'
    $after = Get-HerdrStatus
    if ($after.errors.Count -or $after.space -ne $before.space) {
        throw 'The verification space changed or Herdr reported an error.'
    }
    if ($after.overlays -notcontains 'swifttree') {
        throw "Ctrl+P did not open the file search overlay. Capture: $capturePath"
    }
}

if ($SwitchToSpace) {
    if (!$DelayControlDirectory -or !$RelayObserverMachine) {
        throw 'Provide the relay control directory and a direct SSH observer for the same guest.'
    }
    function Get-RemoteScopeChunks {
        $probe = 'find /tmp -maxdepth 1 -type d -uid "$(id -u)" -name ".swifttree-search-*" -exec find {} -maxdepth 1 -type f -name chunk-00000000 -print \;'
        $reply = hc exec --json --on $RelayObserverMachine -- sh -c $probe | ConvertFrom-Json
        if ($reply.code -ne 0) { throw 'Could not inspect the isolated remote scope.' }
        $paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($reply.stdout))
        $paths -split '\n' | Where-Object { $_ -match '^/tmp/\.swifttree-search-\d{13}-[a-z0-9]+/chunk-00000000$' }
    }
    function Wait-RemoteLookupMarker([string]$Marker) {
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        do {
            if (Test-Path -LiteralPath (Join-Path $DelayControlDirectory $Marker)) { return }
            Start-Sleep -Milliseconds 80
        } while ($deadline.Elapsed.TotalSeconds -lt 18)
        throw "Delayed remote search did not reach $Marker."
    }
    $hold = Join-Path $DelayControlDirectory 'hold'
    $oldChunks = @(Get-RemoteScopeChunks)
    foreach ($marker in 'held', 'forwarded') {
        $file = Join-Path $DelayControlDirectory $marker
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    try {
        New-Item -ItemType File -Path $hold -Force | Out-Null
        Open-HerdrSearch
        $scopeKeys = @('53', '43', '4f', '50', '45')
        Send-HerdrKeys $scopeKeys
        Wait-RemoteLookupMarker 'held'
        Assert-HerdrText 'search-delayed-pending' @(410, 80, 780, 150) @('scope', '파일 검색 중')
        $switched = & $app do space.select --id $SwitchToSpace | Out-String | ConvertFrom-Json
        if (!$switched.ok) { throw 'Could not switch from remote to local search fixture.' }
        $current = Get-HerdrStatus
        if ($current.space -ne $SwitchToSpace -or $current.overlays -notcontains 'swifttree') {
            throw 'Local space must be active with the same search still open.'
        }
        Assert-HerdrText 'search-changed-machine' @(410, 80, 780, 150) @('ScopeBuild.txt') @('ScopeRemote.txt')
        $newChunk = Get-RemoteScopeChunks | Where-Object { $_ -notin $oldChunks } | Select-Object -First 1
        if (!$newChunk) { throw 'No completed remote Git listing was held by the relay.' }
        Remove-Item -LiteralPath $hold
        Wait-RemoteLookupMarker 'forwarded'
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        while ((Get-RemoteScopeChunks) -contains $newChunk) {
            if ($deadline.Elapsed.TotalSeconds -gt 8) { throw 'The remote lookup did not settle after release.' }
            Start-Sleep -Milliseconds 100
        }
        Assert-HerdrText 'search-late-remote-discarded' @(410, 80, 780, 150) @('ScopeBuild.txt') @('ScopeRemote.txt')
        Send-HerdrKeys @('0d')
        Assert-HerdrText 'search-local-after-remote' @(1130, 550, 450, 230) @('LOCAL SCOPE PROOF')
    } finally {
        if (Test-Path -LiteralPath $hold) { Remove-Item -LiteralPath $hold }
    }
    return
}

Open-HerdrSearch

if ($GitMetadataRoot) {
    Send-HerdrKeys @('53', '43', '4f', '50', '45', '47', '49', '54')
    Assert-HerdrText 'search-metadata-root' @(410, 80, 780, 150) @('scopegit', '파일이 없습니다')
    Send-HerdrKeys @('1b')
    return
}

if ($GitScope) {
    Send-HerdrKeys @('50', '4f', '4c', '49', '43', '59')
    $excluded = @('PolicyIgnored.txt', 'PolicyNested.txt')
    $visible = @('PolicyKeep.txt')
    $name = 'search-git-policy'
    if ($GitRepositoryRoot) {
        $visible += 'PolicyOutside.txt'
        $name = 'search-git-policy-root'
    } else {
        $excluded += 'PolicyOutside.txt'
    }
    Assert-HerdrText $name @(410, 80, 780, 250) $visible $excluded
    Send-HerdrKeys @('0d')
    Assert-HerdrText "$name-preview" @(1130, 550, 450, 230) @('GIT KEEP PREVIEW PROOF')
    return
}

Send-HerdrKeys @('5a', '5a', '5a')
Assert-HerdrText 'search-unmatched' @(410, 80, 780, 150) @('zzz', '파일이 없습니다') @('Alpha', 'Bravo')
Send-HerdrKeys @('11+41', '54', '52', '4f', '57', '53')
Assert-HerdrText 'search-results' @(410, 80, 780, 155) @('trows', 'Alpha', 'Bravo')
Send-HerdrKeys @('28', '0d')
$firstBody = if ($Remote) { 'REMOTE FIRST PREVIEW PROOF' } else { 'ALPHA PREVIEW PROOF' }
$secondBody = if ($Remote) { 'REMOTE SECOND PREVIEW PROOF' } else { 'BRAVO PREVIEW PROOF' }
Assert-HerdrText 'search-preview' @(1130, 550, 450, 230) @($secondBody) @($firstBody)
if ((Get-HerdrStatus).overlays.Count) { throw 'Enter did not close the search overlay.' }
Send-HerdrKeys @('11+50', '1b')
if ((Get-HerdrStatus).overlays.Count) { throw 'Escape did not close the search overlay.' }
$focusProof = 'focus' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$proofKeys = $focusProof.ToUpperInvariant().ToCharArray() | ForEach-Object { '{0:x2}' -f [int]$_ }
Send-HerdrKeys $proofKeys
$terminalText = hc read $terminalAddress | Out-String
if ($LASTEXITCODE -ne 0 -or $terminalText -notmatch $focusProof) {
    throw 'The terminal did not receive text after closing search.'
}
Save-HerdrShot 'search-cancelled' | Out-Null
Send-HerdrKeys @('11+43')
Send-HerdrKeys @('11+50', '54', '52', '4f', '57', '53')
Assert-HerdrText 'search-click-results' @(410, 80, 780, 155) @('Alpha', 'Bravo')
Send-HerdrKeys @('click=515,155')
Assert-HerdrText 'search-click-preview' @(1130, 550, 450, 230) @($firstBody) @($secondBody)
if ($Remote) {
    Send-HerdrKeys @('11+50', '53', '43', '4f', '50', '45')
    Assert-HerdrText 'search-scope' @(410, 80, 780, 240) @('ScopeRemote.txt') @('ScopeGit.txt', 'ScopeLink.txt', 'ScopeIgnored.txt')
    foreach ($name in 'ScopeGit', 'ScopeLink', 'ScopeIgnored') {
        $keys = $name.ToUpperInvariant().ToCharArray() | ForEach-Object { '{0:x2}' -f [int]$_ }
        Send-HerdrKeys (@('11+41') + $keys)
        Assert-HerdrText "search-$name" @(410, 80, 780, 150) @($name, '파일이 없습니다')
    }
    Send-HerdrKeys @('1b')
}
if ($AlternateRoot) {
    Send-HerdrKeys @('11+50', '53', '43', '4f', '50', '45')
    Assert-HerdrText 'search-scope' @(410, 80, 780, 240) @('ScopeBuild.txt') @('ScopeGit.txt', 'ScopeLink.txt')
    Send-HerdrKeys @('47', '49', '54')
    Assert-HerdrText 'search-git-metadata' @(410, 80, 780, 150) @('scopegit', '파일이 없습니다')
    Send-HerdrKeys @('11+41', '53', '43', '4f', '50', '45', '4c', '49', '4e', '4b')
    Assert-HerdrText 'search-junction' @(410, 80, 780, 150) @('scopelink', '파일이 없습니다')
    Send-HerdrKeys @('1b', '11+43')
    $quotedRoot = (Resolve-Path -LiteralPath $AlternateRoot).Path.Replace("'", "''")
    hc send --force $terminalAddress "cd -LiteralPath '$quotedRoot'" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot change directory in the fixture terminal.' }
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        $state = hc get $terminalAddress --json | ConvertFrom-Json
        if ($state.foreground.cwd -eq (Resolve-Path -LiteralPath $AlternateRoot).Path) { break }
        Start-Sleep -Milliseconds 100
    } while ($deadline.Elapsed.TotalSeconds -lt 8)
    if ($state.foreground.cwd -ne (Resolve-Path -LiteralPath $AlternateRoot).Path) {
        throw 'The fixture terminal did not change directory.'
    }
    Send-HerdrKeys @('11+50', '53', '43', '4f', '50', '45')
    Assert-HerdrText 'search-changed-root' @(410, 80, 780, 240) @('ScopeAlternate.txt') @('ScopeBuild.txt')
    Send-HerdrKeys @('1b')
}
