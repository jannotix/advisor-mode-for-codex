param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Assert-UnlinkedPath([string]$Target) {
    $cursor = [IO.Path]::GetFullPath($Target)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing linked path: $cursor"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

Assert-UnlinkedPath $sourceRoot
$changes = & git -C $sourceRoot status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git status.' }
if ($changes) { throw 'Release requires a clean Git tree, including untracked development files. Commit the intended source first.' }
$sourceCommit = & git -C $sourceRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Cannot determine source commit.' }
$version = (Get-Content -LiteralPath (Join-Path $sourceRoot '.codex-plugin/plugin.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^[0-9A-Za-z][0-9A-Za-z.+-]*$') { throw 'Invalid release version.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $sourceRoot '.test-artifacts/releases' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
Assert-UnlinkedPath $output
if (Test-Path -LiteralPath $output) { throw "Release output must be a fresh directory: $output" }

& node (Join-Path $sourceRoot 'scripts/package.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Package build failed.' }
$package = Join-Path $sourceRoot 'dist/advisor-mode-for-codex'
foreach ($entry in Get-ChildItem -LiteralPath $package -Recurse -Force) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked package entry: $($entry.FullName)" }
}
$stage = Join-Path ([IO.Path]::GetTempPath()) ('advisor release ' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $stage '.agents/plugins')) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $stage 'dist')) | Out-Null
Assert-UnlinkedPath (Join-Path $sourceRoot 'INSTALL.md')
Assert-UnlinkedPath (Join-Path $sourceRoot '.agents/plugins/marketplace.json')
Copy-Item -LiteralPath (Join-Path $sourceRoot 'INSTALL.md') -Destination (Join-Path $stage 'INSTALL.md')
Copy-Item -LiteralPath (Join-Path $sourceRoot '.agents/plugins/marketplace.json') -Destination (Join-Path $stage '.agents/plugins/marketplace.json')
Copy-Item -LiteralPath $package -Destination (Join-Path $stage 'dist/advisor-mode-for-codex') -Recurse
foreach ($entry in Get-ChildItem -LiteralPath $stage -Recurse -Force) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked archive entry: $($entry.FullName)" }
}
@{ sourceCommit = $sourceCommit; version = $version } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'BUILD.json') -Encoding utf8
$currentCommit = & git -C $sourceRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $currentCommit -ne $sourceCommit) { throw 'Source commit changed during release staging.' }
$changes = & git -C $sourceRoot status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0) { throw 'Cannot recheck Git status.' }
if ($changes) { throw 'Source tree changed during release staging.' }
[IO.Directory]::CreateDirectory($output) | Out-Null
$archive = Join-Path $output "advisor-mode-for-codex-$version.zip"
# Include dot directories and use portable ZIP entry separators on Windows PowerShell 5.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($entry in Get-ChildItem -LiteralPath $stage -File -Recurse -Force) {
        $relative = $entry.FullName.Substring($stage.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $entry.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $zip.Dispose()
}
$digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$archive.sha256", "$digest  $([IO.Path]::GetFileName($archive))`n", [Text.UTF8Encoding]::new($false))
[ordered]@{ archive = $archive; sha256 = $digest; sourceCommit = $sourceCommit; version = $version; stagingDirectory = $stage } | ConvertTo-Json
