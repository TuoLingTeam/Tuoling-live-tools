# 在项目根目录执行，将 npm run build 的完整输出保存到 tmp/build-output.txt
Set-Location $PSScriptRoot\..

$outDir = "tmp"
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

$outPath = Join-Path $outDir "build-output.txt"
Write-Host "Running: npm run build 2>&1 | Tee-Object -FilePath $outPath"
npm run build 2>&1 | Tee-Object -FilePath $outPath
Write-Host "`nOutput saved to $outPath. Last 50 lines:"
Get-Content $outPath -Tail 50
