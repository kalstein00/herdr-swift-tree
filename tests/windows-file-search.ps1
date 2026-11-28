param(
    [Parameter(Mandatory)][int]$WindowProcessId,
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [string]$AlternateRoot
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

function Send-HerdrKeys([string[]]$Keys) {
    @'
import ctypes as c
from ctypes import wintypes
import sys
import time

u = c.windll.user32
u.SetProcessDPIAware()
window = int(sys.argv[1])
u.SetForegroundWindow(window)
time.sleep(0.2)
if u.GetForegroundWindow() != window:
    u.keybd_event(0x12, 0, 0, 0)
    u.SetForegroundWindow(window)
    u.keybd_event(0x12, 0, 2, 0)
    time.sleep(0.2)
if u.GetForegroundWindow() != window:
    raise SystemExit("The isolated Herdr window did not gain focus")
for chord in sys.argv[2:]:
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
    time.sleep(0.06)
'@ | uv run --isolated --python 3.13 python - $window.MainWindowHandle.ToInt64() @Keys
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

function Assert-HerdrText([string]$Name, [int[]]$Crop, [string[]]$Labels, [string[]]$Excluded = @()) {
    $ocr = Join-Path $PSScriptRoot 'assert_herdr_panel.py'
    $excludeArgs = foreach ($label in $Excluded) { '--exclude'; $label }
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        $path = Save-HerdrShot $Name
        $result = uv run --isolated --python 3.13 --with pillow --with winrt-Windows.Media.Ocr --with winrt-Windows.Graphics.Imaging --with winrt-Windows.Storage --with winrt-Windows.Storage.Streams python $ocr $path @Labels --crop @Crop @excludeArgs 2>&1
        if ($LASTEXITCODE -eq 0) { Write-Host "PASS $Name at $path"; return }
    } while ($deadline.Elapsed.TotalSeconds -lt 8)
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

Send-HerdrKeys @('11+50')
$capturePath = Save-HerdrShot 'ctrl-p'
$after = Get-HerdrStatus
if ($after.errors.Count -or $after.space -ne $before.space) {
    throw 'The verification space changed or Herdr reported an error.'
}
if ($after.overlays -notcontains 'swifttree') {
    throw "Ctrl+P did not open the file search overlay. Capture: $capturePath"
}

Send-HerdrKeys @('5a', '5a', '5a')
Assert-HerdrText 'search-unmatched' @(410, 80, 780, 150) @('zzz', '파일이 없습니다') @('Alpha', 'Bravo')
Send-HerdrKeys @('11+41', '54', '52', '4f', '57', '53')
Assert-HerdrText 'search-results' @(410, 80, 780, 155) @('trows', 'Alpha', 'Bravo')
Send-HerdrKeys @('28', '0d')
Assert-HerdrText 'search-preview' @(1130, 550, 450, 230) @('BRAVO PREVIEW PROOF') @('ALPHA PREVIEW PROOF')
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
Assert-HerdrText 'search-click-preview' @(1130, 550, 450, 230) @('ALPHA PREVIEW PROOF') @('BRAVO PREVIEW PROOF')
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
