param([Parameter(Mandatory)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'mods/swifttree'
$sources = @('windows-directory.cs', 'windows-watcher.cs', 'windows-local-service.cs',
    'windows-core-bridge.cs', 'windows-directory-server.cs', 'windows-preview-launcher.cs',
    'windows-preview-endpoint.cs') | ForEach-Object {
    Join-Path $source $_
}
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
if (-not [IO.File]::Exists((Join-Path $framework 'csc.exe'))) {
    $framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319'
}
$compiler = Join-Path $framework 'csc.exe'
if (-not [IO.File]::Exists($compiler)) {
    throw 'SwiftTree requires the Windows .NET Framework C# compiler.'
}

& $compiler /nologo /optimize+ /target:exe "/reference:$(Join-Path $framework 'System.Web.Extensions.dll')" "/out:$OutputPath" @sources
if ($LASTEXITCODE -ne 0) {
    throw "SwiftTree Windows directory reader compilation failed with exit code $LASTEXITCODE."
}

$destination = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))) 'preview-host'
[IO.Directory]::CreateDirectory($destination) | Out-Null
$sdk = Join-Path $source 'preview-sdk'
$processor = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $processor = $env:PROCESSOR_ARCHITEW6432 }
$architecture = switch ($processor) {
    AMD64 { 'x64' }
    ARM64 { 'arm64' }
    x86 { 'x86' }
    default { throw 'Unknown Windows processor architecture for the WebView2 loader.' }
}
$previewSources = @('windows-preview-host.cs', 'windows-preview-file.cs', 'windows-preview-endpoint.cs', 'windows-local-service.cs') |
    ForEach-Object { Join-Path $source $_ }
$previewReferences = @('System.Drawing.dll', 'System.Web.Extensions.dll', 'System.Windows.Forms.dll') |
    ForEach-Object { "/reference:$(Join-Path $framework $_)" }
foreach ($name in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
    $assembly = Join-Path $sdk $name
    $previewReferences += "/reference:$assembly"
    Copy-Item -LiteralPath $assembly -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $sdk "$architecture/WebView2Loader.dll") -Destination $destination
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt'),(Join-Path $sdk 'NOTICE.txt') -Destination $destination
Expand-Archive -LiteralPath (Join-Path $source 'preview-web/site.zip') -DestinationPath (Join-Path $destination 'site') -Force

$preview = Join-Path $destination 'swifttree-preview.exe'
& $compiler /nologo /optimize+ /target:winexe "/platform:$architecture" "/out:$preview" @previewReferences @previewSources
if ($LASTEXITCODE -ne 0) {
    throw "SwiftTree expanded preview compilation failed with exit code $LASTEXITCODE."
}
[IO.File]::WriteAllText((Join-Path $destination 'build-id'), [guid]::NewGuid().ToString('N'))
