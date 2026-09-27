param([switch]$UseCache)
$ErrorActionPreference = 'Stop'
$pythonRuntime = 'C:\Users\fy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$obsidianCli = 'C:\Users\fy\AppData\Local\Programs\Obsidian\Obsidian.com'
$jobLock = [System.IO.File]::Open('D:\AppData\ReadwiseReaderArchive\import.lock',[System.IO.FileMode]::OpenOrCreate,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments | Tee-Object -Variable output
  if ($LASTEXITCODE -ne 0) { throw "Command failed: $Program" }
  if (@($output|Where-Object {$_ -match '^Error:'}).Count) { throw 'Obsidian CLI reported an error' }
}
Push-Location 'D:\Workspaces\新建文件夹'
try {
  if (-not $UseCache) { Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'fetch.mjs')) }
  Invoke-Checked $pythonRuntime @((Join-Path $PSScriptRoot 'validate-binaries.py'))
  Invoke-Checked $pythonRuntime @((Join-Path $PSScriptRoot 'convert-pdf.py'))
  Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'convert.test.mjs'))
  Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'binary-audit.mjs'))
  Invoke-Checked $obsidianCli @('vault=新建文件夹','eval','code=(async()=>{await app.plugins.plugins["local-ir"].flushDocumentStateSidecars();return "flushed"})()')
  Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'import.mjs'),'plan')
  $receiptPath = 'D:\Artifacts\ReadwiseReaderArchive\native-import-result.json'
  $oldReceipt = if(Test-Path -LiteralPath $receiptPath){(Get-FileHash -LiteralPath $receiptPath).Hash}else{''}
  $code = 'globalThis.__readerArchiveImportJob=eval(require("fs").readFileSync("D:/Projects/ReadwiseReaderArchiveImporter/apply-native.js","utf8"));globalThis.__readerArchiveImportJob.catch(error=>{const fs=require("fs");const f="D:/Artifacts/ReadwiseReaderArchive/native-import-result.json";const r=JSON.parse(fs.readFileSync(f,"utf8"));r.error=error.message;fs.writeFileSync(f,JSON.stringify(r,null,2));});"started"'
  Invoke-Checked $obsidianCli @('vault=新建文件夹','eval',("code="+$code))
  $deadline = (Get-Date).AddMinutes(15)
  $lastCount = -1
  $receipt = $null
  do {
    Start-Sleep -Seconds 2
    if (-not (Test-Path -LiteralPath $receiptPath)) { continue }
    if ((Get-FileHash -LiteralPath $receiptPath).Hash -eq $oldReceipt) { continue }
    try { $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json } catch { continue }
    if ($receipt.documents.Count -ne $lastCount) { $lastCount=$receipt.documents.Count; Write-Output "Native import verified: $lastCount" }
    if ($receipt.error) { Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'import.mjs'),'record'); throw $receipt.error }
    if ($receipt.completedAt) { break }
  } while ((Get-Date) -lt $deadline)
  if (-not $receipt.completedAt) { throw 'Native import has not completed; receipt retains progress' }
  Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'import.mjs'),'record')
  Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'verify.mjs'))
  Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'report.mjs'))
  Write-Output 'Done. Review D:\Artifacts\ReadwiseReaderArchive\import-plan.json for held or excluded files.'
} finally { $jobLock.Dispose(); Pop-Location }
