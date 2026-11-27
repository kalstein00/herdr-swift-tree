param([Parameter(Mandatory)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'mods/swifttree/windows-directory.cs'
$watcher = Join-Path (Split-Path -Parent $source) 'windows-watcher.cs'
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
if (-not [IO.File]::Exists((Join-Path $framework 'csc.exe'))) {
    $framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319'
}
$compiler = Join-Path $framework 'csc.exe'
if (-not [IO.File]::Exists($compiler)) {
    throw 'SwiftTree requires the Windows .NET Framework C# compiler.'
}

& $compiler /nologo /optimize+ /target:exe "/reference:$(Join-Path $framework 'System.Web.Extensions.dll')" "/out:$OutputPath" $source $watcher
if ($LASTEXITCODE -ne 0) {
    throw "SwiftTree Windows directory reader compilation failed with exit code $LASTEXITCODE."
}
