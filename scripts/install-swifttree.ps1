param(
    [string]$HerdrApp = (Join-Path $env:LOCALAPPDATA 'Programs/herdr-app/herdr-app.exe'),
    [string]$AppHome = $env:HERDR_APP_HOME
)

$ErrorActionPreference = 'Stop'
if (-not $AppHome) {
    $AppHome = Join-Path $env:USERPROFILE '.config/herdr-app'
}

function Find-LayoutNode($Node, [string]$Id) {
    if ($Node.id -eq $Id) {
        $Node
    }
    foreach ($child in $Node.children) {
        Find-LayoutNode $child $Id
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
$keysPath = Join-Path $AppHome 'keys.json'
$env:HERDR_APP_HOME = $AppHome

$lockPath = Join-Path $AppHome '.swifttree-install.lock'
for ($attempt = 0; ; $attempt++) {
    try {
        $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
        break
    }
    catch [IO.IOException] {
        $reason = $_.Exception.GetBaseException().HResult -band 0xffff
        if ($attempt -ge 65 -or $reason -notin @(32,33)) { throw }
        Start-Sleep -Milliseconds 100
    }
}
$staging = Join-Path $AppHome ('.swifttree-install-' + [guid]::NewGuid())
$stagedMod = Join-Path $staging 'candidate'
$previousMod = Join-Path $staging 'previous'
$stagedLayout = Join-Path $staging 'layout.json'
$previousLayout = Join-Path $staging 'layout.previous.json'
$stagedKeys = Join-Path $staging 'keys.json'
$previousKeys = Join-Path $staging 'keys.previous.json'
$keepStaging = $false
$modInstalled = $false
$installComplete = $false

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
    $blocks = @(Find-LayoutNode $layout 'files')
    if ($blocks.Count -ne 1 -or $blocks[0].type -ne 'block' -or $blocks[0].content.mod -notin @('files', 'swifttree')) {
        throw 'The SwiftTree layout must have one Files block with its original ID.'
    }

    [IO.Directory]::CreateDirectory($stagedMod) | Out-Null
    foreach ($name in @('main.js', 'mod.json', 'windows-directory.js', 'linux-directory.js',
            'windows-watch.js', 'windows-watch-connection.js', 'linux-watch.js', 'tree-folders.js', 'tree-rows.js',
            'directory-access.js', 'windows-preview.js', 'file-search.js', 'file-search-view.js')) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination $stagedMod
    }
    & (Join-Path $PSScriptRoot 'build-swifttree-windows.ps1') -OutputPath (Join-Path $stagedMod 'swifttree-windows.exe')

    $layoutChanged = $blocks[0].content.mod -ne 'swifttree'
    if ($layoutChanged) {
        $blocks[0].content.mod = 'swifttree'
    }

    $keys = Get-Content -LiteralPath $keysPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$keys.PSObject.Properties['layout:swifttree']) {
        $keys | Add-Member -NotePropertyName 'layout:swifttree' -NotePropertyValue ([pscustomobject]@{})
    }
    $swiftTreeKeys = $keys.'layout:swifttree'
    if (!$swiftTreeKeys.PSObject.Properties['ctrl-p']) {
        $swiftTreeKeys | Add-Member -NotePropertyName 'ctrl-p' -NotePropertyValue 'mod.open:swifttree'
        [IO.File]::WriteAllText($stagedKeys, ($keys | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
    }
    if ($swiftTreeKeys.'ctrl-p' -ne 'mod.open:swifttree' -or
        ($keys.terminal -and $keys.terminal.PSObject.Properties['ctrl-p'])) {
        Write-Warning 'An existing Ctrl+P binding can take precedence over SwiftTree file search. Review the terminal and layout:swifttree sections in keys.json.'
    }
    if (!(Find-LayoutNode $layout 'swifttree-preview-warmup')) {
        $layout.children = @(@{
            id = 'swifttree-preview-warmup'
            type = 'block'
            resizable = $false
            size = @{ px = 0 }
            content = @{ mod = 'swifttree'; props = @{ role = 'preview-warmup' } }
        }) + @($layout.children)
        $layoutChanged = $true
    }
    if ($layoutChanged) {
        $json = $layout | ConvertTo-Json -Depth 100
        [IO.File]::WriteAllText($stagedLayout, $json, [Text.UTF8Encoding]::new($false))
    }

    [IO.Directory]::CreateDirectory((Split-Path -Parent $modPath)) | Out-Null
    if ([IO.Directory]::Exists($modPath)) {
        & (Join-Path $stagedMod 'swifttree-windows.exe') stop-preview $AppHome
        if ($LASTEXITCODE -ne 0) { throw 'The previous SwiftTree preview host did not exit.' }
        [IO.Directory]::Move($modPath, $previousMod)
    }
    [IO.Directory]::Move($stagedMod, $modPath)
    $modInstalled = $true
    if ([IO.File]::Exists($stagedLayout)) {
        [IO.File]::Replace($stagedLayout, $layoutPath, $previousLayout)
    }
    if ([IO.File]::Exists($stagedKeys)) {
        [IO.File]::Replace($stagedKeys, $keysPath, $previousKeys)
    }

    Invoke-HerdrLayout @('do', 'layout.switch', '--name', 'swifttree')
    $installComplete = $true
}
catch {
    $installFailure = $_
    try {
        if ([IO.File]::Exists($previousKeys)) {
            [IO.File]::Replace($previousKeys, $keysPath, (Join-Path $staging 'keys.rejected.json'))
        }
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
                    # The previous native worker can hold its image until its socket closes.
                    if ($attempt -ge 20) {
                        if (!$installComplete) { throw }
                        Write-Warning "SwiftTree is installed. The previous helper is still in use. Its staging folder can be removed after Herdr exits: $staging"
                        break
                    }
                    Start-Sleep -Milliseconds 100
                }
            }
        }
    }
    finally {
        $lock.Dispose()
    }
}
