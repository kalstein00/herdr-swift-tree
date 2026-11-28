param(
    [Parameter(Mandatory)]
    [string]$FixtureRoot,
    [string]$HerdrApp = (Join-Path $env:LOCALAPPDATA 'Programs/herdr-app/herdr-app.exe'),
    [string]$HerdrCore = (Join-Path $env:LOCALAPPDATA 'Programs/herdr-core/hc.exe'),
    [int[]]$PanelCrop = @(1130, 62, 455, 160)
)

$ErrorActionPreference = 'Stop'
$fixture = (Resolve-Path -LiteralPath $FixtureRoot).Path
$app = (Resolve-Path -LiteralPath $HerdrApp).Path
$hc = (Resolve-Path -LiteralPath $HerdrCore).Path
$fixtureEnvironment = @{
    HERDR_APP_HOME = Join-Path $fixture 'app'
    HC_SESSION = Split-Path -Leaf $fixture
    XDG_CONFIG_HOME = Join-Path $fixture 'config'
    XDG_STATE_HOME = Join-Path $fixture 'state'
    HC_SOCKET = $null
}
$previousEnvironment = @{}
$createdSpace = $null

function Invoke-Herdr([string[]]$Arguments) {
    $reply = & $app @Arguments | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Herdr $($Arguments -join ' ') failed: $reply" }
    $reply | ConvertFrom-Json
}

function Set-PaneFocus([string]$Pane) {
    $reply = Invoke-Herdr @('do', 'pane.focus', '--pane', $Pane)
    $status = Invoke-Herdr @('status')
    if (!$reply.ok -or $status.focused_pane -ne $Pane -or $status.errors.Count) {
        throw "Herdr did not focus pane $Pane."
    }
}

function Wait-TerminalFolder([string]$Terminal, [string]$Folder) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $data = & $hc get $Terminal --json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw "Could not read terminal $Terminal." }
        if ($data.foreground.cwd -eq $Folder) { return }
        Start-Sleep -Milliseconds 100
    } while ($timer.Elapsed.TotalSeconds -lt 8)
    throw "Terminal $Terminal did not report $Folder as its current directory."
}

function Test-Panel([string]$Step, [string]$Expected, [string[]]$Excluded) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $excludeArgs = foreach ($label in $Excluded) { '--exclude'; $label }
    $shot = Join-Path $run "$Step.png"
    do {
        $capture = Start-Process -FilePath $app -ArgumentList 'shot', ('"{0}"' -f $shot) -WindowStyle Hidden -Wait -PassThru
        if ($capture.ExitCode -ne 0 -or !(Test-Path -LiteralPath $shot -PathType Leaf)) {
            throw "Could not capture Herdr ($($capture.ExitCode))."
        }
        $ocr = uv run --isolated --python 3.13 --with pillow --with winrt-Windows.Media.Ocr --with winrt-Windows.Graphics.Imaging --with winrt-Windows.Storage --with winrt-Windows.Storage.Streams python $assertPanel $shot SwiftTree $Expected --crop @PanelCrop @excludeArgs 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PASS $Step ($Expected): $shot"
            return $true
        }
    } while ($timer.Elapsed.TotalSeconds -lt 5)
    Write-Host "FAIL $Step (expected $Expected): $shot"
    $ocr | ForEach-Object { Write-Host $_ }
    return $false
}

try {
    foreach ($name in $fixtureEnvironment.Keys) {
        $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        Set-Item -LiteralPath "Env:$name" -Value $fixtureEnvironment[$name]
    }
    $status = Invoke-Herdr @('status')
    if ($status.layout -ne 'swifttree' -or $status.overlays.Count -or $status.errors.Count) {
        throw 'Use the isolated SwiftTree profile from the Windows UI verification guide.'
    }
    $assertPanel = Join-Path $PSScriptRoot 'assert_herdr_panel.py'
    $run = Join-Path $fixture ('terminal-root-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $origin = Join-Path $run 'Starting'
    $afterCd = Join-Path $run 'AfterCd'
    $second = Join-Path $run 'SecondPane'
    New-Item -ItemType Directory -Path $origin,$afterCd,$second | Out-Null
    Set-Content -LiteralPath (Join-Path $origin 'Origin.txt') -Value 'space folder'
    Set-Content -LiteralPath (Join-Path $afterCd 'Moved.txt') -Value 'first terminal after cd'
    Set-Content -LiteralPath (Join-Path $second 'Second.txt') -Value 'second terminal'

    $created = Invoke-Herdr @('do', 'space.new', '--name', 'Terminal root fixture', '--folder', $origin)
    $createdSpace = $created.space
    $active = (Invoke-Herdr @('ls')).spaces | Where-Object active
    $firstPane = ($active.tabs | Where-Object active).terminals | Where-Object terminal -eq $created.terminal
    if (!$createdSpace -or $active.id -ne $createdSpace -or $active.folder -ne $origin -or !$firstPane.pane) {
        throw 'The new fixture space is not active.'
    }
    $secondPane = Invoke-Herdr @('do', 'terminal.open', '--place', 'right', '--folder', $second)
    if (!$secondPane.pane -or !$secondPane.terminal) { throw 'Could not create the second pane.' }
    $shown = Invoke-Herdr @('do', 'layout.show', '--id', 'panel')
    $selected = Invoke-Herdr @('do', 'layout.select', '--stack', 'panel-body', '--child', 'files')
    if (!$shown.ok -or !$selected.ok) { throw 'Could not open the SwiftTree panel.' }
    Set-PaneFocus $firstPane.pane
    Wait-TerminalFolder $firstPane.terminal $origin
    if (!(Test-Panel 'starting' 'Origin.txt' @('Moved.txt', 'Second.txt'))) {
        throw 'Initial SwiftTree fixture was not visible.'
    }

    $quotedFolder = $afterCd.Replace("'", "''")
    & $hc send $firstPane.terminal "cd -LiteralPath '$quotedFolder'" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not send cd to the first pane.' }
    Wait-TerminalFolder $firstPane.terminal $afterCd
    $cdPassed = Test-Panel 'after-cd' 'Moved.txt' @('Origin.txt', 'Second.txt')

    Set-PaneFocus $secondPane.pane
    Wait-TerminalFolder $secondPane.terminal $second
    $panePassed = Test-Panel 'after-pane-focus' 'Second.txt' @('Origin.txt', 'Moved.txt')

    if (!$cdPassed -or !$panePassed) { throw 'SwiftTree did not follow the active terminal.' }
} finally {
    try {
        if ($createdSpace) {
            $closed = Invoke-Herdr @('do', 'space.close', '--id', $createdSpace, '--confirmed', 'true')
            $remaining = (Invoke-Herdr @('ls')).spaces | Where-Object id -eq $createdSpace
            if (!$closed.ok -or $remaining) { throw "Could not clean up fixture space $createdSpace." }
        }
    } finally {
        foreach ($name in $previousEnvironment.Keys) {
            Set-Item -LiteralPath "Env:$name" -Value $previousEnvironment[$name]
        }
    }
}
