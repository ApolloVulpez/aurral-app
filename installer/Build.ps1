param(
    [Parameter(Mandatory)]
    [string] $InnoCompiler
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $projectRoot 'Aurral.App.csproj'
$version = ([xml](Get-Content -LiteralPath $project -Raw)).Project.PropertyGroup.Version
$publishDir = Join-Path $projectRoot 'obj\installer-publish'
$outputDir = Join-Path $projectRoot 'dist\installer'
$bootstrapper = Join-Path $projectRoot 'obj\installer-tools\MicrosoftEdgeWebview2Setup.exe'
$innoCompilerPath = (Resolve-Path -LiteralPath $InnoCompiler).Path

if (-not (Test-Path -LiteralPath $bootstrapper -PathType Leaf)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $bootstrapper) -Force | Out-Null
    Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
}

$signature = Get-AuthenticodeSignature -FilePath $bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation(?:,|$)') {
    throw 'The WebView2 bootstrapper must have a valid Microsoft signature.'
}

dotnet publish $project -c Release -r win-x64 --self-contained -o $publishDir
if ($LASTEXITCODE -ne 0) { throw 'Aurral publish failed.' }

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
& $innoCompilerPath "/DAppVersion=$version" "/DPublishDir=$publishDir" "/DBootstrapper=$bootstrapper" "/O$outputDir" (Join-Path $PSScriptRoot 'Aurral.iss')
if ($LASTEXITCODE -ne 0) { throw 'Aurral installer build failed.' }
