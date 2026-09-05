# TOPDGI 設備安全回報器 - 自動部署與白名單設定腳本 (需以系統管理員身分執行)
# 作用：建立專屬安裝目錄、複製主程式、設定 Windows Defender 白名單，避免防毒軟體 (卡巴斯基/Defender) 誤判

$ErrorActionPreference = "Stop"

# 1. 定義安裝路徑
$InstallDir = "C:\Program Files\TopdgiAgent"
$ExeName = "設備安全回報器.exe"
$SourcePath = Join-Path $PSScriptRoot $ExeName
$TargetPath = Join-Path $InstallDir $ExeName

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  TOPDGI 設備安全回報器 - 自動部署工具   " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 檢查權限
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[錯誤] 請以「系統管理員身分 (Run as Administrator)」執行此腳本！" -ForegroundColor Red
    Exit
}

# 檢查來源 EXE 是否存在
if (-not (Test-Path $SourcePath)) {
    Write-Host "[警告] 在當前目錄找不到 $ExeName，請確認此腳本與 EXE 放在同一個資料夾下。" -ForegroundColor Yellow
    # 嘗試搜尋根目錄
    $ParentExe = Join-Path $PSScriptRoot "..\" | Join-Path -ChildPath $ExeName
    if (Test-Path $ParentExe) {
        $SourcePath = $ParentExe
        Write-Host "[提示] 已在父目錄找到主程式: $SourcePath" -ForegroundColor Green
    } else {
        Write-Host "[錯誤] 找不到主程式，請將此腳本放置於主程式旁再執行。" -ForegroundColor Red
        Exit
    }
}

# 2. 建立專屬安裝目錄
if (-not (Test-Path $InstallDir)) {
    Write-Host "[步驟 1] 建立安全安裝資料夾..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Host "已建立: $InstallDir" -ForegroundColor Green
}

# 3. 設定 Windows Defender 排除項目 (白名單)
Write-Host "[步驟 2] 設定 Windows Defender 本地排除防護..." -ForegroundColor Gray
try {
    Add-MpPreference -ExclusionPath $InstallDir -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionProcess $TargetPath -ErrorAction SilentlyContinue
    Write-Host "Windows Defender 白名單設定成功！" -ForegroundColor Green
} catch {
    Write-Host "[注意] 無法設定 Defender 排除項目，可能被卡巴斯基接管防護。" -ForegroundColor Yellow
}

# 4. 複製主程式到安全目錄
Write-Host "[步驟 3] 複製主程式至安全資料夾..." -ForegroundColor Gray
Copy-Item -Path $SourcePath -Destination $TargetPath -Force
Write-Host "已成功安裝至: $TargetPath" -ForegroundColor Green

# 5. 設定開機啟動 (Registry)
Write-Host "[步驟 4] 設定開機登錄檔自動啟動..." -ForegroundColor Gray
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $RegPath -Name "TopdgiDeviceAgent" -Value "`"$TargetPath`""
Write-Host "開機自動啟動設定成功！" -ForegroundColor Green

# 6. 在同仁桌面建立捷徑
Write-Host "[步驟 5] 在桌面建立執行捷徑..." -ForegroundColor Gray
try {
    $WshShell = New-Object -ComObject WScript.Shell
    $DesktopPath = [System.Environment]::GetFolderPath("Desktop")
    $Shortcut = $WshShell.CreateShortcut((Join-Path $DesktopPath "設備安全回報器.lnk"))
    $Shortcut.TargetPath = $TargetPath
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "TOPDGI 設備安全回報器"
    $Shortcut.Save()
    Write-Host "桌面捷徑建立成功！" -ForegroundColor Green
} catch {
    Write-Host "[注意] 桌面捷徑建立失敗，請手動發送捷徑到桌面。" -ForegroundColor Yellow
}

Write-Host "`n=========================================" -ForegroundColor Green
Write-Host "  部署完成！請點擊桌面捷徑啟動服務。     " -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

# 7. 卡巴斯基 whitelisting 說明
Write-Host "`n💡 卡巴斯基 (Kaspersky) 企業端排除設定指引：" -ForegroundColor Yellow
Write-Host "1. 本程式因包含【遠端執行指令、螢幕觀察畫面】功能，會被防毒軟體之啟發式掃描誤判為後門 (RAT)。" -ForegroundColor White
Write-Host "2. 請在卡巴斯基安全管理中心 (KSC) 或單機 GUI 中，設定【排除項目 (Exclusions)】：" -ForegroundColor White
Write-Host "   - 排除路徑: $InstallDir" -ForegroundColor Cyan
Write-Host "   - 排除檔案: $TargetPath" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Yellow
