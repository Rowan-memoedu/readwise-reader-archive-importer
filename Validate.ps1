$ErrorActionPreference = 'Stop'
$pythonRuntime = 'C:\Users\fy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $pythonRuntime)) { throw 'Bundled Python runtime is unavailable' }
& $pythonRuntime (Join-Path $PSScriptRoot 'validate-binaries.py')
if ($LASTEXITCODE -ne 0) { throw 'Original-source validation failed' }
& $pythonRuntime (Join-Path $PSScriptRoot 'convert-pdf.py')
if ($LASTEXITCODE -ne 0) { throw 'PDF conversion failed' }
& node (Join-Path $PSScriptRoot 'convert.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Converter regression test failed' }
& node (Join-Path $PSScriptRoot 'binary-audit.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Native import validation failed' }
Write-Output 'Review D:\Artifacts\ReadwiseReaderArchive\binary-import-audit.json. Held files are not imported.'
