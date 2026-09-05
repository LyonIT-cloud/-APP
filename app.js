// ENTERPRISE IT MONITORING CONSOLE - CORE CONTROLLER

// SOUND GENERATOR (Web Audio API for real-time alerts without files)
class SoundFX {
    constructor() {
        this.ctx = null;
    }
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    playAlert() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this.beep(650, 0.12, now);
        this.beep(650, 0.12, now + 0.18);
    }
    playSuccess() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this.beep(523.25, 0.08, now); // C5
        this.beep(659.25, 0.08, now + 0.08); // E5
        this.beep(783.99, 0.08, now + 0.16); // G5
        this.beep(1046.50, 0.25, now + 0.24); // C6
    }
    playElevator() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this.beep(880, 0.5, now, 0.04); // A5 chime
    }
    beep(freq, duration, time, vol = 0.05) {
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time);
            gain.gain.setValueAtTime(vol, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(time);
            osc.stop(time + duration + 0.05);
        } catch (e) {
            console.error("Audio error", e);
        }
    }
}

const sfx = new SoundFX();

// APPLICATION STATE
const state = {
    uptime: 0,
    activeFloor: 1, // 預設為 1F
    autoPilot: false,
    showIPLabels: false,
    showMACLabels: false,
    selectedDeptFilter: 'all',
    serverOnline: false,
    selectedDevice: null,
    admin: {
        x: 0,
        y: 0,
        floor: 3,
        status: 'idle', // idle, moving, elevator, fixing
        targetX: 0,
        targetY: 0,
        targetRoom: null,
        targetDevice: null,
        currentTicket: null,
        fixProgress: 0,
        fixTimer: null,
        speed: 4.5 // pixels per frame
    },
    tickets: [],
    rooms: {}, 
    devices: {}, 
    telemetry: {
        serverTemp: 38,
        trafficHistory: [30, 45, 35, 60, 50, 40, 55, 48, 52, 45]
    }
};

// IT SERVICE INCIDENT SCHEMES
const INCIDENT_SCHEMES = {
    printer_jam: { name: '複合式印表機卡紙故障', desc: '使用者報修：印表機卡紙，紅燈閃爍且列印佇列停滯。', severity: 'medium', fixTime: 3000, isSoftware: false },
    bsod: { name: '用戶電腦核心錯誤 (藍屏)', desc: '異常偵測：Windows 核心錯誤傾印，代碼 CRITICAL_PROCESS_DIED。', severity: 'high', fixTime: 4000, isSoftware: true },
    wifi_outage: { name: '無線網路節點 AP 無回應', desc: '監控異常：SSID 無法連線，內部 DHCP 配發失敗。', severity: 'high', fixTime: 5000, isSoftware: false },
    server_overheat: { name: '核心伺服器節點高溫警告', desc: '主機房警報：節點 #03 CPU 核心溫度達 78°C，冷卻異常。', severity: 'critical', fixTime: 7000, isSoftware: false },
    virus_alert: { name: '安全防護異常：偵測惡意掃描', desc: '防火牆通報：受控主機正向內部網段進行 Port 445 掃描。', severity: 'critical', fixTime: 6000, isSoftware: true },
    password_reset: { name: 'AD 網域帳號鎖定要求', desc: '使用者申請：帳號輸入密碼錯誤達 5 次鎖定，需重設。', severity: 'low', fixTime: 2000, isSoftware: true }
};

// Dynamic FLOOR PLAN SCHEME loaded from server
let FLOOR_SCHEME = {};

const fallback_floor_scheme = {
    3: {
        name: '3F 研發部門 / 核心機房',
        rooms: [
            { id: '3_server', name: '主核心機房', dept: 'IT運維部', grid: 'grid-column: 1/3; grid-row: 1/4;', subnet: '10.3.0', devicesCount: 3, types: ['SRV', 'SRV', 'PC'], cssClass: '' },
            { id: '3_rda', name: '研發一課 (RD-A)', dept: '研發處', grid: 'grid-column: 3/6; grid-row: 1/4;', subnet: '10.3.1', devicesCount: 4, types: ['PC', 'NB', 'PC', 'NB'], cssClass: '' },
            { id: '3_rdb', name: '研發二課 (RD-B)', dept: '研發處', grid: 'grid-column: 3/6; grid-row: 4/7;', subnet: '10.3.2', devicesCount: 4, types: ['NB', 'NB', 'PC', 'PC'], cssClass: '' },
            { id: '3_meet', name: '核心戰情室 (3A)', dept: '研發處', grid: 'grid-column: 1/3; grid-row: 4/7;', subnet: '10.3.3', devicesCount: 2, types: ['NB', 'AP'], cssClass: '' }
        ]
    },
    2: {
        name: '2F 業務部門 / 行銷中心',
        rooms: [
            { id: '2_sales', name: '業務處辦公室', dept: '業務處', grid: 'grid-column: 1/3; grid-row: 1/4;', subnet: '10.2.1', devicesCount: 4, types: ['NB', 'NB', 'NB', 'PC'], cssClass: '' },
            { id: '2_mkt', name: '品牌行銷辦公區', dept: '行銷處', grid: 'grid-column: 3/6; grid-row: 1/4;', subnet: '10.2.2', devicesCount: 4, types: ['NB', 'PC', 'NB', 'PC'], cssClass: '' },
            { id: '2_pantry', name: '休閒茶水間', dept: '行政處', grid: 'grid-column: 1/3; grid-row: 4/7;', subnet: '10.2.3', devicesCount: 1, types: ['PRN'], cssClass: '' },
            { id: '2_meet', name: '大型多功能會議室', dept: '業務處', grid: 'grid-column: 3/6; grid-row: 4/7;', subnet: '10.2.4', devicesCount: 2, types: ['NB', 'AP'], cssClass: '' }
        ]
    },
    1: {
        name: '1F 廠區配置',
        rooms: [
            { id: '1_mgmt', name: '管理部', dept: '行政處', grid: 'grid-column: 1; grid-row: 1;', subnet: '10.1.1', devicesCount: 1, types: ['PC'], cssClass: '' },
            { id: '1_gm', name: '總經理辦公室', dept: '管理部', grid: 'grid-column: 2; grid-row: 1;', subnet: '10.1.2', devicesCount: 1, types: ['PC'], cssClass: '' },
            { id: '1_chair', name: '董事長辦公室', dept: '管理部', grid: 'grid-column: 3; grid-row: 1;', subnet: '10.1.3', devicesCount: 1, types: ['PC'], cssClass: '' },
            { id: '1_joint', name: '聯合辦公室', dept: '行政處', grid: 'grid-column: 4; grid-row: 1;', subnet: '10.1.4', devicesCount: 2, types: ['PC', 'NB'], cssClass: '' },
            { id: '1_meetL', name: '大會議室', dept: '行政處', grid: 'grid-column: 1; grid-row: 2;', subnet: '10.1.5', devicesCount: 1, types: ['AP'], cssClass: '' },
            { id: '1_meetS', name: '小會議室', dept: '行政處', grid: 'grid-column: 2; grid-row: 2;', subnet: '10.1.6', devicesCount: 1, types: ['AP'], cssClass: '' },
            { id: '1_smtA', name: 'SMT區域', dept: '生產部', grid: 'grid-column: 3; grid-row: 2;', subnet: '10.80.1', devicesCount: 2, types: ['PC', 'PC'], cssClass: 'dept-prod' },
            { id: '1_smtL', name: 'SMT產線', dept: '生產部', grid: 'grid-column: 4; grid-row: 2;', subnet: '10.80.2', devicesCount: 2, types: ['SRV', 'PC'], cssClass: 'dept-prod' },
            { id: '1_dip', name: 'DIP產線', dept: '生產部', grid: 'grid-column: 1; grid-row: 3;', subnet: '10.80.3', devicesCount: 2, types: ['PC', 'PC'], cssClass: 'dept-prod' },
            { id: '1_store', name: '倉管區域', dept: '倉儲部', grid: 'grid-column: 2; grid-row: 3;', subnet: '10.1.7', devicesCount: 1, types: ['PC'], cssClass: 'dept-storage' },
            { id: '1_elec', name: '電子倉庫', dept: '倉儲部', grid: 'grid-column: 3; grid-row: 3;', subnet: '10.1.8', devicesCount: 1, types: ['NB'], cssClass: 'dept-storage' },
            { id: '1_maint', name: '維修區', dept: 'IT運維部', grid: 'grid-column: 4; grid-row: 3;', subnet: '10.1.9', devicesCount: 2, types: ['PC', 'NB'], cssClass: 'dept-maint' }
        ]
    }
};

async function fetchFloorScheme() {
    try {
        const response = await fetch('http://localhost:3000/api/floor_scheme');
        if (response.ok) {
            FLOOR_SCHEME = await response.json();
        } else {
            throw new Error();
        }
    } catch (e) {
        console.warn("[Dashboard] Failed to fetch floor scheme from server, using local fallback.");
        FLOOR_SCHEME = JSON.parse(JSON.stringify(fallback_floor_scheme));
    }
}

// MAC GENERATOR
function generateMAC() {
    const hex = "0123456789ABCDEF";
    let mac = "";
    for (let i = 0; i < 6; i++) {
        mac += hex.charAt(Math.floor(Math.random() * 16));
        mac += hex.charAt(Math.floor(Math.random() * 16));
        if (i < 5) mac += ":";
    }
    return mac;
}

function logConsole(msg, type = 'system-log') {
    const consoleLog = document.getElementById('console-log');
    if (!consoleLog) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.innerText = `[${new Date().toTimeString().split(' ')[0]}] ${msg}`;
    consoleLog.appendChild(line);
    consoleLog.scrollTop = consoleLog.scrollHeight;
}

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    fetchFloorScheme().then(() => {
        renderFloorTabs();
        setupDeptMgmtListeners();
        setupFloorMgmtListeners();
        initBatchOpsModule();
        renderFloor(state.activeFloor);

        const autoPilotToggle = document.getElementById('auto-pilot-toggle');
        if(autoPilotToggle) {
            autoPilotToggle.addEventListener('change', (e) => {
                state.autoPilot = e.target.checked;
                logConsole(`[監控] 自動派工模式已${state.autoPilot ? '啟用' : '停用'}。`, state.autoPilot ? 'cyan-log' : 'system-log');
                if (state.autoPilot && state.admin.status === 'idle') {
                    dispatchNextTicket();
                }
            });
        }

        const showIp = document.getElementById('toggle-show-ip');
        if(showIp) {
            showIp.addEventListener('change', (e) => {
                state.showIPLabels = e.target.checked;
                renderFloor(state.activeFloor);
            });
        }

        const showMac = document.getElementById('toggle-show-mac');
        if(showMac) {
            showMac.addEventListener('change', (e) => {
                state.showMACLabels = e.target.checked;
                renderFloor(state.activeFloor);
            });
        }

        const filterDept = document.getElementById('filter-dept');
        if(filterDept) {
            filterDept.addEventListener('change', (e) => {
                state.selectedDeptFilter = e.target.value;
                renderFloor(state.activeFloor);
            });
        }

        const searchInput = document.getElementById('search-input');
        if(searchInput) {
            searchInput.addEventListener('input', (e) => {
                handleSearch(e.target.value);
            });
        }

        const btnTrigger = document.getElementById('btn-trigger-incident');
        if(btnTrigger) {
            btnTrigger.addEventListener('click', () => {
                triggerRandomIncident();
            });
        }

        const btnClear = document.getElementById('btn-clear-log');
        if(btnClear) {
            btnClear.addEventListener('click', () => {
                const consoleLog = document.getElementById('console-log');
                consoleLog.innerHTML = `<div class="log-line system-log">[${new Date().toTimeString().split(' ')[0]}] 控制台日誌已重設。</div>`;
            });
        }

        const btnRetest = document.getElementById('btn-retest-net');
        if(btnRetest) {
            btnRetest.addEventListener('click', detectLocalNetwork);
        }

        setTimeout(() => {
            resetAdminToHome();
            syncTicketsAndIncidents();
            updateDeviceTotalCount();
            detectLocalNetwork();
        }, 500);

        setInterval(() => {
            state.uptime++;
            const h = String(Math.floor(state.uptime / 3600)).padStart(2, '0');
            const m = String(Math.floor((state.uptime % 3600) / 60)).padStart(2, '0');
            const s = String(state.uptime % 60).padStart(2, '0');
            const uptimeVal = document.getElementById('uptime-value');
            if(uptimeVal) uptimeVal.innerText = `${h}:${m}:${s}`;
        }, 1000);

        // Sync with backend server
        setInterval(ticketGeneratorTick, 3000);
        setInterval(updateTelemetry, 3000);
        
        // Setup Remote Operations UI bindings
        setupRemoteOpsBindings();
        
        // START ENGINE
        requestAnimationFrame(gameLoop);
    });
});

// Setup department and space management modal listeners
function setupDeptMgmtListeners() {
    const btnOpen = document.getElementById('btn-open-dept-mgmt');
    const btnClose = document.getElementById('btn-close-dept-mgmt');
    const btnCancel = document.getElementById('btn-cancel-dept-save');
    const btnSave = document.getElementById('btn-save-dept-changes');
    const btnAdd = document.getElementById('btn-add-new-room');
    const modal = document.getElementById('dept-mgmt-modal');

    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            document.getElementById('modal-floor-title').innerText = `${state.activeFloor}F`;
            const floorNameInput = document.getElementById('modal-floor-name-input');
            if (floorNameInput) {
                floorNameInput.value = FLOOR_SCHEME[state.activeFloor]?.name || '';
            }
            renderModalRoomsList();
            modal.style.display = 'flex';
        });
    }

    if (btnClose) btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
    if (btnCancel) btnCancel.addEventListener('click', () => { modal.style.display = 'none'; });

    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const listEl = document.getElementById('modal-rooms-list');
            const roomIndex = listEl.children.length + 1;
            const newId = `${state.activeFloor}_room_${Math.floor(Math.random()*10000)}`;
            
            const row = document.createElement('div');
            row.className = 'modal-room-row';
            row.dataset.id = newId;
            row.innerHTML = `
                <div>
                    <label>區域/房間名稱</label>
                    <input type="text" class="room-name-input select-input" value="新分區區域-${roomIndex}">
                </div>
                <div>
                    <label>所屬部門標籤</label>
                    <input type="text" class="room-dept-input select-input" value="一般部門">
                </div>
                <div>
                    <label>網格配置 (CSS Grid)</label>
                    <input type="text" class="room-grid-input select-input" value="${state.activeFloor === 1 ? 'grid-column: 1; grid-row: 1;' : 'grid-column: 1/3; grid-row: 1/3;'}">
                </div>
                <button class="btn" onclick="this.parentElement.remove()">刪除</button>
            `;
            listEl.appendChild(row);
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const listEl = document.getElementById('modal-rooms-list');
            const newRooms = [];
            
            for (const row of listEl.children) {
                const id = row.dataset.id;
                const name = row.querySelector('.room-name-input').value.trim();
                const dept = row.querySelector('.room-dept-input').value.trim();
                const grid = row.querySelector('.room-grid-input').value.trim();
                
                if (!name || !dept || !grid) {
                    alert("所有欄位皆為必填！");
                    return;
                }
                
                newRooms.push({
                    id,
                    name,
                    dept,
                    grid,
                    subnet: `10.${state.activeFloor}.${Math.floor(Math.random()*250)}`,
                    devicesCount: 0,
                    types: [],
                    cssClass: dept === '生產部' ? 'dept-prod' : (dept === '倉儲部' ? 'dept-storage' : (dept === 'IT運維部' ? 'dept-maint' : ''))
                });
            }
            
            const floorNameInput = document.getElementById('modal-floor-name-input');
            if (floorNameInput && FLOOR_SCHEME[state.activeFloor]) {
                FLOOR_SCHEME[state.activeFloor].name = floorNameInput.value.trim();
            }
            
            FLOOR_SCHEME[state.activeFloor].rooms = newRooms;
            
            try {
                const response = await fetch('http://localhost:3000/api/floor_scheme', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(FLOOR_SCHEME)
                });
                
                if (response.ok) {
                    logConsole(`已成功儲存 ${state.activeFloor}F 的部門與空間設定。`, 'cyan-log');
                    sfx.playSuccess();
                    modal.style.display = 'none';
                    // Re-render floor plan and tabs immediately
                    renderFloorTabs();
                    renderFloor(state.activeFloor);
                    // Sync backend devices immediately
                    syncTicketsAndIncidents();
                } else {
                    throw new Error();
                }
            } catch (e) {
                alert("儲存設定失敗，請確認與後端連線正常。");
            }
        });
    }
}

// Render floor tabs dynamically based on FLOOR_SCHEME keys
function renderFloorTabs() {
    const tabsContainer = document.getElementById('floor-tabs');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';
    
    // Sort floors descending (e.g. 3, 2, 1)
    const floors = Object.keys(FLOOR_SCHEME).sort((a, b) => b - a);
    
    // Ensure active floor still exists, otherwise set to the first available floor
    if (floors.length > 0 && !floors.includes(state.activeFloor.toString())) {
        state.activeFloor = parseInt(floors[0]);
    }
    
    floors.forEach((fNum) => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${parseInt(fNum) === state.activeFloor ? 'active' : ''}`;
        btn.dataset.floor = fNum;
        btn.innerText = `${fNum}F ${FLOOR_SCHEME[fNum].name || ''}`;
        
        btn.addEventListener('click', (e) => {
            const floor = parseInt(e.currentTarget.getAttribute('data-floor'));
            switchFloorView(floor);
        });
        
        tabsContainer.appendChild(btn);
    });
}

// Setup floor options management listeners
function setupFloorMgmtListeners() {
    const btnOpen = document.getElementById('btn-open-floor-mgmt');
    const btnClose = document.getElementById('btn-close-floor-mgmt');
    const btnCancel = document.getElementById('btn-cancel-floor-save');
    const btnSave = document.getElementById('btn-save-floor-changes');
    const btnAdd = document.getElementById('btn-add-new-floor');
    const modal = document.getElementById('floor-mgmt-modal');

    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            renderModalFloorsList();
            modal.style.display = 'flex';
        });
    }

    if (btnClose) btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
    if (btnCancel) btnCancel.addEventListener('click', () => { modal.style.display = 'none'; });

    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const listEl = document.getElementById('modal-floors-list');
            const floors = Array.from(listEl.children).map(row => parseInt(row.querySelector('.floor-key-input').value)).filter(v => !isNaN(v));
            const nextFloor = floors.length > 0 ? Math.max(...floors) + 1 : 1;
            
            const row = document.createElement('div');
            row.className = 'modal-room-row';
            row.style.cssText = 'grid-template-columns: 80px 3fr 70px;';
            row.innerHTML = `
                <div>
                    <label>樓層號碼</label>
                    <input type="number" class="floor-key-input select-input" value="${nextFloor}" style="text-align: center;">
                </div>
                <div>
                    <label>樓層顯示名稱</label>
                    <input type="text" class="floor-name-input select-input" value="新樓層配置">
                </div>
                <button class="btn" onclick="this.parentElement.remove()" style="margin-top: 16px;">刪除</button>
            `;
            listEl.appendChild(row);
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const listEl = document.getElementById('modal-floors-list');
            const newScheme = {};
            
            for (const row of listEl.children) {
                const floorKey = row.querySelector('.floor-key-input').value.trim();
                const floorName = row.querySelector('.floor-name-input').value.trim();
                
                if (!floorKey || !floorName) {
                    alert("所有樓層欄位皆為必填！");
                    return;
                }
                
                if (newScheme[floorKey]) {
                    alert(`重複的樓層號碼: ${floorKey}F！`);
                    return;
                }
                
                if (FLOOR_SCHEME[floorKey]) {
                    newScheme[floorKey] = {
                        ...FLOOR_SCHEME[floorKey],
                        name: floorName
                    };
                } else {
                    newScheme[floorKey] = {
                        name: floorName,
                        rooms: []
                    };
                }
            }
            
            FLOOR_SCHEME = newScheme;
            
            try {
                const response = await fetch('http://localhost:3000/api/floor_scheme', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(FLOOR_SCHEME)
                });
                
                if (response.ok) {
                    logConsole("已成功儲存樓層選項設定。", 'cyan-log');
                    sfx.playSuccess();
                    modal.style.display = 'none';
                    // Re-render floor plan and tabs immediately
                    renderFloorTabs();
                    renderFloor(state.activeFloor);
                    // Sync backend devices immediately
                    syncTicketsAndIncidents();
                } else {
                    throw new Error();
                }
            } catch (e) {
                alert("儲存樓層設定失敗，請確認與後端連線正常。");
            }
        });
    }
}

// Render dynamic floor items inside modal
function renderModalFloorsList() {
    const listEl = document.getElementById('modal-floors-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    const floors = Object.keys(FLOOR_SCHEME).sort((a, b) => b - a);
    floors.forEach(floorNum => {
        const floorConfig = FLOOR_SCHEME[floorNum];
        const row = document.createElement('div');
        row.className = 'modal-room-row';
        row.style.cssText = 'grid-template-columns: 80px 3fr 70px;';
        row.innerHTML = `
            <div>
                <label>樓層號碼</label>
                <input type="number" class="floor-key-input select-input" value="${floorNum}" style="text-align: center;">
            </div>
            <div>
                <label>樓層顯示名稱</label>
                <input type="text" class="floor-name-input select-input" value="${floorConfig.name || ''}">
            </div>
            <button class="btn" onclick="this.parentElement.remove()" style="margin-top: 16px;">刪除</button>
        `;
        listEl.appendChild(row);
    });
}

// Unassign Device Location
async function unassignDeviceLocation(mac) {
    if (!confirm("確定要將此設備從目前的樓層與部門解除分配嗎？\n解除後它將回到待分配列表中。")) return;
    
    try {
        const response = await fetch('http://localhost:3000/api/devices/unassign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mac })
        });
        
        if (response.ok) {
            logConsole(`設備 ${mac} 已成功解除分配。`, 'cyan-log');
            sfx.playSuccess();
            // Hide HUD
            document.getElementById('device-hud-overlay').classList.remove('active');
            // Refresh instantly
            syncTicketsAndIncidents();
        } else {
            throw new Error();
        }
    } catch (e) {
        alert("解除分配失敗，請確認與後端連線正常。");
    }
}
window.unassignDeviceLocation = unassignDeviceLocation;

// Render dynamic room items inside modal body
function renderModalRoomsList() {
    const listEl = document.getElementById('modal-rooms-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    const rooms = FLOOR_SCHEME[state.activeFloor]?.rooms || [];
    
    rooms.forEach(room => {
        const row = document.createElement('div');
        row.className = 'modal-room-row';
        row.dataset.id = room.id;
        row.innerHTML = `
            <div>
                <label>區域/房間名稱</label>
                <input type="text" class="room-name-input select-input" value="${room.name}">
            </div>
            <div>
                <label>所屬部門標籤</label>
                <input type="text" class="room-dept-input select-input" value="${room.dept}">
            </div>
            <div>
                <label>網格配置 (CSS Grid)</label>
                <input type="text" class="room-grid-input select-input" value="${room.grid}">
            </div>
            <button class="btn" onclick="this.parentElement.remove()">刪除</button>
        `;
        listEl.appendChild(row);
    });
}

function switchFloorView(floorNum) {
    if (state.activeFloor === floorNum) return;
    state.activeFloor = floorNum;
    logConsole(`切換監控視角至 ${floorNum}F。`, 'system-log');
    
    document.querySelectorAll('.tab-btn').forEach(b => {
        if (parseInt(b.getAttribute('data-floor')) === floorNum) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    renderFloor(floorNum);
    updateAdminDOMPosition();
}

function renderFloor(floorNum) {
    const floorPlan = document.getElementById('floor-plan');
    if (!floorPlan) return;
    floorPlan.innerHTML = '';
    
    if (floorNum === 1) {
        floorPlan.style.gridTemplateColumns = 'repeat(4, 1fr)';
        floorPlan.style.gridTemplateRows = 'repeat(3, 1fr)';
    } else {
        floorPlan.style.gridTemplateColumns = 'repeat(6, 1fr)';
        floorPlan.style.gridTemplateRows = 'repeat(6, 1fr)';
    }

    const floorConfig = FLOOR_SCHEME[floorNum];
    if (!floorConfig) return;

    floorConfig.rooms.forEach(room => {
        if (state.selectedDeptFilter !== 'all' && room.dept !== state.selectedDeptFilter) {
            return;
        }

        const roomDiv = document.createElement('div');
        roomDiv.className = `room-node ${room.cssClass || ''}`;
        roomDiv.id = `room-${room.id}`;
        if (room.grid) roomDiv.style.cssText = room.grid;

        const header = document.createElement('div');
        header.className = 'room-header';
        header.innerHTML = `
            <span class="room-title">${room.name}</span>
            <span class="room-dept">${room.dept}</span>
        `;
        roomDiv.appendChild(header);

        const devContainer = document.createElement('div');
        devContainer.className = 'device-container';

        const roomDeviceKey = `${floorNum}_${room.id}`;
        if (!state.rooms[roomDeviceKey]) {
            state.rooms[roomDeviceKey] = { id: room.id, name: room.name, dept: room.dept, devices: [] };
        }

        state.rooms[roomDeviceKey].devices.forEach(dev => {
            const devNode = document.createElement('div');
            devNode.className = `device-node status-${dev.status}`;
            devNode.id = `dev-node-${dev.id}`;
            let svgMarkup = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;
            if (dev.type === 'SRV') {
                svgMarkup = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>`;
            } else if (dev.type === 'NB') {
                svgMarkup = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2" ry="2"></rect><path d="M2 20h20l-2-4H4l-2 4z"></path></svg>`;
            } else if (dev.type === 'AP') {
                svgMarkup = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4"></path><line x1="12" y1="8" x2="12" y2="4"></line></svg>`;
            } else if (dev.type === 'PRN') {
                svgMarkup = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>`;
            }
            devNode.innerHTML = svgMarkup;

            if (state.showIPLabels) {
                const ipLabel = document.createElement('span');
                ipLabel.className = 'device-label-text';
                ipLabel.innerText = dev.ip;
                devNode.appendChild(ipLabel);
            } else if (state.showMACLabels) {
                const macLabel = document.createElement('span');
                macLabel.className = 'device-label-text';
                macLabel.innerText = dev.mac;
                devNode.appendChild(macLabel);
            }

            devNode.addEventListener('click', (e) => {
                e.stopPropagation();
                showDeviceHUD(dev);
                if (dev.status === 'incident' && !state.autoPilot) {
                    const ticket = state.tickets.find(t => t.deviceId === dev.id);
                    if (ticket) dispatchITAdmin(ticket.id);
                }
            });
            devContainer.appendChild(devNode);
        });
        roomDiv.appendChild(devContainer);
        floorPlan.appendChild(roomDiv);
    });
    updateRoomAlertBorders();
}

function updateRoomAlertBorders() {
    const floorConfig = FLOOR_SCHEME[state.activeFloor];
    if(!floorConfig) return;
    floorConfig.rooms.forEach(room => {
        const roomDiv = document.getElementById(`room-${room.id}`);
        if (!roomDiv) return;
        const roomDevices = state.rooms[`${state.activeFloor}_${room.id}`]?.devices || [];
        const hasIncident = roomDevices.some(d => d.status === 'incident');
        if (hasIncident) {
            roomDiv.style.borderColor = 'var(--color-red)';
            roomDiv.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.2)';
        } else {
            if(room.cssClass === 'dept-prod') {
                roomDiv.style.borderColor = '#10b981';
            } else if (room.cssClass === 'dept-storage') {
                roomDiv.style.borderColor = '#f59e0b';
            } else if (room.cssClass === 'dept-maint') {
                roomDiv.style.borderColor = '#3b82f6';
            } else {
                roomDiv.style.borderColor = 'var(--border-color)';
            }
            roomDiv.style.boxShadow = 'none';
        }
    });
}

function showDeviceHUD(dev) {
    state.selectedDevice = dev;
    const hud = document.getElementById('device-hud-overlay');
    if (!hud) return;
    document.getElementById('hud-dev-name').innerText = dev.name;
    document.getElementById('hud-dev-type').innerText = dev.typeLabel;
    document.getElementById('hud-dev-ip').innerText = dev.ip;
    document.getElementById('hud-dev-mac').innerText = dev.mac;
    
    const statusEl = document.getElementById('hud-dev-status');
    if (dev.status === 'incident') {
        statusEl.innerText = "異常告警";
        statusEl.style.color = "var(--color-red)";
    } else {
        statusEl.innerText = "連線正常";
        statusEl.style.color = "var(--color-green)";
    }
    
    const unassignRow = document.getElementById('hud-unassign-row');
    if (unassignRow) {
        if (dev.isReal) {
            unassignRow.style.display = 'flex';
            const btn = document.getElementById('btn-unassign-device');
            if (btn) {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    unassignDeviceLocation(dev.mac);
                };
            }
            const btnRemote = document.getElementById('btn-open-remote-ops');
            if (btnRemote) {
                btnRemote.onclick = (e) => {
                    e.stopPropagation();
                    openRemoteOpsModal(dev);
                };
            }
        } else {
            unassignRow.style.display = 'none';
        }
    }
    
    hud.classList.add('active');
    if (hud.timerId) clearTimeout(hud.timerId);
    hud.timerId = setTimeout(() => { hud.classList.remove('active'); }, dev.isReal ? 12000 : 6000);
}

function resetAdminToHome() {
    const admin = state.admin;
    admin.status = 'idle';
    admin.floor = 3;
    admin.targetDevice = null;
    admin.currentTicket = null;
    const adminEl = document.getElementById('it-admin');
    if(adminEl) adminEl.style.display = state.activeFloor === 3 ? 'block' : 'none';
    
    const serverRoom = document.getElementById('room-3_server');
    if (serverRoom) {
        const container = document.getElementById('map-container');
        const mapRect = container.getBoundingClientRect();
        const rect = serverRoom.getBoundingClientRect();
        admin.x = rect.left - mapRect.left + 40;
        admin.y = rect.top - mapRect.top + 40;
        admin.targetX = admin.x;
        admin.targetY = admin.y;
    }
    updateAdminDOMPosition();
    updateAdminStatusUI();
}

function updateDeviceTotalCount() {
    const assignedCount = Object.keys(state.devices).length;
    const unassignedCount = (document.querySelectorAll('#unassigned-list .unassigned-card') || []).length;
    const total = assignedCount + unassignedCount;
    const dt = document.getElementById('device-total-value');
    if(dt) dt.innerText = `${total} 台`;
    
    // Update online rate dynamically
    const onlineCount = Object.values(state.devices).filter(d => d.status === 'online').length;
    const rateVal = total > 0 ? ((onlineCount / total) * 100).toFixed(1) + '%' : '100.0%';
    const netStatus = document.getElementById('net-status');
    if(netStatus) netStatus.innerText = rateVal;
}

function triggerRandomIncident() {
    const allDevs = Object.values(state.devices).filter(d => d.status === 'online');
    if (allDevs.length === 0) {
        logConsole("[測試] 目前線上尚無已分配位置的實體 App 設備可進行測試。", 'warning-log');
        return;
    }
    
    const targetDev = allDevs[Math.floor(Math.random() * allDevs.length)];
    const schemeKeys = Object.keys(INCIDENT_SCHEMES);
    const scheme = INCIDENT_SCHEMES[schemeKeys[Math.floor(Math.random() * schemeKeys.length)]];
    
    const ticketId = `TKT-${Math.floor(Math.random()*10000).toString().padStart(4, '0')}`;
    const newTicket = {
        id: ticketId,
        deviceId: targetDev.id,
        deviceName: targetDev.name,
        floor: targetDev.floor,
        roomId: targetDev.roomId,
        name: scheme.name,
        desc: scheme.desc,
        severity: scheme.severity,
        fixTime: scheme.fixTime,
        timestamp: new Date()
    };
    
    state.tickets.push(newTicket);
    targetDev.status = 'incident';
    
    logConsole(`[告警] ${newTicket.floor}F 設備 ${targetDev.ip} 發生異常: ${newTicket.name}`, 'error-log');
    sfx.playAlert();
    
    if (state.activeFloor === targetDev.floor) {
        const devNode = document.getElementById(`dev-node-${targetDev.id}`);
        if (devNode) devNode.className = `device-node status-incident`;
        updateRoomAlertBorders();
    }
    
    updateTicketUI();
    
    if (state.autoPilot && state.admin.status === 'idle') {
        dispatchNextTicket();
    }
}

function dispatchNextTicket() {
    if (state.tickets.length === 0 || state.admin.status !== 'idle') return;
    const ticket = state.tickets[0];
    dispatchITAdmin(ticket.id);
}

function dispatchITAdmin(ticketId) {
    if (state.admin.status !== 'idle') {
        logConsole("[警告] Lyon 正在處理其他事件。", 'warning-log');
        return;
    }
    const ticket = state.tickets.find(t => t.id === ticketId);
    if (!ticket) return;
    
    state.admin.currentTicket = ticket;
    const targetDev = state.devices[ticket.deviceId];
    
    const container = document.getElementById('map-container');
    const mapRect = container.getBoundingClientRect();
    
    if (state.admin.floor !== ticket.floor) {
        const elevatorNode = document.getElementById('elevator-node');
        const lobbyRect = elevatorNode.getBoundingClientRect();
        state.admin.status = 'moving';
        state.admin.targetX = lobbyRect.left - mapRect.left - 15;
        state.admin.targetY = lobbyRect.top - mapRect.top + (lobbyRect.height / 2);
        state.admin.nextAction = 'enter_elevator';
        state.admin.targetDevice = targetDev;
        logConsole(`[調派] 派遣 Lyon 前往 ${ticket.floor}F 電梯...`);
    } else {
        state.admin.status = 'moving';
        setAdminTargetToDevice(targetDev);
        logConsole(`[調派] Lyon 正前往處理 ${ticket.id}`);
    }
    updateAdminStatusUI();
}

function setAdminTargetToDevice(targetDeviceNode) {
    const admin = state.admin;
    const container = document.getElementById('map-container');
    const mapRect = container.getBoundingClientRect();
    if (targetDeviceNode) {
        const devDom = document.getElementById(`dev-node-${targetDeviceNode.id}`);
        if (devDom && targetDeviceNode.floor === state.activeFloor) {
            const rect = devDom.getBoundingClientRect();
            admin.targetX = rect.left - mapRect.left + rect.width / 2;
            admin.targetY = rect.top - mapRect.top + rect.height / 2;
        } else {
            const roomDom = document.getElementById(`room-${targetDeviceNode.roomId}`);
            if(roomDom) {
                const rect = roomDom.getBoundingClientRect();
                admin.targetX = rect.left - mapRect.left + rect.width / 2;
                admin.targetY = rect.top - mapRect.top + rect.height / 2;
            }
        }
        admin.targetDevice = targetDeviceNode;
    }
    updateAdminDOMPosition();
}

function enterElevatorSequence() {
    const admin = state.admin;
    const cabin = document.querySelector('.elevator-cabin');
    sfx.playElevator();
    admin.status = 'elevator';
    admin.nextAction = null;
    const adminEl = document.getElementById('it-admin');
    if(adminEl) adminEl.style.display = 'none';
    
    setTimeout(() => {
        admin.floor = admin.currentTicket.floor;
        logConsole(`[電梯] Lyon 已抵達 ${admin.floor}F`);
        
        if (state.activeFloor !== admin.floor) {
            switchFloorView(admin.floor);
        }
        
        if(adminEl) adminEl.style.display = 'block';
        admin.status = 'moving';
        setAdminTargetToDevice(admin.targetDevice);
        updateAdminStatusUI();
    }, 2500);
}

function updateTicketUI() {
    const list = document.getElementById('ticket-list');
    const count = document.getElementById('ticket-queue-count');
    const alertCount = document.getElementById('alert-count-val');
    
    if(count) count.innerText = state.tickets.length;
    if(alertCount) {
        alertCount.innerText = `${state.tickets.length} 筆`;
        if(state.tickets.length > 0) alertCount.classList.add('text-red');
        else alertCount.classList.remove('text-red');
    }
    
    if (!list) return;

    if (state.tickets.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" class="text-green">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <p>目前無未處理警報，網絡運作正常</p>
            </div>
        `;
        return;
    }
    
    list.innerHTML = '';
    state.tickets.forEach(t => {
        const card = document.createElement('div');
        card.className = `ticket-card priority-${t.severity}`;
        card.innerHTML = `
            <div class="ticket-title-row">
                <span class="ticket-title">${t.name}</span>
                <span class="ticket-badge badge-${t.severity}">${t.severity.toUpperCase()}</span>
            </div>
            <p class="ticket-desc">${t.desc}</p>
            <div class="ticket-footer">
                <span class="ticket-location">${t.floor}F / ${t.deviceName}</span>
                ${(state.admin.status === 'idle') ? `<button class="btn-dispatch" onclick="dispatchITAdmin('${t.id}')">指派 Lyon</button>` : `<span style="font-size: 0.6rem; color: #6b7280;">等待中...</span>`}
            </div>
        `;
        list.appendChild(card);
    });
}

function updateAdminStatusUI() {
    const bubble = document.getElementById('admin-status-bubble');
    const statusLbl = document.getElementById('eng-status-lbl');
    if (!bubble || !statusLbl) return;

    if (state.admin.status === 'idle') {
        bubble.innerText = 'Lyon: 待命中';
        statusLbl.innerText = '狀態：待命 (Idle)';
        document.getElementById('eng-progress').style.width = '0%';
    } else if (state.admin.status === 'moving') {
        bubble.innerText = `Lyon: 派往設備`;
        statusLbl.innerText = `狀態：前往維修`;
    } else if (state.admin.status === 'elevator') {
        bubble.innerText = 'Lyon: 搭乘電梯...';
        statusLbl.innerText = `狀態：搭電梯前往 ${state.admin.currentTicket.floor} 樓`;
    } else if (state.admin.status === 'fixing') {
        bubble.innerText = 'Lyon: 排解故障中';
        statusLbl.innerText = '狀態：正在維修設備';
    }
}

function updateAdminDOMPosition() {
    const adminEl = document.getElementById('it-admin');
    if (!adminEl) return;
    if (state.admin.floor === state.activeFloor && state.admin.status !== 'elevator') {
        adminEl.style.display = 'block';
        adminEl.style.left = `${state.admin.x}px`;
        adminEl.style.top = `${state.admin.y}px`;
    } else {
        adminEl.style.display = 'none';
    }
}

function gameLoop() {
    const admin = state.admin;
    const adminEl = document.getElementById('it-admin');
    
    if (admin.status === 'moving') {
        const dx = admin.targetX - admin.x;
        const dy = admin.targetY - admin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < admin.speed) {
            admin.x = admin.targetX;
            admin.y = admin.targetY;
            
            if (admin.nextAction === 'enter_elevator') {
                enterElevatorSequence();
            } else if (admin.targetDevice && admin.currentTicket) {
                admin.status = 'fixing';
                updateAdminStatusUI();
                logConsole(`[維修] Lyon 開始排解 ${admin.targetDevice.name} 故障...`);
            }
        } else {
            admin.x += (dx / dist) * admin.speed;
            admin.y += (dy / dist) * admin.speed;
        }
        updateAdminDOMPosition();
    } else if (admin.status === 'fixing') {
        admin.fixProgress += 30; 
        const progressEl = document.getElementById('eng-progress');
        if(progressEl) progressEl.style.width = `${Math.min(100, (admin.fixProgress / admin.currentTicket.fixTime) * 100)}%`;
        
        if (admin.fixProgress >= admin.currentTicket.fixTime) {
            logConsole(`[修復] ${admin.targetDevice.name} 異常排除。`, 'cyan-log');
            sfx.playSuccess();
            admin.targetDevice.status = 'online';
            
            if (state.activeFloor === admin.targetDevice.floor) {
                const devNode = document.getElementById(`dev-node-${admin.targetDevice.id}`);
                if (devNode) devNode.className = `device-node status-online`;
                updateRoomAlertBorders();
            }
            
            const tId = admin.currentTicket.id;
            state.tickets = state.tickets.filter(t => t.id !== tId);
            updateTicketUI();
            if (state.serverOnline) {
                resolveTicketOnServer(tId);
            }
            
            admin.status = 'idle';
            admin.fixProgress = 0;
            admin.currentTicket = null;
            admin.targetDevice = null;
            updateAdminStatusUI();
            
            if (state.autoPilot) {
                setTimeout(dispatchNextTicket, 800);
            }
        }
    }
    requestAnimationFrame(gameLoop);
}

// === 已修正的連動功能區 ===

async function updateTelemetry() {
    try {
        const response = await fetch('http://localhost:3000/api/dell-temp');
        if (!response.ok) throw new Error("API error");
        const data = await response.json();
        state.telemetry.serverTemp = data.temp;
        state.serverOnline = true;
    } catch (e) {
        state.telemetry.serverTemp += (Math.random() - 0.5) * 1.5;
        state.serverOnline = false;
    }

    // 溫度 UI 更新
    const tempBar = document.getElementById('temp-bar');
    const tempVal = document.getElementById('temp-val');
    const pct = Math.min(100, Math.max(0, (state.telemetry.serverTemp / 100) * 100));
    
    if(tempBar) tempBar.style.height = `${pct}%`;
    if(tempVal) tempVal.innerText = `${state.telemetry.serverTemp.toFixed(1)}°C`;
    
    // 流量圖表
    state.telemetry.trafficHistory.shift();
    state.telemetry.trafficHistory.push(Math.floor(Math.random() * 60) + 20);
    const history = state.telemetry.trafficHistory;
    const maxVal = 100;
    const width = 300;
    const height = 80;
    const step = width / (history.length - 1);
    
    let pathD = `M 0 ${height - (history[0] / maxVal) * height}`;
    for (let i = 1; i < history.length; i++) {
        pathD += ` L ${i * step} ${height - (history[i] / maxVal) * height}`;
    }
    
    const chartLine = document.querySelector('.chart-line');
    const chartArea = document.querySelector('.chart-area');
    if(chartLine) chartLine.setAttribute('d', pathD);
    if(chartArea) chartArea.setAttribute('d', `${pathD} L ${width} ${height} L 0 ${height} Z`);
}

async function detectLocalNetwork() {
    const ipEl = document.getElementById('local-public-ip');
    const ispEl = document.getElementById('local-isp');
    
    if(ipEl) ipEl.innerText = "查詢中...";
    if(ispEl) ispEl.innerText = "查詢中...";
    
    try {
        const response = await fetch('http://localhost:3000/api/network-info');
        const data = await response.json();
        
        if(ipEl) ipEl.innerText = data.ip;
        if(ispEl) ispEl.innerText = data.isp;
        
        state.serverOnline = true;
        logConsole(`[網路] 系統已驗證 IP 歸屬: ${data.isp}`, 'cyan-log');
    } catch (e) {
        logConsole(`[網路] 無法連結識別服務，改用備用顯示`, 'warning-log');
        state.serverOnline = false;
        if(ipEl) ipEl.innerText = "61.248.131.141";
        if(ispEl) ispEl.innerText = "中華電信 (固定 IP)";
    }
    
    speedTest();
}

async function speedTest() {
    const speedEl = document.getElementById('local-speed');
    const uploadEl = document.getElementById('local-upload-speed');
    const pingEl = document.getElementById('local-ping');
    const statusEl = document.getElementById('local-speed-status');
    
    if(speedEl) speedEl.innerText = "測速中...";
    if(statusEl) statusEl.style.display = 'none';
    
    try {
        let dlSpeedMbps = 0;
        let rttMs = 15;

        if (state.serverOnline) {
            // Trigger backend speedtest
            const response = await fetch('http://localhost:3000/api/speedtest/run', { method: 'POST' });
            const data = await response.json();
            dlSpeedMbps = data.downloadMbps;
            rttMs = data.pingMs;
            
            if(speedEl) speedEl.innerText = `${dlSpeedMbps} Mbps`;
            if(uploadEl) uploadEl.innerText = `${data.uploadMbps} Mbps`;
            if(pingEl) pingEl.innerText = `${rttMs} ms`;
        } else {
            // Offline fallback
            const dlSize = 5 * 1024 * 1024;
            const dlUrl = "https://speed.cloudflare.com/__down?bytes=" + dlSize;
            
            const dlStart = performance.now();
            const response = await fetch(dlUrl + "&nocache=" + Math.random());
            if (!response.ok) throw new Error("Download test failed");
            
            const reader = response.body.getReader();
            while (true) {
                const { done } = await reader.read();
                if (done) break;
            }
            const dlEnd = performance.now();
            const dlDuration = (dlEnd - dlStart) / 1000;
            dlSpeedMbps = parseFloat(((dlSize * 8) / (dlDuration * 1000000)).toFixed(1));
            rttMs = Math.floor(Math.random() * 20 + 10);
            
            if(speedEl) speedEl.innerText = `${dlSpeedMbps} Mbps`;
            if(uploadEl) uploadEl.innerText = `${(dlSpeedMbps * 0.4).toFixed(1)} Mbps`;
            if(pingEl) pingEl.innerText = `${rttMs} ms`;
        }
        
        evaluateSpeedStatus(dlSpeedMbps, rttMs);
    } catch (e) {
        const fallbackSpeed = (Math.random() * 8 + 2).toFixed(1);
        if(speedEl) speedEl.innerText = `${fallbackSpeed} Mbps`;
        if(uploadEl) uploadEl.innerText = `${(fallbackSpeed * 0.4).toFixed(1)} Mbps`;
        if(pingEl) pingEl.innerText = `113 ms`;
        evaluateSpeedStatus(parseFloat(fallbackSpeed), 113);
        logConsole(`[網路] 測速失敗，使用預估數值。`, 'warning-log');
    }
}

function evaluateSpeedStatus(speedMbps, rttMs) {
    const statusEl = document.getElementById('local-speed-status');
    if (!statusEl) return;
    statusEl.style.display = 'inline-block';
    
    const isNormal = speedMbps >= 15 && rttMs <= 80;
    if (isNormal) {
        statusEl.innerText = "正常";
        statusEl.style.backgroundColor = "rgba(16, 185, 129, 0.12)";
        statusEl.style.color = "var(--color-green)";
        statusEl.style.border = "1px solid rgba(16, 185, 129, 0.25)";
    } else {
        statusEl.innerText = "異常";
        statusEl.style.backgroundColor = "rgba(239, 68, 68, 0.12)";
        statusEl.style.color = "var(--color-red)";
        statusEl.style.border = "1px solid rgba(239, 68, 68, 0.25)";
    }
}

// === NEW BACKEND SYNC AND POLLING FUNCTIONALITY ===

// Dynamic Device Rebuild & Re-rendering
function processBackendDevices(backendDevices) {
    // 1. Keep track of unassigned real devices
    const unassigned = [];
    
    // 2. Clear dynamic devices in all state.rooms to rebuild
    Object.keys(state.rooms).forEach(key => {
        state.rooms[key].devices = [];
    });
    state.devices = {};

    // 3. Ensure room buckets exist for all floors & rooms
    Object.keys(FLOOR_SCHEME).forEach(floorNum => {
        const floorConfig = FLOOR_SCHEME[floorNum];
        floorConfig.rooms.forEach(room => {
            const roomDeviceKey = `${floorNum}_${room.id}`;
            if (!state.rooms[roomDeviceKey]) {
                state.rooms[roomDeviceKey] = { id: room.id, name: room.name, dept: room.dept, devices: [] };
            }
        });
    });

    // 4. Process real devices reported from device_agent App
    Object.keys(backendDevices).forEach(mac => {
        const dev = backendDevices[mac];
        
        // Real probe device reported from device_agent
        const realDev = {
            id: dev.mac ? dev.mac.replace(/:/g, '-') : (dev.id || dev.name),
            roomId: dev.roomId,
            floor: dev.floor ? parseInt(dev.floor) : null,
            type: dev.type || 'PC',
            typeLabel: dev.typeLabel || '電腦 (App端點)',
            name: dev.name || dev.hostname || dev.ip,
            ip: dev.ip,
            mac: dev.mac,
            status: dev.status || 'online',
            isReal: true,
            audit: dev.audit || null
        };
        
        if (realDev.floor && realDev.roomId) {
            // Assigned! Put into appropriate room list
            const roomKey = `${realDev.floor}_${realDev.roomId}`;
            if (state.rooms[roomKey]) {
                state.rooms[roomKey].devices.push(realDev);
                state.devices[realDev.id] = realDev;
            } else {
                unassigned.push(realDev);
            }
        } else {
            // Unassigned! Put into unassigned list
            unassigned.push(realDev);
        }
    });

    // 5. Render currently active floor map (reactive update!)
    renderFloor(state.activeFloor);
    
    // 6. Update search highlights if a search query exists
    const searchVal = document.getElementById('search-input')?.value || "";
    if (searchVal) {
        handleSearch(searchVal);
    }

    // 7. Render unassigned list (skip if user is currently interacting with the dropdowns)
    const activeEl = document.activeElement;
    const isInteracting = activeEl && activeEl.id && activeEl.id.startsWith('assign-select-');
    if (!isInteracting) {
        renderUnassignedList(unassigned);
    }

    updateDeviceTotalCount();
}

// Render Unassigned Devices List in Sidebar
function renderUnassignedList(unassigned) {
    const listEl = document.getElementById('unassigned-list');
    const countEl = document.getElementById('unassigned-count');
    if (!listEl) return;
    
    if (countEl) countEl.innerText = unassigned.length;
    
    if (unassigned.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state" style="padding: 15px; text-align: center; color: var(--text-muted); font-size: 0.8rem; border: 1px dashed var(--border-color); border-radius: 4px;">
                目前所有真實設備皆已分配完畢
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = '';
    
    // Compile options for room select
    let optionsHtml = '<option value="">-- 選擇目的地區域 --</option>';
    Object.keys(FLOOR_SCHEME).forEach(fNum => {
        FLOOR_SCHEME[fNum].rooms.forEach(room => {
            optionsHtml += `<option value="${fNum}_${room.id}">${fNum}F - ${room.name} (${room.dept})</option>`;
        });
    });
    
    unassigned.forEach(dev => {
        const card = document.createElement('div');
        card.className = 'unassigned-card';
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'OPTION') {
                showDeviceHUD(dev);
            }
        });
        card.innerHTML = `
            <div style="font-weight: bold; color: var(--text-primary); margin-bottom: 2px;">💻 ${dev.name}</div>
            <div style="color: var(--text-muted); font-size: 0.7rem; font-family: monospace;">IP: ${dev.ip}</div>
            <div style="color: var(--text-muted); font-size: 0.7rem; font-family: monospace; margin-bottom: 6px;">MAC: ${dev.mac}</div>
            <div style="display: flex; gap: 4px; align-items: center;">
                <select id="assign-select-${dev.mac.replace(/:/g, '-')}" class="select-input" style="flex: 1; font-size: 0.7rem; padding: 4px; height: 26px;">
                    ${optionsHtml}
                </select>
                <button class="btn btn-secondary" onclick="assignDeviceLocation('${dev.mac}')" style="padding: 4px 10px; font-size: 0.7rem; height: 26px; line-height: 18px; background: var(--color-green); border-color: var(--color-green); color: white;">分配</button>
            </div>
        `;
        listEl.appendChild(card);
    });
}

// Assign Device Location Endpoint caller
async function assignDeviceLocation(mac) {
    const safeMac = mac.replace(/:/g, '-');
    const selectEl = document.getElementById(`assign-select-${safeMac}`);
    if (!selectEl) return;
    
    const value = selectEl.value;
    if (!value) {
        alert("請先選擇要分配的樓層與部門區域！");
        return;
    }
    
    const parts = value.split('_');
    const floor = parseInt(parts[0]);
    const roomId = parts.slice(1).join('_');
    
    try {
        const response = await fetch('http://localhost:3000/api/devices/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mac, floor, roomId })
        });
        
        if (response.ok) {
            logConsole(`設備 ${mac} 已成功分配至 ${floor}F - ${roomId}。`, 'cyan-log');
            sfx.playSuccess();
            // Refresh instantly
            syncTicketsAndIncidents();
        } else {
            throw new Error();
        }
    } catch (e) {
        alert("分配設備位置失敗，請確認與後端連線正常。");
    }
}

// Expose assign function globally so onclick can call it
window.assignDeviceLocation = assignDeviceLocation;

// Search filter highlighting logic
function handleSearch(query) {
    const q = query.trim().toLowerCase();
    const nodes = document.querySelectorAll('.device-node');
    
    if (!q) {
        nodes.forEach(n => {
            n.classList.remove('search-highlight');
            n.style.opacity = '1';
            n.style.transform = 'none';
        });
        return;
    }
    
    nodes.forEach(node => {
        const devId = node.id.replace('dev-node-', '');
        const dev = state.devices[devId];
        
        if (!dev) return;
        
        const nameMatch = dev.name.toLowerCase().includes(q);
        const ipMatch = dev.ip.toLowerCase().includes(q);
        const macMatch = dev.mac.toLowerCase().includes(q);
        const typeMatch = dev.typeLabel.toLowerCase().includes(q);
        
        // Find room details to search by department name or room name
        const roomKey = `${dev.floor}_${dev.roomId}`;
        const room = state.rooms[roomKey];
        const roomMatch = room ? (room.name.toLowerCase().includes(q) || room.dept.toLowerCase().includes(q)) : false;
        
        if (nameMatch || ipMatch || macMatch || typeMatch || roomMatch) {
            node.classList.add('search-highlight');
            node.style.opacity = '1';
        } else {
            node.classList.remove('search-highlight');
            node.style.opacity = '0.15';
            node.style.transform = 'none';
        }
    });
}

let lastCheckedTicketsCount = 0;
async function syncTicketsAndIncidents() {
    try {
        const tResponse = await fetch('http://localhost:3000/api/tickets');
        if (!tResponse.ok) throw new Error();
        const tickets = await tResponse.json();
        
        const dResponse = await fetch('http://localhost:3000/api/devices');
        if (!dResponse.ok) throw new Error();
        const devices = await dResponse.json();

        state.serverOnline = true;

        // Sync devices status and positions
        processBackendDevices(devices);
        
        updateRoomAlertBorders();

        // Sync tickets queue
        const mappedTickets = tickets.map(t => {
            const dev = Object.values(state.devices).find(d => d.id === t.deviceId) || { floor: 1, roomId: '1_mgmt' };
            return {
                id: t.ticketId || t.id,
                deviceId: t.deviceId,
                deviceName: t.deviceName,
                floor: dev.floor,
                roomId: dev.roomId,
                name: t.name,
                desc: t.desc,
                severity: t.severity,
                fixTime: t.severity === 'critical' ? 7000 : (t.severity === 'high' ? 5000 : 3000),
                timestamp: new Date(t.timestamp)
            };
        });

        if (mappedTickets.length > lastCheckedTicketsCount) {
            sfx.playAlert();
        }
        lastCheckedTicketsCount = mappedTickets.length;

        state.tickets = mappedTickets;
        updateTicketUI();

        if (state.autoPilot && state.admin.status === 'idle') {
            dispatchNextTicket();
        }
    } catch (err) {
        state.serverOnline = false;
    }
}

function ticketGeneratorTick() {
    syncTicketsAndIncidents();
}

async function resolveTicketOnServer(ticketId) {
    try {
        await fetch(`http://localhost:3000/api/tickets/${ticketId}/resolve`, { method: 'POST' });
        logConsole(`[後端] 已同步完成工單: ${ticketId}`, 'cyan-log');
    } catch (e) {
        console.warn("[後端] 無法連線同步工單完成狀態");
    }
}

// Monitor card expands
document.querySelectorAll('.monitor-card').forEach(card => {
    card.addEventListener('click', function() {
        this.classList.toggle('expanded');
        if (this.classList.contains('expanded')) {
            logConsole("展開詳細監控數據...");
        }
    });
});

// === NEW REMOTE OPERATION CODE ===

let screenStreamInterval = null;
let currentRemoteTab = "sysinfo";

function openRemoteOpsModal(dev) {
    const modal = document.getElementById('remote-ops-modal');
    if (!modal) return;
    
    document.getElementById('remote-ops-device-title').innerText = `${dev.name} (${dev.ip})`;
    modal.style.display = 'flex';
    
    // Switch to default tab
    switchRemoteTab("sysinfo");
}

function closeRemoteOpsModal() {
    const modal = document.getElementById('remote-ops-modal');
    if (modal) modal.style.display = 'none';
    
    // Stop screen stream if active
    stopScreenStream();
}

function switchRemoteTab(tabName) {
    currentRemoteTab = tabName;
    
    // Manage active state of buttons
    document.querySelectorAll('.remote-tab-btn').forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Manage active content visibility
    document.querySelectorAll('.remote-tab-content').forEach(content => {
        if (content.id === `remote-tab-${tabName}`) {
            content.style.display = (tabName === 'files' || tabName === 'broadcast') ? 'block' : 'flex';
        } else {
            content.style.display = 'none';
        }
    });

    // If switching away from screen, stop stream
    if (tabName !== 'screen') {
        stopScreenStream();
    }
    
    // Load content dynamically
    loadRemoteTabContent(tabName, state.selectedDevice);
}

async function loadRemoteTabContent(tabName, dev) {
    if (!dev) return;
    
    // Toggle local self-monitoring mirror warning
    const warningEl = document.getElementById('screen-mirror-warning');
    if (warningEl) {
        const localPublicIp = document.getElementById('local-public-ip').innerText.trim();
        if (tabName === 'screen' && (dev.ip === '127.0.0.1' || dev.ip === 'localhost' || dev.ip === localPublicIp || dev.ip === '10.1.30.112')) {
            warningEl.style.display = 'block';
        } else {
            warningEl.style.display = 'none';
        }
    }
    
    if (tabName === 'sysinfo') {
        showProgressBar(20);
        // Load System Audit
        const tbody = document.getElementById('remote-software-table-body');
        tbody.innerHTML = `<tr><td colspan="3" style="padding: 20px; text-align: center; color: var(--text-muted);">正在讀取遠端主機系統資產資訊...</td></tr>`;
        
        try {
            showProgressBar(45);
            let data = null;
            try {
                const res = await fetch(`http://localhost:3000/api/agent-proxy/${dev.ip}/audit`);
                if (res.ok) data = await res.json();
            } catch (err) {}
            
            if (!data && dev.audit) {
                data = dev.audit;
            }

            if (!data) throw new Error("No audit data available");
            showProgressBar(75);
            
            // Set gauge values
            document.getElementById('remote-cpu-val').innerText = `${data.cpu_load || 15}%`;
            
            const ramPercent = data.ram ? (data.ram.percent || 45) : 45;
            document.getElementById('remote-ram-val').innerText = `${ramPercent}%`;
            
            if (data.ram && data.ram.total) {
                const totalGb = (data.ram.total / (1024 * 1024 * 1024)).toFixed(1);
                const freeGb = (data.ram.free || (data.ram.total * (1 - ramPercent/100))) / (1024 * 1024 * 1024);
                const usedGb = (totalGb - freeGb).toFixed(1);
                document.getElementById('remote-ram-detail').innerText = `${usedGb} / ${totalGb} GB`;
            } else {
                document.getElementById('remote-ram-detail').innerText = `7.2 / 16.0 GB`;
            }
            
            const diskPercent = data.disk ? (data.disk.percent || 38) : 38;
            const diskHealth = data.disk ? (data.disk.health || "正常 (健全)") : "正常 (健全)";
            document.getElementById('remote-disk-val').innerText = `${diskPercent}%`;
            document.getElementById('remote-disk-health').innerText = `健康度: ${diskHealth}`;
            
            document.getElementById('remote-os-val').innerText = data.os || 'Windows 10 Pro';
            document.getElementById('remote-os-kernel').innerText = data.os_release || '10.0.19044';
            
            // Render software table
            tbody.innerHTML = '';
            const softwareList = Array.isArray(data.software) ? data.software : [];
            document.getElementById('remote-software-count').innerText = softwareList.length;
            
            if (softwareList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="padding: 20px; text-align: center; color: var(--text-muted);">系統未列出特殊第三方資產軟體</td></tr>`;
            } else {
                softwareList.forEach(soft => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #fff; text-align: left;">${soft.name}</td>
                        <td style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: monospace; text-align: left;">${soft.version || '-'}</td>
                        <td style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-muted); text-align: left;">${soft.publisher || '-'}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
            showProgressBar(100);
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="3" style="padding: 20px; text-align: center; color: #ef4444; font-weight: bold;">❌ 連線失敗：無法連絡上該設備的 Agent API 服務。</td></tr>`;
            document.getElementById('remote-cpu-val').innerText = `- %`;
            document.getElementById('remote-ram-val').innerText = `- %`;
            document.getElementById('remote-ram-detail').innerText = `- GB`;
            document.getElementById('remote-disk-val').innerText = `- %`;
            document.getElementById('remote-disk-health').innerText = `健康度: -`;
            document.getElementById('remote-software-count').innerText = '0';
            showProgressBar(100);
        }
    } else if (tabName === 'screen') {
        showProgressBar(40);
        resetScreenCanvas();
        showProgressBar(100);
    } else if (tabName === 'console') {
        showProgressBar(40);
        document.getElementById('remote-console-input').focus();
        showProgressBar(100);
    } else {
        showProgressBar(50);
        showProgressBar(100);
    }
}

// Observer Screen Streaming
function resetScreenCanvas() {
    const canvas = document.getElementById('remote-screen-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 640;
    canvas.height = 360;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('點擊「開始監看」以取得靜默遠端螢幕串流 (觀察者模式)', 320, 180);
}

function startScreenStream() {
    const btn = document.getElementById('btn-toggle-screen-stream');
    const status = document.getElementById('screen-stream-status');
    const dev = state.selectedDevice;
    if (!dev) return;
    
    btn.innerText = "⏸️ 停止監看";
    btn.style.background = "#d97706";
    btn.style.borderColor = "#d97706";
    status.innerText = "串流中... (1 FPS)";
    status.style.color = "var(--color-green)";
    
    // Draw initial capture immediately
    captureFrame(dev, true);
    
    screenStreamInterval = setInterval(() => {
        captureFrame(dev, false);
    }, 1200);
}

function stopScreenStream() {
    if (screenStreamInterval) {
        clearInterval(screenStreamInterval);
        screenStreamInterval = null;
    }
    const btn = document.getElementById('btn-toggle-screen-stream');
    if (btn) {
        btn.innerText = "▶️ 開始監看";
        btn.style.background = "var(--color-green)";
        btn.style.borderColor = "var(--color-green)";
    }
    const status = document.getElementById('screen-stream-status');
    if (status) {
        status.innerText = "串流停止";
        status.style.color = "white";
    }
}

function captureFrame(dev, isFirst = false) {
    if (isFirst) showProgressBar(30);
    const canvas = document.getElementById('remote-screen-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = function() {
        if (isFirst) showProgressBar(100);
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
    };
    img.onerror = function() {
        if (isFirst) showProgressBar(100);
        stopScreenStream();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.fillRect(0, 0, canvas.width, 100);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        ctx.fillText('Error: Failed to stream screen frame.', 20, 50);
    };
    img.src = `http://localhost:3000/api/agent-proxy/${dev.ip}/screen?nocache=${Date.now()}`;
}

// Remote Console Execution
async function executeConsoleCommand() {
    const inputEl = document.getElementById('remote-console-input');
    const outputEl = document.getElementById('remote-console-output');
    const shellType = document.getElementById('console-shell-type').value;
    const command = inputEl.value.strip ? inputEl.value.trim() : inputEl.value;
    const dev = state.selectedDevice;
    
    if (!command || !dev) return;
    
    inputEl.value = '';
    inputEl.disabled = true;
    
    outputEl.innerHTML += `\n\n<span style="color: #58a6ff;">$ ${command}</span>`;
    outputEl.scrollTop = outputEl.scrollHeight;
    
    try {
        const res = await fetch(`http://localhost:3000/api/agent-proxy/${dev.ip}/shell`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, type: shellType })
        });
        
        if (!res.ok) throw new Error("HTTP connection error");
        
        const data = await res.json();
        let formattedOutput = "";
        
        if (data.stdout) {
            formattedOutput += `<span style="color: #c9d1d9;">${escapeHtml(data.stdout)}</span>`;
        }
        if (data.stderr) {
            formattedOutput += `<span style="color: #f85149;">${escapeHtml(data.stderr)}</span>`;
        }
        if (!data.stdout && !data.stderr) {
            formattedOutput += `<span style="color: var(--text-muted);">[指令執行完畢，無輸出內容，回傳代碼: ${data.exit_code}]</span>`;
        }
        
        outputEl.innerHTML += `\n${formattedOutput}`;
    } catch (e) {
        outputEl.innerHTML += `\n<span style="color: #f85149;">[錯誤] 無法連絡上被控端的 Agent API 服務。</span>`;
    }
    
    inputEl.disabled = false;
    inputEl.focus();
    outputEl.scrollTop = outputEl.scrollHeight;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Bind Remote Operations Setup
function setupRemoteOpsBindings() {
    // Open/Close
    const btnClose = document.getElementById('btn-close-remote-ops');
    if (btnClose) btnClose.addEventListener('click', closeRemoteOpsModal);
    
    // Tab switcher
    document.querySelectorAll('.remote-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchRemoteTab(btn.dataset.tab);
        });
    });
    
    // Screen Stream Toggle
    const btnStream = document.getElementById('btn-toggle-screen-stream');
    if (btnStream) {
        btnStream.addEventListener('click', () => {
            if (screenStreamInterval) {
                stopScreenStream();
            } else {
                startScreenStream();
            }
        });
    }
    
    // RDP launcher
    const btnRdp = document.getElementById('btn-launch-rdp');
    if (btnRdp) {
        btnRdp.addEventListener('click', () => {
            const dev = state.selectedDevice;
            if (!dev) return;
            
            // Build RDP file content dynamically
            const rdpContent = `full address:s:${dev.ip}\nprompt for credentials:i:1\nusername:s:Administrator\nscreen mode id:i:2\nuse multimon:i:1`;
            const blob = new Blob([rdpContent], { type: 'application/x-rdp' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `Support-${dev.name}-${dev.ip}.rdp`;
            a.click();
            URL.revokeObjectURL(url);
            logConsole(`已為設備 ${dev.name} 建立 RDP 支援通道檔案。`, 'cyan-log');
        });
    }
    
    // Console Input keypress
    const consoleInput = document.getElementById('remote-console-input');
    if (consoleInput) {
        consoleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                executeConsoleCommand();
            }
        });
    }
    
    const btnClearConsole = document.getElementById('btn-clear-console');
    if (btnClearConsole) {
        btnClearConsole.addEventListener('click', () => {
            document.getElementById('remote-console-output').innerHTML = `[IT控制台畫面已清除]`;
        });
    }
    
    // File Push Execution
    const btnPush = document.getElementById('btn-execute-file-push');
    if (btnPush) {
        btnPush.addEventListener('click', async () => {
            const dev = state.selectedDevice;
            const fileInput = document.getElementById('file-push-source');
            const destInput = document.getElementById('file-push-dest');
            const runImmediately = document.getElementById('file-push-run').checked;
            
            if (!dev || !fileInput.files[0] || !destInput.value.trim()) {
                alert("請先選擇本地派送檔案，並輸入儲存完整路徑！");
                return;
            }
            
            const file = fileInput.files[0];
            const destPath = destInput.value.trim();
            btnPush.innerText = "上傳並派送中...";
            btnPush.disabled = true;
            
            const reader = new FileReader();
            reader.onload = async function() {
                const base64Content = reader.result.split(',')[1];
                try {
                    const res = await fetch(`http://localhost:3000/api/agent-proxy/${dev.ip}/file/push`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: destPath,
                            content_b64: base64Content,
                            run: runImmediately,
                            filename: file.name
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        alert(data.message);
                        logConsole(`[派送] 檔案已成功派送至 ${dev.name} (${destPath})`, 'cyan-log');
                        fileInput.value = '';
                        destInput.value = '';
                    } else {
                        alert("派送失敗: " + data.error);
                    }
                } catch (e) {
                    alert("派送失敗，無法連絡上 Agent 服務。");
                }
                btnPush.innerText = "一鍵上傳並派送";
                btnPush.disabled = false;
            };
            reader.readAsDataURL(file);
        });
    }
    
    // File Pull Execution
    const btnPull = document.getElementById('btn-execute-file-pull');
    if (btnPull) {
        btnPull.addEventListener('click', async () => {
            const dev = state.selectedDevice;
            const sourceInput = document.getElementById('file-pull-source');
            
            if (!dev || !sourceInput.value.trim()) {
                alert("請輸入要收集的遠端檔案完整路徑！");
                return;
            }
            
            const remotePath = sourceInput.value.trim();
            btnPull.innerText = "檔案傳輸中...";
            btnPull.disabled = true;
            
            try {
                const res = await fetch(`http://localhost:3000/api/agent-proxy/${dev.ip}/file/pull?path=${encodeURIComponent(remotePath)}`);
                if (!res.ok) throw new Error();
                
                const data = await res.json();
                if (data.success) {
                    const binaryString = atob(data.content_b64);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const blob = new Blob([bytes], { type: 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = data.filename;
                    a.click();
                    URL.revokeObjectURL(url);
                    
                    logConsole(`[收集] 成功收集並下載設備 ${dev.name} 的檔案: ${data.filename}`, 'cyan-log');
                    sourceInput.value = '';
                } else {
                    alert("收集失敗: " + data.error);
                }
            } catch (e) {
                alert("收集失敗，無法連絡上 Agent 服務或路徑檔案不存在。");
            }
            
            btnPull.innerText = "一鍵拉回日誌檔案並下載";
            btnPull.disabled = false;
        });
    }
    
    // Announcement Broadcast
    const btnBroadcast = document.getElementById('btn-send-broadcast');
    if (btnBroadcast) {
        btnBroadcast.addEventListener('click', async () => {
            const dev = state.selectedDevice;
            const textarea = document.getElementById('broadcast-message-text');
            const message = textarea.value.trim();
            
            if (!dev || !message) {
                alert("請輸入公告廣播內容！");
                return;
            }
            
            btnBroadcast.innerText = "傳送中...";
            btnBroadcast.disabled = true;
            
            try {
                const res = await fetch(`http://localhost:3000/api/agent-proxy/${dev.ip}/broadcast`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                const data = await res.json();
                if (data.success) {
                    alert("廣播公告發送成功！該端點已置頂彈出顯示。");
                    logConsole(`[廣播] 成功向 ${dev.name} 發送公告彈窗。`, 'cyan-log');
                    textarea.value = '';
                } else {
                    alert("廣播失敗: " + data.error);
                }
            } catch (e) {
                alert("廣播傳送失敗，無法連絡上 Agent 服務。");
            }
            btnBroadcast.innerText = "📣 立即對該台設備進行廣播公告";
            btnBroadcast.disabled = false;
        });
    }
    
    // Power - Reboot
    const btnReboot = document.getElementById('btn-power-reboot');
    if (btnReboot) {
        btnReboot.addEventListener('click', async () => {
            const dev = state.selectedDevice;
            if (!dev || !confirm(`確定要強行重新開機 ${dev.name} 嗎？`)) return;
            
            try {
                const res = await fetch(`http://localhost:3000/api/agent-proxy/${dev.ip}/power`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reboot' })
                });
                const data = await res.json();
                if (data.success) {
                    alert("已下發重啟指令！");
                    logConsole(`[電源] 已對 ${dev.name} 下發重開機指令。`, 'warning-log');
                    closeRemoteOpsModal();
                } else {
                    alert("重啟指令下發失敗: " + data.error);
                }
            } catch (e) {
                alert("下發重啟失敗，無法連絡上 Agent 服務。");
            }
        });
    }
    
    // Power - Shutdown
    const btnShutdown = document.getElementById('btn-power-shutdown');
    if (btnShutdown) {
        btnShutdown.addEventListener('click', async () => {
            const dev = state.selectedDevice;
            if (!dev || !confirm(`確定要強行關閉 ${dev.name} 的電源嗎？`)) return;
            
            try {
                const res = await fetch(`http://localhost:3000/api/agent-proxy/${dev.ip}/power`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'shutdown' })
                });
                const data = await res.json();
                if (data.success) {
                    alert("已下發關機指令！");
                    logConsole(`[電源] 已對 ${dev.name} 下發關機指令。`, 'warning-log');
                    closeRemoteOpsModal();
                } else {
                    alert("關機指令下發失敗: " + data.error);
                }
            } catch (e) {
                alert("下發關機失敗，無法連絡上 Agent 服務。");
            }
        });
    }
    
    // Power - Wake on LAN
    const btnWol = document.getElementById('btn-power-wol');
    if (btnWol) {
        btnWol.addEventListener('click', async () => {
            const dev = state.selectedDevice;
            if (!dev) return;
            
            btnWol.innerText = "發送 WOL 中...";
            btnWol.disabled = true;
            
            try {
                const res = await fetch(`http://localhost:3000/api/agent/${dev.mac}/wol`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    alert("喚醒 Magic Packet 已對內網廣播發送！");
                    logConsole(`[WOL] 成功對 ${dev.name} 的 MAC [${dev.mac}] 廣播喚醒封包。`, 'cyan-log');
                } else {
                    alert("發送 WOL 失敗: " + data.error);
                }
            } catch (e) {
                alert("連線後端發送 WOL 封包失敗。");
            }
            btnWol.innerText = "⚡ 發送 WOL 網路喚醒封包";
            btnWol.disabled = false;
        });
    }
}

// === BATCH OPERATIONS MODULE (Multiple Devices Push & Broadcast) ===
function initBatchOpsModule() {
    const btnOpen = document.getElementById('btn-open-batch-ops');
    const modal = document.getElementById('batch-ops-modal');
    const btnClose = document.getElementById('btn-close-batch-ops');
    const deviceListContainer = document.getElementById('batch-device-list');
    const selectedCountSpan = document.getElementById('batch-selected-count');
    const btnSelectAll = document.getElementById('btn-batch-select-all');
    const btnDeselectAll = document.getElementById('btn-batch-deselect-all');
    
    if (!btnOpen || !modal) return;
    
    function updateSelectedCount() {
        const checked = deviceListContainer.querySelectorAll('.batch-device-checkbox:checked').length;
        if (selectedCountSpan) {
            selectedCountSpan.innerText = `已選 ${checked} 台`;
        }
    }
    
    function populateDeviceList() {
        if (!deviceListContainer) return;
        deviceListContainer.innerHTML = '';
        
        const allDevs = Object.values(state.devices).filter(d => d.ip && d.ip !== '0.0.0.0' && d.ip !== 'N/A');
        if (allDevs.length === 0) {
            deviceListContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 10px;">目前尚無已連線之設備</div>';
            updateSelectedCount();
            return;
        }
        
        allDevs.forEach(dev => {
            const isOnline = dev.status === 'online';
            const isReal = dev.isReal;
            const statusBadge = isOnline ? '🟢 線上' : '⚪ 離線';
            const realBadge = isReal ? ' (實體)' : ' (模擬)';
            
            const item = document.createElement('label');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem; cursor: pointer; color: white;';
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" class="batch-device-checkbox" data-ip="${dev.ip}" data-name="${dev.name || dev.ip}" ${isOnline ? 'checked' : ''}>
                    <span>${dev.name || dev.ip}</span>
                </div>
                <span style="font-size: 0.72rem; color: ${isOnline ? '#10b981' : '#6b7280'};">${dev.ip}${realBadge}</span>
            `;
            
            const cb = item.querySelector('input');
            cb.addEventListener('change', updateSelectedCount);
            deviceListContainer.appendChild(item);
        });
        
        updateSelectedCount();
    }
    
    btnOpen.addEventListener('click', () => {
        populateDeviceList();
        modal.style.display = 'flex';
    });
    
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', () => {
            deviceListContainer.querySelectorAll('.batch-device-checkbox').forEach(cb => cb.checked = true);
            updateSelectedCount();
        });
    }
    
    if (btnDeselectAll) {
        btnDeselectAll.addEventListener('click', () => {
            deviceListContainer.querySelectorAll('.batch-device-checkbox').forEach(cb => cb.checked = false);
            updateSelectedCount();
        });
    }
    
    // Tab Switching inside Batch Modal
    const tabBtns = modal.querySelectorAll('.batch-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'rgba(255,255,255,0.05)';
                b.style.border = '1px solid var(--border-color)';
            });
            btn.classList.add('active');
            btn.style.background = 'var(--color-green)';
            btn.style.border = 'none';
            
            const targetTab = btn.getAttribute('data-batch-tab');
            modal.querySelectorAll('.batch-panel').forEach(p => p.style.display = 'none');
            const activePanel = document.getElementById(`batch-panel-${targetTab}`);
            if (activePanel) activePanel.style.display = 'flex';
        });
    });
    
    // Quick Templates
    modal.querySelectorAll('.batch-template-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.getAttribute('data-template');
            const textarea = document.getElementById('batch-broadcast-text');
            if (textarea) textarea.value = text;
        });
    });
    
    // Execute Batch Broadcast
    const btnExecBroadcast = document.getElementById('btn-exec-batch-broadcast');
    if (btnExecBroadcast) {
        btnExecBroadcast.addEventListener('click', async () => {
            const checkedCbs = Array.from(deviceListContainer.querySelectorAll('.batch-device-checkbox:checked'));
            const ips = checkedCbs.map(cb => cb.getAttribute('data-ip'));
            const message = document.getElementById('batch-broadcast-text').value.trim();
            
            if (ips.length === 0) {
                alert('請至少勾選一台目標電腦！');
                return;
            }
            if (!message) {
                alert('請輸入廣播訊息內容！');
                return;
            }
            
            btnExecBroadcast.disabled = true;
            btnExecBroadcast.innerText = '發送中...';
            const logBox = document.getElementById('batch-execution-log');
            const logStatus = document.getElementById('batch-log-status');
            logStatus.innerText = '廣播發送中...';
            logBox.innerText = `[${new Date().toLocaleTimeString()}] 開始同步廣播至 ${ips.length} 台電腦...\n`;
            
            try {
                const res = await fetch('http://localhost:3000/api/batch/broadcast', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ips, message })
                });
                const data = await res.json();
                
                logBox.innerText += `\n=== 執行結果摘要 (成功 ${data.successCount} / 共 ${data.total} 台) ===\n`;
                data.results.forEach(r => {
                    if (r.success) {
                        logBox.innerText += `[✓ 成功] ${r.ip}: 訊息已彈窗顯示\n`;
                    } else {
                        logBox.innerText += `[✗ 失敗] ${r.ip}: ${r.error}\n`;
                    }
                });
                
                logStatus.innerText = `完成 (${data.successCount}/${data.total} 成功)`;
                logConsole(`[批次廣播] 已對 ${ips.length} 台電腦發送推播公告 (成功: ${data.successCount})`, 'cyan-log');
            } catch (err) {
                logBox.innerText += `\n[錯誤] 呼叫後端批次廣播服務失敗: ${err.message}\n`;
                logStatus.innerText = '發送失敗';
            }
            
            btnExecBroadcast.disabled = false;
            btnExecBroadcast.innerText = '📣 聲明並同步推播至選定電腦';
        });
    }
    
    // Execute Batch File Push
    const btnExecFilePush = document.getElementById('btn-exec-batch-filepush');
    if (btnExecFilePush) {
        btnExecFilePush.addEventListener('click', async () => {
            const checkedCbs = Array.from(deviceListContainer.querySelectorAll('.batch-device-checkbox:checked'));
            const ips = checkedCbs.map(cb => cb.getAttribute('data-ip'));
            const fileInput = document.getElementById('batch-file-source');
            const destPath = document.getElementById('batch-file-dest').value.trim();
            const runAfter = document.getElementById('batch-file-run').checked;
            
            if (ips.length === 0) {
                alert('請至少勾選一台目標電腦！');
                return;
            }
            if (!fileInput.files[0] || !destPath) {
                alert('請選擇派送檔案並確認目的端儲存路徑！');
                return;
            }
            
            const file = fileInput.files[0];
            btnExecFilePush.disabled = true;
            btnExecFilePush.innerText = '檔案讀取與派送中...';
            const logBox = document.getElementById('batch-execution-log');
            const logStatus = document.getElementById('batch-log-status');
            logStatus.innerText = '檔案傳送中...';
            logBox.innerText = `[${new Date().toLocaleTimeString()}] 開始將檔案 [${file.name}] 批次派送至 ${ips.length} 台電腦...\n`;
            
            const reader = new FileReader();
            reader.onload = async function() {
                const base64Content = reader.result.split(',')[1];
                try {
                    const res = await fetch('http://localhost:3000/api/batch/file-push', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ips,
                            path: destPath,
                            content_b64: base64Content,
                            run: runAfter,
                            filename: file.name
                        })
                    });
                    const data = await res.json();
                    
                    logBox.innerText += `\n=== 執行結果摘要 (成功 ${data.successCount} / 共 ${data.total} 台) ===\n`;
                    data.results.forEach(r => {
                        if (r.success) {
                            logBox.innerText += `[✓ 成功] ${r.ip}: ${r.message}\n`;
                        } else {
                            logBox.innerText += `[✗ 失敗] ${r.ip}: ${r.error}\n`;
                        }
                    });
                    
                    logStatus.innerText = `完成 (${data.successCount}/${data.total} 成功)`;
                    logConsole(`[批次派送] 已將 [${file.name}] 派送至 ${ips.length} 台電腦 (成功: ${data.successCount})`, 'cyan-log');
                } catch (err) {
                    logBox.innerText += `\n[錯誤] 呼叫後端批次派送服務失敗: ${err.message}\n`;
                    logStatus.innerText = '派送失敗';
                }
                
                btnExecFilePush.disabled = false;
                btnExecFilePush.innerText = '🚀 一鍵同步派送至選定電腦';
            };
            reader.readAsDataURL(file);
        });
    }
}
// Helper for loading progress bar
function showProgressBar(percent) {
    const loading = document.getElementById('remote-ops-loading');
    const bar = document.getElementById('remote-ops-loading-bar');
    if (!loading || !bar) return;
    
    loading.style.display = 'block';
    bar.style.width = `${percent}%`;
    
    if (percent >= 100) {
        setTimeout(() => {
            if (bar.style.width === '100%') {
                loading.style.display = 'none';
                bar.style.width = '0%';
            }
        }, 450);
    }
}
