# TOPDGI IT 運維與監控系統 - 系統架構、維護與交接 SOP 手冊

本手冊供 IT 運維團隊交接、後續維護、SOP 部署與程式修改參考。

---

## 1. 🛠️ 使用技術、語言與工具鏈 (Technology Stack)

| 元件名稱 | 主要語言 / 框架 | 關鍵模組 / 套件 | 說明與用途 |
| :--- | :--- | :--- | :--- |
| **Web 中控前端** | HTML5, Vanilla CSS3, JavaScript (ES6+) | Canvas API, Fetch API, Flexbox/Grid | Morandi 質感暗色主題、3D/平面地圖即時監控、單機/批次檔案派送與廣播主控台。 |
| **後端通訊伺服器** | Node.js | Express.js, `dgram` (UDP), `fs`, `path` | 運作於 `http://localhost:3000`。負責心跳資料掃描、跨網段 HTTP 代理、WOL 網路喚醒與共用槽命令佇列備援。 |
| **被控端 Agent** | Python 3.12 | Tkinter, CTypes, `psutil`, `socketserver` | 運作於同仁電腦，監聽 Port `3010`。負責資產盤點、全螢幕截圖、命令列、檔案接收與系統公告。 |
| **打包工具** | PyInstaller | `PyInstaller --noconsole --onefile` | 將 Python 原始碼打包為無 Console 視窗的獨立 `設備安全回報器.exe`。 |

---

## 2. 🧠 核心運作機制與邏輯規則 (Core Rules & Logic)

### A. 心跳回報與設備自動偵測機制 (Heartbeat Mechanism)
1. **被控端動作**：Agent 啟動後，每 30 秒自動寫入一筆 JSON 報告至網路共用槽（預設 `Z:\工具開發\Devices` 或 UNC 路徑 `\\<IP>\工具開發\Devices`），檔名為 `電腦名稱_MAC.json`。
2. **中控端掃描**：後端 `server.js` 隨時循序掃描共用槽目錄與其子目錄，讀取設備 IP、MAC、名稱與 `timestamp`。
3. **狀態判定與自動告警**：
   * **線上 (Online)**：`timestamp` 於 3 分鐘內更新。
   * **離線 (Offline)**：超過 3 分鐘未更新。
   * **故障舉手 (Incident)**：當同仁點擊 Agent 上的「🙋 舉手反映」時，JSON 中的 `status` 會轉為 `"incident"`，中控台地圖上會自動建立緊急維護工單。

### B. 跨網段 / 跨 VLAN 連線與雙通道機制 (Cross-Subnet Dual Channel)
為了確保跨不同 Subnet（如 `10.1.30.x` 與 `10.1.40.x`）能 100% 成功連線與執行指令：
1. **通道一：Windows 防火牆自動放行**
   * Agent 啟動時會透過 PowerShell 自動執行：
     `New-NetFirewallRule -Name TopdgiAgentPort -DisplayName "Topdgi Agent Port 3010" -Direction Inbound -LocalPort 3010 -Protocol TCP -Action Allow -Profile Any -RemoteAddress Any`
   * 確保所有不同網段的入站 TCP 3010 請求皆可通過。
2. **通道二：共用槽命令佇列備援 (Shared Drive Command Queue Fallback)**
   * 若路由層級之硬體防火牆阻斷了跨 Subnet 的直連 TCP，後端 `server.js` 在 Proxy 超時 (2.5s) 後會**自動切換至備援通道**：
     1. 將指令寫入共用槽 `Devices/cmd_queue/CMD_xxx.json`。
     2. Agent 的背景輪詢執行緒（每 1.5 秒）讀取並執行該指令（如廣播、檔案派送）。
     3. Agent 將結果寫回 `cmd_queue/responses/resp_xxx.json`，後端讀取後傳回 Web 前端。

### C. 螢幕監看與高 DPI 解析度相容 (DPI-Aware Capture & Fallback)
1. **高 DPI 點陣相容**：螢幕擷取腳本在執行前會宣告 `[DPIAware]::SetProcessDPIAware()`，確保獲取同仁螢幕的**真實實體解析度**（如 1920x1080），防止 Windows 125%/150% 縮放導致畫面被裁切只剩左上角。
2. **無顯示器/虛擬機器 Fallback 繪圖**：當同仁電腦處於鎖定、RDP 最小化或無顯示卡控制碼 (GDI Handle Invalid) 時，擷取程式會自動轉為記憶體繪圖，產出一張深灰色提示圖（「遠端畫面已鎖定或處於背景模式」），確保串流不中斷且不拋出 500 錯誤。

### D. 右下角系統托盤常駐與防誤關機制 (System Tray Hook)
1. **Win32 Hook 攔截**：透過 Python `ctypes` 呼叫 Windows `Shell_NotifyIconW` API，在右下角通知區域（Tray）掛載圖示。
2. **關閉按鈕 (X) 邏輯**：
   * 點擊 **「是」**：徹底退出背景 HTTP 服務並銷毀視窗。
   * 點擊 **「否」**：呼叫 `root.withdraw()` 隱藏工作列圖示，僅保留右下角系統托盤圖示背景常駐。
3. **托盤互動**：
   * 滑鼠雙擊 / 左鍵點擊托盤圖示：呼叫 `restore_from_tray()` (`root.deiconify()`) 還原視窗。
   * 滑鼠右鍵點擊：彈出快捷選單（顯示主視窗 / 徹底退出程式）。

---

## 3. 📋 IT 運維與部署 SOP 指引

### SOP 1：編譯打包被控端 Executable
當修改 `device_agent.py` 後，請開啟 PowerShell 執行：
```powershell
python -m PyInstaller --noconsole --onefile --clean --name "設備安全回報器" device_agent.py
```
編譯完成後，執行檔將位於 `dist/設備安全回報器.exe`。

### SOP 2：同仁電腦部署步驟
1. 將 `設備安全回報器.exe` 放置於同仁電腦（建議路徑：`C:\Program Files\TopdgiAgent\設備安全回報器.exe`）。
2. 滑鼠右鍵點選該 `.exe`，選擇 **「以系統管理員身分執行」**（第一次執行需管理員權限以自動建立 Windows 防火牆放行規則）。
3. 勾選介面上的 **「開機時自動啟動被控端程式」**。
4. 點選右上角關閉 (X)，並選擇 **「否」**，程式即會縮小至右下角系統托盤常駐運作。

### SOP 3：開啟與啟動中控台後端
在 IT 管理員電腦上：
```powershell
cd backend
node server.js
```
伺服器啟動後，開啟瀏覽器造訪 `http://localhost:3000` 即可進入運維中控台。

---

## 4. 📁 專案檔案目錄結構說明

```
it-admin-simulator/
├── index.html                   # 中控台 Web 前端主介面
├── style.css                    # 樣式定義 (Morandi & Cyberpunk 主題)
├── app.js                       # 前端核心邏輯 (地圖渲染、單機與批次運維模組)
├── device_agent.py              # Python 被控端 Agent 原始碼 (GUI、API、System Tray)
├── 設備安全回報器.exe           # 已編譯完成之 Windows 獨立執行檔
├── 安裝與白名單設定腳本.ps1      # 自動化 Defender / 卡巴斯基排除與部署腳本
└── backend/
    ├── server.js                # Node.js Express 後端伺服器 (Proxy、WOL、Batch API)
    └── device_assignments.json  # 設備樓層與空間配置持久化資料檔
```
