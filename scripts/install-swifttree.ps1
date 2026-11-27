param(
    [string]$HerdrApp = (Join-Path $env:LOCALAPPDATA 'Programs/herdr-app/herdr-app.exe'),
    [string]$AppHome = $env:HERDR_APP_HOME
)

$ErrorActionPreference = 'Stop'
if (-not $AppHome) {
    $AppHome = Join-Path $env:USERPROFILE '.config/herdr-app'
}

function Find-FilesBlock($Node) {
    if ($Node.id -eq 'files' -and $Node.type -eq 'block') {
        $Node
    }
    foreach ($child in $Node.children) {
        Find-FilesBlock $child
    }
}

function Invoke-HerdrLayout([string[]]$Arguments) {
    $process = Start-Process -FilePath $HerdrApp -ArgumentList $Arguments -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        throw "Herdr $($Arguments -join ' ') failed with exit code $($process.ExitCode)."
    }
}

$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'mods/swifttree'
$AppHome = (Resolve-Path -LiteralPath $AppHome).Path
$layoutPath = Join-Path $AppHome 'layouts/swifttree.json'
$modPath = Join-Path $AppHome 'mods/swifttree'
$env:HERDR_APP_HOME = $AppHome

$lockPath = Join-Path $AppHome '.swifttree-install.lock'
$lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
$staging = Join-Path $AppHome ('.swifttree-install-' + [guid]::NewGuid())
$stagedMod = Join-Path $staging 'candidate'
$previousMod = Join-Path $staging 'previous'
$stagedLayout = Join-Path $staging 'layout.json'
$previousLayout = Join-Path $staging 'layout.previous.json'
$keepStaging = $false
$modInstalled = $false

try {
    if (-not (Test-Path -LiteralPath $layoutPath -PathType Leaf)) {
        Invoke-HerdrLayout @('do', 'layout.clone', '--name', 'main', '--as', 'swifttree')
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (Test-Path -LiteralPath $layoutPath -PathType Leaf) { break }
            Start-Sleep -Milliseconds 100
        }
    }

    if (-not (Test-Path -LiteralPath $layoutPath -PathType Leaf)) {
        throw 'Open the Herdr window for this app home before installing SwiftTree.'
    }

    $layout = Get-Content -LiteralPath $layoutPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $blocks = @(Find-FilesBlock $layout)
    if ($blocks.Count -ne 1 -or $blocks[0].content.mod -notin @('files', 'swifttree')) {
        throw 'The SwiftTree layout must have one Files block with its original ID.'
    }

    [IO.Directory]::CreateDirectory($stagedMod) | Out-Null
    foreach ($name in @('main.js', 'mod.json', 'windows-directory.js', 'linux-directory.js',
            'windows-watch.js', 'windows-watch-connection.js')) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination $stagedMod
    }
    & (Join-Path $PSScriptRoot 'build-swifttree-windows.ps1') -OutputPath (Join-Path $stagedMod 'swifttree-windows.exe')

    if ($blocks[0].content.mod -ne 'swifttree') {
        $blocks[0].content.mod = 'swifttree'
        $json = $layout | ConvertTo-Json -Depth 100
        [IO.File]::WriteAllText($stagedLayout, $json, [Text.UTF8Encoding]::new($false))
    }

    [IO.Directory]::CreateDirectory((Split-Path -Parent $modPath)) | Out-Null
    if ([IO.Directory]::Exists($modPath)) {
        [IO.Directory]::Move($modPath, $previousMod)
    }
    [IO.Directory]::Move($stagedMod, $modPath)
    $modInstalled = $true
    if ([IO.File]::Exists($stagedLayout)) {
        [IO.File]::Replace($stagedLayout, $layoutPath, $previousLayout)
    }

    Invoke-HerdrLayout @('do', 'layout.switch', '--name', 'swifttree')
}
catch {
    $installFailure = $_
    try {
        if ([IO.File]::Exists($previousLayout)) {
            [IO.File]::Replace($previousLayout, $layoutPath, (Join-Path $staging 'layout.rejected.json'))
        }
        if ($modInstalled) {
            [IO.Directory]::Move($modPath, $stagedMod)
        }
        if ([IO.Directory]::Exists($previousMod)) {
            [IO.Directory]::Move($previousMod, $modPath)
        }
    }
    catch {
        $keepStaging = $true
        throw "SwiftTree installation failed: $installFailure Restore failed: $_ Recovery files: $staging"
    }
    throw $installFailure
}
finally {
    try {
        if (-not $keepStaging -and [IO.Directory]::Exists($staging)) {
            for ($attempt = 0; ; $attempt++) {
                try {
                    Remove-Item -LiteralPath $staging -Recurse -Force
                    break
                }
                catch [IO.IOException], [UnauthorizedAccessException] {
                    # The previous native watcher exits when the old Mod's socket closes.
                    if ($attempt -ge 20) { throw }
                    Start-Sleep -Milliseconds 100
                }
            }
        }
    }
    finally {
        $lock.Dispose()
    }
}
