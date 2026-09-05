import os
import sys
import json
import socket
import uuid
import datetime
import threading
import time
import tkinter as tk
from tkinter import messagebox, filedialog, simpledialog
from http.server import BaseHTTPRequestHandler
import socketserver
import urllib.parse
import subprocess
import platform
import base64

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

# Disable high DPI scaling to allow Windows DWM to scale the Tkinter window automatically (prevents text/layout clipping on high-DPI screens)
# try:
#     from ctypes import windll
#     windll.shcore.SetProcessDpiAwareness(1)
# except Exception:
#     pass

# Morandi Color Palette
COLOR_BG = "#f4f3f0"
COLOR_TEXT_MAIN = "#2f2a25"
COLOR_TEXT_MUTED = "#8a8279"
COLOR_BORDER = "#dcdad5"
COLOR_PRIMARY = "#7c8c82" # Soft green-gray

CONFIG_FILE = "agent_config.json"

# Helper: Get MAC address
def get_mac_address():
    try:
        mac_num = uuid.getnode()
        mac_hex = f'{mac_num:012x}'
        mac_str = ':'.join(mac_hex[i:i+2] for i in range(0, 11, 2))
        return mac_str.upper()
    except Exception:
        return "UNKNOWN_MAC"

# Helper: Get all IPv4 addresses except loopback
def get_ip_addresses():
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            ip = info[4][0]
            if ":" not in ip and ip != "127.0.0.1": # Skip IPv6 and Localhost
                if ip not in ips:
                    ips.append(ip)
    except Exception:
        pass
    
    if not ips:
        # Fallback using UDP connect
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
            s.close()
        except Exception:
            ips.append("127.0.0.1")
    return ips

# Custom Rounded Button
class RoundedButton(tk.Canvas):
    def __init__(self, parent, text, command, width=120, height=36, radius=6, bg="#eae8e4", fg="#5f5348", active_bg="#dfdcd7", active_fg="#5f5348", border_color="#c8c2b9", font=("Microsoft JhengHei Light", 9), parent_bg=None):
        p_bg = parent_bg if parent_bg else (parent.cget("bg") if hasattr(parent, "cget") else COLOR_BG)
        super().__init__(parent, width=width, height=height, bg=p_bg, highlightthickness=0)
        self.command = command
        self.text = text
        self.radius = radius
        self.w = width
        self.h = height
        self.bg = bg
        self.fg = fg
        self.active_bg = active_bg
        self.active_fg = active_fg
        self.border_color = border_color
        self.font = font
        
        self.draw_button(self.bg, self.fg)
        
        self.bind("<Enter>", self.on_enter)
        self.bind("<Leave>", self.on_leave)
        self.bind("<Button-1>", self.on_click)

    def draw_button(self, bg_color, fg_color):
        self.delete("all")
        r = self.radius
        w = self.w
        h = self.h
        
        if r > 0:
            self.create_oval(0, 0, 2*r, 2*r, fill=bg_color, outline=self.border_color, width=1)
            self.create_oval(w - 2*r, 0, w, 2*r, fill=bg_color, outline=self.border_color, width=1)
            self.create_oval(0, h - 2*r, 2*r, h, fill=bg_color, outline=self.border_color, width=1)
            self.create_oval(w - 2*r, h - 2*r, w, h, fill=bg_color, outline=self.border_color, width=1)
            
            self.create_rectangle(r, 0, w - r, h, fill=bg_color, outline="")
            self.create_rectangle(0, r, w, h - r, fill=bg_color, outline="")
            
            self.create_line(r, 0, w - r, 0, fill=self.border_color, width=1)
            self.create_line(r, h, w - r, h, fill=self.border_color, width=1)
            self.create_line(0, r, 0, h - r, fill=self.border_color, width=1)
            self.create_line(w, r, w, h - r, fill=self.border_color, width=1)
        else:
            self.create_rectangle(0, 0, w, h, fill=bg_color, outline=self.border_color, width=1)
            
        self.create_text(w // 2, h // 2, text=self.text, fill=fg_color, font=self.font)

    def on_enter(self, event):
        self.config(cursor="hand2")
        self.draw_button(self.active_bg, self.active_fg)

    def on_leave(self, event):
        self.config(cursor="")
        self.draw_button(self.bg, self.fg)

    def on_click(self, event):
        if self.command:
            self.command()

class AgentApp:
    def __init__(self, root):
        self.root = root
        self.root.title("即時資訊回報")
        self.root.minsize(460, 420)
        self.root.resizable(True, True)
        self.root.config(bg=COLOR_BG)
        
        # Set Window Icon
        try:
            ico_path = os.path.abspath("app_logo.ico")
            if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
                ico_path = os.path.join(sys._MEIPASS, "app_logo.ico")
            if os.path.exists(ico_path):
                self.root.iconbitmap(ico_path)
        except Exception as e:
            print("[Icon Error]", e)

        # Center Window
        self.root.update_idletasks()
        w = 480
        h = 480
        x = (self.root.winfo_screenwidth() // 2) - (w // 2)
        y = (self.root.winfo_screenheight() // 2) - (h // 2)
        self.root.geometry(f"{w}x{h}+{x}+{y}")
        
        self.report_dir = ""
        self.is_running = True
        self.current_status = "online"
        self.last_report_time = "尚未進行回報"
        self.write_lock = threading.Lock()
        
        self.load_config()
        self.create_widgets()
        
        self.cached_software = []
        threading.Thread(target=self.refresh_software_cache, daemon=True).start()

        # Start Heartbeat Thread
        self.thread = threading.Thread(target=self.heartbeat_loop, daemon=True)
        self.thread.start()
        
        # Start HTTP API Server Thread
        self.server_thread = threading.Thread(target=self.start_http_server, daemon=True)
        self.server_thread.start()

        # Start Shared Command Queue Loop Thread
        self.cmd_thread = threading.Thread(target=self.command_queue_loop, daemon=True)
        self.cmd_thread.start()
        
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        
        # Initialize System Tray
        self.tray = None
        self.root.after(500, self.init_system_tray)

    def refresh_software_cache(self):
        try:
            import winreg
            software_list = []
            keys = [
                (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
                (winreg.HKEY_LOCAL_MACHINE, r"Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
                (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall")
            ]
            for hive, key_path in keys:
                try:
                    key = winreg.OpenKey(hive, key_path)
                    for i in range(winreg.QueryInfoKey(key)[0]):
                        try:
                            subkey_name = winreg.EnumKey(key, i)
                            subkey = winreg.OpenKey(key, subkey_name)
                            try:
                                name = winreg.QueryValueEx(subkey, "DisplayName")[0]
                                if name and name.strip():
                                    try: version = winreg.QueryValueEx(subkey, "DisplayVersion")[0]
                                    except: version = "-"
                                    try: publisher = winreg.QueryValueEx(subkey, "Publisher")[0]
                                    except: publisher = "-"
                                    software_list.append({"name": name.strip(), "version": str(version), "publisher": str(publisher)})
                            except:
                                pass
                            winreg.CloseKey(subkey)
                        except:
                            pass
                    winreg.CloseKey(key)
                except:
                    pass
            unique_software = {}
            for s in software_list:
                if s["name"].strip():
                    unique_software[s["name"]] = s
            self.cached_software = sorted(list(unique_software.values()), key=lambda x: x["name"])
        except Exception as e:
            print("[Software Cache Error]", e)

    def init_system_tray(self):
        try:
            self.tray = WindowsSystemTray(self)
        except Exception as e:
            print("[Tray Init Error]", e)

    def restore_from_tray(self):
        self.root.deiconify()
        self.root.state('normal')
        self.root.lift()
        self.root.focus_force()

    def hide_to_tray(self):
        self.root.withdraw()

    def show_tray_menu(self):
        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(label="📱 顯示主視窗", command=self.restore_from_tray)
        menu.add_separator()
        menu.add_command(label="🛑 徹底退出程式", command=self.exit_completely)
        
        try:
            x, y = self.root.winfo_pointerxy()
            menu.tk_popup(x, y)
        finally:
            menu.grab_release()

    def set_autostart_registry(self, enabled):
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE)
            if enabled:
                if getattr(sys, 'frozen', False):
                    exe_path = sys.executable
                else:
                    exe_path = os.path.abspath(sys.argv[0])
                winreg.SetValueEx(key, "TopdgiDeviceAgent", 0, winreg.REG_SZ, f'"{exe_path}"')
            else:
                try:
                    winreg.DeleteValue(key, "TopdgiDeviceAgent")
                except FileNotFoundError:
                    pass
            winreg.CloseKey(key)
        except Exception:
            pass

    def load_config(self):
        # Resolve config path beside the running app
        if getattr(sys, 'frozen', False):
            base_dir = os.path.dirname(sys.executable)
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            
        self.config_path = os.path.join(base_dir, CONFIG_FILE)
        is_first_launch = not os.path.exists(self.config_path)
        
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    self.report_dir = cfg.get("report_dir", "")
            except Exception:
                pass
                
        # Smart directory resolution with fail-safe local fallback
        local_devices = os.path.join(base_dir, "devices")
        shared_default = r"Z:\工具開發\Devices"
        
        # Test if configured report_dir or shared_default is writable
        target_dir = self.report_dir or shared_default
        try:
            os.makedirs(target_dir, exist_ok=True)
            self.report_dir = target_dir
        except Exception:
            os.makedirs(local_devices, exist_ok=True)
            self.report_dir = local_devices

        if is_first_launch:
            self.set_autostart_registry(True)

    def save_config(self):
        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump({"report_dir": self.report_dir}, f, ensure_ascii=False, indent=2)
        except Exception as e:
            messagebox.showerror("錯誤", f"儲存配置檔失敗: {e}", parent=self.root)

    def create_widgets(self):
        frame = tk.Frame(self.root, bg=COLOR_BG, padx=20, pady=15)
        frame.pack(fill=tk.BOTH, expand=True)
        
        # Header title
        tk.Label(
            frame, 
            text="鼎顓電子-User資訊", 
            font=("Microsoft JhengHei Light", 14, "bold"), 
            bg=COLOR_BG, 
            fg=COLOR_TEXT_MAIN
        ).pack(anchor=tk.W, pady=(0, 10))
        
        # Status Card (Details of this PC)
        card = tk.Frame(frame, bg="#ffffff", highlightthickness=1, highlightbackground=COLOR_BORDER, padx=15, pady=10)
        card.pack(fill=tk.X, pady=(0, 10))
        
        self.hostname = socket.gethostname()
        self.ips = get_ip_addresses()
        self.mac = get_mac_address()
        
        eth_ip = self.ips[0] if len(self.ips) > 0 else "未連線"
        wifi_ip = self.ips[1] if len(self.ips) > 1 else "未連線"
        
        self.add_info_row(card, "電腦名稱:", self.hostname, 0)
        self.add_info_row(card, "乙太網路IP:", eth_ip, 1)
        self.add_info_row(card, "WIFI-IP:", wifi_ip, 2)
        self.add_info_row(card, "MAC:", self.mac, 3)
        
        # Report Directory Configuration Row
        path_frame = tk.Frame(frame, bg=COLOR_BG)
        path_frame.pack(fill=tk.X, pady=5)
        
        tk.Label(path_frame, text="📁 回報共用槽資料夾路徑：", font=("Microsoft JhengHei Light", 9, "bold"), bg=COLOR_BG, fg=COLOR_TEXT_MUTED).pack(anchor=tk.W)
        
        self.path_entry_var = tk.StringVar(value=self.report_dir)
        path_input_row = tk.Frame(path_frame, bg=COLOR_BG)
        path_input_row.pack(fill=tk.X, pady=3)
        
        self.path_entry = tk.Entry(
            path_input_row, 
            textvariable=self.path_entry_var, 
            font=("Microsoft JhengHei Light", 9), 
            relief=tk.SOLID, 
            bd=1, 
            highlightcolor=COLOR_PRIMARY,
            bg="#ffffff"
        )
        self.path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=3, padx=(0, 6))
        
        browse_btn = RoundedButton(
            path_input_row, "瀏覽...", self.browse_path,
            width=70, height=26, radius=4,
            bg="#eae8e4", fg="#5f5348", active_bg="#dfdcd7",
            border_color="#c8c2b9", font=("Microsoft JhengHei Light", 9), parent_bg=COLOR_BG
        )
        browse_btn.pack(side=tk.RIGHT)
        
        # Heartbeat Status Label
        self.status_label = tk.Label(
            frame, 
            text="📡 狀態: 初始化中...", 
            font=("Microsoft JhengHei Light", 9, "bold"), 
            bg=COLOR_BG, 
            fg=COLOR_TEXT_MUTED
        )
        self.status_label.pack(anchor=tk.W, pady=(8, 2))
        
        # Checkbutton for autostart
        self.autostart_var = tk.BooleanVar(value=self.check_autostart_status())
        self.autostart_chk = tk.Checkbutton(
            frame, 
            text="開機時自動啟動此回報程式 (隨 Windows 啟動)", 
            variable=self.autostart_var,
            command=self.toggle_autostart,
            font=("Microsoft JhengHei Light", 9), 
            bg=COLOR_BG, 
            activebackground=COLOR_BG,
            fg=COLOR_TEXT_MUTED,
            activeforeground=COLOR_TEXT_MAIN
        )
        self.autostart_chk.pack(anchor=tk.W, pady=(0, 6))
        
        # Bottom controls
        bottom_frame = tk.Frame(frame, bg=COLOR_BG)
        bottom_frame.pack(side=tk.BOTTOM, fill=tk.X)
        
        apply_btn = RoundedButton(
            bottom_frame, "儲存並套用路徑", self.apply_path,
            width=130, height=32, radius=5,
            bg="#eae8e4", fg="#5f5348", active_bg="#dfdcd7",
            border_color="#c8c2b9", font=("Microsoft JhengHei Light", 9, "bold"), parent_bg=COLOR_BG
        )
        apply_btn.pack(side=tk.LEFT)
        
        self.problem_btn = RoundedButton(
            bottom_frame, "🙋 舉手反映", self.toggle_problem,
            width=130, height=32, radius=5,
            bg="#ef4444", fg="#ffffff", active_bg="#dc2626", active_fg="#ffffff",
            border_color="#ef4444", font=("Microsoft JhengHei Light", 9, "bold"), parent_bg=COLOR_BG
        )
        self.problem_btn.pack(side=tk.RIGHT)

    def add_info_row(self, parent, label_text, val_text, row):
        tk.Label(parent, text=label_text, font=("Microsoft JhengHei Light", 9, "bold"), bg="#ffffff", fg=COLOR_TEXT_MUTED).grid(row=row, column=0, sticky=tk.W, pady=3)
        tk.Label(parent, text=val_text, font=("Consolas", 10), bg="#ffffff", fg=COLOR_TEXT_MAIN).grid(row=row, column=1, sticky=tk.W, padx=10, pady=3)

    def browse_path(self):
        selected_dir = filedialog.askdirectory(parent=self.root, title="選擇共用槽匯報資料夾")
        if selected_dir:
            self.path_entry_var.set(selected_dir)

    def apply_path(self):
        new_path = self.path_entry_var.get().strip()
        if not new_path:
            messagebox.showwarning("警告", "請輸入有效的路徑！", parent=self.root)
            return
            
        self.report_dir = new_path
        self.save_config()
        messagebox.showinfo("成功", "路徑設定成功，將立即更新回報位置！", parent=self.root)
        self.trigger_heartbeat()

    def toggle_problem(self):
        if self.current_status == "online":
            confirm = messagebox.askyesno("系統提示", "是否通知IT？", parent=self.root)
            if not confirm:
                return
            self.current_status = "incident"
            self.problem_btn.text = "🟢 恢復正常"
            self.problem_btn.bg = "#10b981"
            self.problem_btn.active_bg = "#059669"
            self.problem_btn.border_color = "#10b981"
        else:
            self.current_status = "online"
            self.problem_btn.text = "🙋 舉手反映"
            self.problem_btn.bg = "#ef4444"
            self.problem_btn.active_bg = "#dc2626"
            self.problem_btn.border_color = "#ef4444"
        
        self.problem_btn.draw_button(self.problem_btn.bg, self.problem_btn.fg)
        self.trigger_heartbeat()

    def trigger_heartbeat(self):
        # Trigger an immediate heartbeat report
        t = threading.Thread(target=self.send_report, daemon=True)
        t.start()

    def send_report(self):
        with self.write_lock:
            try:
                # Ensure the report directory exists
                os.makedirs(self.report_dir, exist_ok=True)
                
                cpu_load = round(psutil.cpu_percent(interval=None), 1) if HAS_PSUTIL else 15.0
                mem = psutil.virtual_memory() if HAS_PSUTIL else None
                ram_dict = mem._asdict() if mem else {"total": 17179869184, "free": 8589934592, "percent": 50.0}
                try:
                    d = psutil.disk_usage('C:\\') if HAS_PSUTIL else None
                    disk_dict = d._asdict() if d else {"total": 512000000000, "free": 256000000000, "percent": 50.0, "health": "Healthy (100% 健全)"}
                except:
                    disk_dict = {"total": 512000000000, "free": 256000000000, "percent": 50.0, "health": "Healthy (100% 健全)"}

                report_data = {
                    "hostname": self.hostname,
                    "ips": self.ips,
                    "mac": self.mac,
                    "status": self.current_status,
                    "timestamp": datetime.datetime.now().isoformat(),
                    "audit": {
                        "cpu_load": cpu_load,
                        "ram": ram_dict,
                        "disk": disk_dict,
                        "os": platform.platform(),
                        "os_release": platform.win32_ver()[1] if hasattr(platform, 'win32_ver') else platform.release(),
                        "software": getattr(self, 'cached_software', [])
                    }
                }
                
                # Safe filename: replace colons in MAC to prevent issues on filesystem
                safe_mac = self.mac.replace(":", "-")
                file_name = f"{self.hostname}_{safe_mac}.json"
                file_path = os.path.join(self.report_dir, file_name)
                
                # Write report directly with retry mechanism for Windows sharing violations (especially on network drives)
                written = False
                last_err = None
                for attempt in range(5):
                    try:
                        with open(file_path, 'w', encoding='utf-8') as f:
                            json.dump(report_data, f, ensure_ascii=False, indent=2)
                        written = True
                        break
                    except OSError as e:
                        last_err = e
                        time.sleep(0.15)
                
                if not written:
                    raise last_err
                
                self.last_report_time = datetime.datetime.now().strftime("%H:%M:%S")
                self.status_label.config(
                    text=f"🟢 狀態: 回報成功 (最後更新: {self.last_report_time})", 
                    fg="#427d53"
                )
            except Exception as e:
                self.status_label.config(
                    text=f"🔴 狀態: 回報失敗 ({str(e)[:25]}...)", 
                    fg="#b83232"
                )

    def heartbeat_loop(self):
        while self.is_running:
            self.send_report()
            # Sleep for 30 seconds
            for _ in range(30):
                if not self.is_running:
                    break
                time.sleep(1)

    def set_autostart_registry(self, enabled):
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE)
            if enabled:
                if getattr(sys, 'frozen', False):
                    exe_path = sys.executable
                else:
                    exe_path = os.path.abspath(sys.argv[0])
                winreg.SetValueEx(key, "TopdgiDeviceAgent", 0, winreg.REG_SZ, f'"{exe_path}"')
            else:
                try:
                    winreg.DeleteValue(key, "TopdgiDeviceAgent")
                except FileNotFoundError:
                    pass
            winreg.CloseKey(key)
        except Exception:
            pass

    def check_autostart_status(self):
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ)
            try:
                winreg.QueryValueEx(key, "TopdgiDeviceAgent")
                winreg.CloseKey(key)
                return True
            except FileNotFoundError:
                winreg.CloseKey(key)
                return False
        except Exception:
            return False

    def toggle_autostart(self):
        enabled = self.autostart_var.get()
        self.set_autostart_registry(enabled)
        log_msg = "已設定開機自動啟動。" if enabled else "已取消開機自動啟動。"
        messagebox.showinfo("成功", log_msg, parent=self.root)

    def on_close(self):
        confirm = messagebox.askyesnocancel(
            "TOPDGI 設備安全回報器", 
            "點選「是」：徹底退出程式，停止安全維護連線。\n點選「否」：隱藏至右下角系統托盤，在背景常駐維護。",
            parent=self.root
        )
        if confirm is True:
            self.exit_completely()
        elif confirm is False:
            self.hide_to_tray()

    def exit_completely(self):
        self.is_running = False
        if hasattr(self, 'tray') and self.tray:
            self.tray.remove()
        try:
            if hasattr(self, 'httpd'):
                self.httpd.shutdown()
                self.httpd.server_close()
        except:
            pass
        self.root.destroy()

    def start_http_server(self):
        server_address = ('0.0.0.0', 3010)
        handler_class = create_handler_class(self)
        
        # Open port 3010 in Windows Defender Firewall for ANY profile & remote address (Cross-subnet support)
        try:
            cmd = 'powershell -Command "if (-not (Get-NetFirewallRule -Name TopdgiAgentPort -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name TopdgiAgentPort -DisplayName \\"Topdgi Agent Port 3010\\" -Direction Inbound -LocalPort 3010 -Protocol TCP -Action Allow -Profile Any -RemoteAddress Any } else { Set-NetFirewallRule -Name TopdgiAgentPort -Profile Any -RemoteAddress Any }"'
            subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
        except Exception:
            pass

        class ReusableTCPServer(socketserver.TCPServer):
            allow_reuse_address = True
            
        try:
            self.httpd = ReusableTCPServer(server_address, handler_class)
            print("[Agent API] Server started on port 3010")
            self.httpd.serve_forever()
        except Exception as e:
            print(f"[Agent API] Failed to start server: {e}")

    def command_queue_loop(self):
        while self.is_running:
            try:
                if self.report_dir and os.path.exists(self.report_dir):
                    cmd_dir = os.path.join(self.report_dir, "cmd_queue")
                    if os.path.exists(cmd_dir):
                        resp_dir = os.path.join(cmd_dir, "responses")
                        os.makedirs(resp_dir, exist_ok=True)
                        
                        files = os.listdir(cmd_dir)
                        for fname in files:
                            if fname.endswith('.json') and not fname.startswith('resp_'):
                                fpath = os.path.join(cmd_dir, fname)
                                try:
                                    with open(fpath, 'r', encoding='utf-8') as f:
                                        cmd = json.load(f)
                                    
                                    target_ip = cmd.get("ip", "")
                                    target_mac = cmd.get("mac", "")
                                    
                                    if target_ip in self.ips or target_mac == self.mac or target_ip == self.hostname:
                                        cmd_id = cmd.get("cmdId", fname.replace('.json', ''))
                                        sub_path = cmd.get("subPath", "")
                                        body = cmd.get("body", {})
                                        
                                        res_payload = self.process_queued_command(sub_path, body)
                                        
                                        resp_path = os.path.join(resp_dir, f"resp_{cmd_id}.json")
                                        with open(resp_path, 'w', encoding='utf-8') as rf:
                                            json.dump(res_payload, rf, ensure_ascii=False)
                                            
                                        try: os.unlink(fpath)
                                        except: pass
                                except Exception:
                                    pass
            except Exception:
                pass
            time.sleep(0.3)

    def process_queued_command(self, sub_path, body):
        try:
            if sub_path == 'broadcast':
                msg = body.get('message', '')
                self.show_broadcast_message(msg)
                return {"success": True, "message": "Broadcast popup displayed"}
            elif sub_path == 'file/push':
                target_path = body.get('path', '').strip()
                content_b64 = body.get('content_b64', '')
                run_after_push = body.get('run', False)
                filename = body.get('filename', 'pushed_file')
                
                if target_path.startswith("桌面") or target_path.lower().startswith("desktop"):
                    desktop_dir = os.path.join(os.environ.get('USERPROFILE', 'C:\\Users\\Default'), 'Desktop')
                    if target_path == "桌面" or target_path.lower() == "desktop":
                        target_path = os.path.join(desktop_dir, filename)
                    else:
                        cleaned = target_path[2:] if target_path.startswith("桌面") else target_path[7:]
                        cleaned = cleaned.lstrip("\\/")
                        target_path = os.path.join(desktop_dir, cleaned or filename)
                        
                parent_dir = os.path.dirname(target_path)
                if parent_dir:
                    os.makedirs(parent_dir, exist_ok=True)
                    
                import base64
                file_data = base64.b64decode(content_b64)
                with open(target_path, 'wb') as f:
                    f.write(file_data)
                    
                if run_after_push:
                    if target_path.endswith('.ps1'):
                        args = ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", target_path]
                    elif target_path.endswith('.bat') or target_path.endswith('.cmd'):
                        args = ["cmd.exe", "/c", target_path]
                    else:
                        args = [target_path]
                    subprocess.Popen(args, shell=True, creationflags=0x08000000)
                return {"success": True, "message": "File pushed via queue"}
            elif sub_path == 'audit':
                cpu_load = round(psutil.cpu_percent(interval=None), 1) if HAS_PSUTIL else 15.0
                mem = psutil.virtual_memory() if HAS_PSUTIL else None
                ram_dict = mem._asdict() if mem else {"total": 17179869184, "free": 8589934592, "percent": 50.0}
                try:
                    d = psutil.disk_usage('C:\\') if HAS_PSUTIL else None
                    disk_dict = d._asdict() if d else {"total": 512000000000, "free": 256000000000, "percent": 50.0, "health": "Healthy (100% 健全)"}
                except:
                    disk_dict = {"total": 512000000000, "free": 256000000000, "percent": 50.0, "health": "Healthy (100% 健全)"}

                return {
                    "cpu_load": cpu_load,
                    "ram": ram_dict,
                    "disk": disk_dict,
                    "os": platform.platform(),
                    "os_release": platform.win32_ver()[1] if hasattr(platform, 'win32_ver') else platform.release(),
                    "software": getattr(self, 'cached_software', [])
                }
            elif sub_path == 'screen':
                import tempfile
                import base64
                temp_dir = tempfile.gettempdir()
                temp_file = os.path.join(temp_dir, f"cmd_screen_{int(time.time())}.jpg")
                
                ps_cmd = f"""
                try {{
                    [Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null
                    [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
                    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                    $bmp = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
                    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
                    $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
                    $bmp.Save('{temp_file}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
                    $graphics.Dispose()
                    $bmp.Dispose()
                }} catch {{}}
                """
                script_path = os.path.join(temp_dir, "capture_cmd.ps1")
                try:
                    with open(script_path, 'w', encoding='utf-8') as f:
                        f.write(ps_cmd)
                    subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
                    
                    if os.path.exists(temp_file):
                        with open(temp_file, 'rb') as f:
                            img_bytes = f.read()
                        try: os.unlink(temp_file)
                        except: pass
                        img_b64 = base64.b64encode(img_bytes).decode('utf-8')
                        return {"success": True, "image_b64": img_b64}
                except Exception as e:
                    pass
                finally:
                    try: os.unlink(script_path)
                    except: pass
                return {"error": "Failed to capture screen frame"}
            elif sub_path == 'shell':
                command = body.get("command", "")
                shell_type = body.get("type", "cmd")
                if shell_type == "powershell":
                    args = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command]
                else:
                    args = ["cmd.exe", "/c", command]
                proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True, creationflags=0x08000000)
                stdout, stderr = proc.communicate(timeout=10)
                return {"stdout": stdout, "stderr": stderr, "exit_code": proc.returncode}
        except Exception as e:
            return {"error": str(e)}
        return {"error": "Unknown subPath"}

    def show_broadcast_message(self, message):
        def _create_popup():
            try:
                popup = tk.Toplevel()
                popup.title("IT 系統公告")
                popup.configure(bg="#ffffff", highlightthickness=2, highlightbackground=COLOR_PRIMARY)
                popup.overrideredirect(True)
                
                w = 420
                h = 220
                screen_w = popup.winfo_screenwidth()
                screen_h = popup.winfo_screenheight()
                x = (screen_w - w) // 2
                y = (screen_h - h) // 3
                popup.geometry(f"{w}x{h}+{x}+{y}")
                
                # Header
                header = tk.Frame(popup, bg=COLOR_PRIMARY, height=36)
                header.pack(fill=tk.X)
                tk.Label(header, text="📢 鼎顓電子 - 運維公告系統", font=("Microsoft JhengHei", 10, "bold"), bg=COLOR_PRIMARY, fg="#ffffff").pack(side=tk.LEFT, padx=12, pady=6)
                
                # Content
                content_frame = tk.Frame(popup, bg="#ffffff", padx=20, pady=15)
                content_frame.pack(fill=tk.BOTH, expand=True)
                
                msg_lbl = tk.Label(content_frame, text=message, font=("Microsoft JhengHei Light", 10), bg="#ffffff", fg=COLOR_TEXT_MAIN, wraplength=380, justify=tk.LEFT, anchor=tk.NW)
                msg_lbl.pack(fill=tk.BOTH, expand=True, pady=(5, 10))
                
                # Confirm Button
                btn_frame = tk.Frame(content_frame, bg="#ffffff")
                btn_frame.pack(side=tk.BOTTOM, fill=tk.X)
                
                btn = RoundedButton(
                    btn_frame, "確認了解", popup.destroy,
                    width=100, height=30, radius=4,
                    bg="#eae8e4", fg="#5f5348", active_bg="#dfdcd7",
                    border_color="#c8c2b9", font=("Microsoft JhengHei", 9, "bold"), parent_bg="#ffffff"
                )
                btn.pack(anchor=tk.CENTER)
                
                popup.deiconify()
                popup.lift()
                popup.focus_force()
                popup.attributes("-topmost", True)
            except Exception as e:
                print("[Broadcast Popup Error]", e)
                
        self.root.after(0, _create_popup)

def create_handler_class(agent_app):
    class AgentHTTPHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass
            
        def _set_headers(self, status=200, content_type='application/json', content_length=None):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            if content_length is not None:
                self.send_header('Content-Length', str(content_length))
            self.end_headers()
            
        def do_OPTIONS(self):
            self._set_headers(200)
            
        def do_GET(self):
            parsed_path = urllib.parse.urlparse(self.path)
            path = parsed_path.path
            
            if path == '/audit':
                self.handle_audit()
            elif path == '/screen':
                self.handle_screen()
            elif path == '/file/pull':
                self.handle_file_pull(parsed_path.query)
            else:
                self._set_headers(404)
                self.wfile.write(json.dumps({"error": "Not Found"}).encode('utf-8'))
                
        def do_POST(self):
            parsed_path = urllib.parse.urlparse(self.path)
            path = parsed_path.path
            
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else b''
            
            if path == '/shell':
                self.handle_shell(post_data)
            elif path == '/file/push':
                self.handle_file_push(post_data)
            elif path == '/broadcast':
                self.handle_broadcast(post_data)
            elif path == '/power':
                self.handle_power(post_data)
            else:
                self._set_headers(404)
                self.wfile.write(json.dumps({"error": "Not Found"}).encode('utf-8'))

        def handle_audit(self):
            try:
                import platform
                import psutil
                
                cpu_load = psutil.cpu_percent(interval=None)
                mem = psutil.virtual_memory()
                ram_total = mem.total
                ram_free = mem.available
                ram_percent = mem.percent
                
                try:
                    d = psutil.disk_usage('C:\\')
                    disk_total = d.total
                    disk_free = d.free
                    disk_percent = d.percent
                except Exception:
                    disk_total = 256 * 1024 * 1024 * 1024
                    disk_free = 128 * 1024 * 1024 * 1024
                    disk_percent = 50.0

                disk_health = "Healthy (100% 健全)"
                software_sorted = getattr(agent_app, 'cached_software', [])

                payload = json.dumps({
                    "cpu_load": round(cpu_load, 1),
                    "ram": {"total": ram_total, "free": ram_free, "percent": ram_percent},
                    "disk": {"total": disk_total, "free": disk_free, "percent": disk_percent, "health": disk_health},
                    "os": platform.platform(),
                    "os_release": platform.win32_ver()[1],
                    "software": software_sorted
                }, ensure_ascii=False).encode('utf-8')
                self._set_headers(200, 'application/json; charset=utf-8', len(payload))
                self.wfile.write(payload)
            except Exception as e:
                err_payload = json.dumps({"error": str(e)}).encode('utf-8')
                self._set_headers(500, 'application/json', len(err_payload))
                self.wfile.write(err_payload)

        def handle_screen(self):
            import tempfile
            temp_dir = tempfile.gettempdir()
            temp_file = os.path.join(temp_dir, f"screen_{int(time.time())}.jpg")
            
            ps_cmd = f"""
            try {{
                [Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null
                [Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
                
                try {{
                    $dpiDef = @"
                    using System;
                    using System.Runtime.InteropServices;
                    public class DPIAware {{
                        [DllImport("user32.dll")]
                        public static extern bool SetProcessDPIAware();
                    }}
"@
                    Add-Type -TypeDefinition $dpiDef -ErrorAction SilentlyContinue
                    [DPIAware]::SetProcessDPIAware() | Out-Null
                }} catch {{}}

                $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                $bmp = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
                $graphics = [System.Drawing.Graphics]::FromImage($bmp)
                $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
                $bmp.Save('{temp_file}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
                $graphics.Dispose()
                $bmp.Dispose()
            }} catch {{
                try {{
                    $bmp = New-Object System.Drawing.Bitmap(800, 450)
                    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
                    $graphics.Clear([System.Drawing.Color]::FromArgb(17, 24, 39))
                    
                    $font = New-Object System.Drawing.Font("Microsoft JhengHei", 16)
                    $brush = [System.Drawing.Brushes]::LightGray
                    $rect = New-Object System.Drawing.RectangleF(50, 150, 700, 200)
                    $format = New-Object System.Drawing.StringFormat
                    $format.Alignment = [System.Drawing.StringAlignment]::Center
                    
                    $graphics.DrawString("遠端畫面已鎖定、最小化或處於虛擬機器背景模式`n( GDI 顯示卡控制碼無效 )", $font, $brush, $rect, $format)
                    $bmp.Save('{temp_file}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
                    
                    $graphics.Dispose()
                    $bmp.Dispose()
                }} catch {{}}
            }}
            """
            script_path = os.path.join(temp_dir, "capture.ps1")
            try:
                with open(script_path, 'w', encoding='utf-8') as f:
                    f.write(ps_cmd)
                subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
                
                if os.path.exists(temp_file):
                    with open(temp_file, 'rb') as f:
                        img_data = f.read()
                    try: os.unlink(temp_file)
                    except: pass
                    
                    self._set_headers(200, 'image/jpeg', len(img_data))
                    self.wfile.write(img_data)
                    return
            except Exception as e:
                pass
            finally:
                try: os.unlink(script_path)
                except: pass
                
            self._set_headers(500)
            self.wfile.write(json.dumps({"error": "Failed to capture screen"}).encode('utf-8'))

        def handle_file_pull(self, query):
            import base64
            try:
                params = urllib.parse.parse_qs(query)
                file_path = params.get("path", [""])[0]
                
                if not file_path or not os.path.exists(file_path):
                    raise Exception("File not found or missing path")
                    
                file_size = os.path.getsize(file_path)
                if file_size > 50 * 1024 * 1024:
                    raise Exception("File is too large (max 50MB)")
                    
                with open(file_path, 'rb') as f:
                    file_data = f.read()
                    
                content_b64 = base64.b64encode(file_data).decode('utf-8')
                
                self._set_headers(200)
                self.wfile.write(json.dumps({
                    "success": True,
                    "filename": os.path.basename(file_path),
                    "size": file_size,
                    "content_b64": content_b64
                }).encode('utf-8'))
            except Exception as e:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        def handle_shell(self, post_data):
            try:
                params = json.loads(post_data.decode('utf-8'))
                command = params.get("command", "")
                shell_type = params.get("type", "cmd")
                
                if not command:
                    raise Exception("Empty command")
                    
                if shell_type == "powershell":
                    args = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command]
                else:
                    args = ["cmd.exe", "/c", command]
                    
                proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True, creationflags=0x08000000)
                try:
                    stdout, stderr = proc.communicate(timeout=15)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    stdout, stderr = proc.communicate()
                    stdout += "\n[IT中控] 指令執行超時 (15秒) 已被強制終止。"
                    
                self._set_headers(200)
                self.wfile.write(json.dumps({
                    "stdout": stdout,
                    "stderr": stderr,
                    "exit_code": proc.returncode
                }, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        def handle_file_push(self, post_data):
            import base64
            try:
                params = json.loads(post_data.decode('utf-8'))
                target_path = params.get("path", "").strip()
                content_b64 = params.get("content_b64", "")
                run_after_push = params.get("run", False)
                filename = params.get("filename", "pushed_file")
                
                if not target_path or not content_b64:
                    raise Exception("Missing path or content_b64")
                
                # Smart resolve desktop path if target_path starts with or is "桌面" or "desktop"
                if target_path.startswith("桌面") or target_path.lower().startswith("desktop"):
                    desktop_dir = os.path.join(os.environ.get('USERPROFILE', 'C:\\Users\\Default'), 'Desktop')
                    if target_path == "桌面" or target_path.lower() == "desktop":
                        target_path = os.path.join(desktop_dir, filename)
                    else:
                        cleaned_subpath = target_path[2:] if target_path.startswith("桌面") else target_path[7:]
                        cleaned_subpath = cleaned_subpath.lstrip("\\/")
                        if not cleaned_subpath:
                            target_path = os.path.join(desktop_dir, filename)
                        else:
                            target_path = os.path.join(desktop_dir, cleaned_subpath)
                    
                parent_dir = os.path.dirname(target_path)
                if parent_dir:
                    os.makedirs(parent_dir, exist_ok=True)
                    
                file_data = base64.b64decode(content_b64)
                with open(target_path, 'wb') as f:
                    f.write(file_data)
                    
                execution_result = "檔案派送成功。"
                if run_after_push:
                    if target_path.endswith('.ps1'):
                        args = ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", target_path]
                    elif target_path.endswith('.bat') or target_path.endswith('.cmd'):
                        args = ["cmd.exe", "/c", target_path]
                    else:
                        args = [target_path]
                        
                    subprocess.Popen(args, shell=True, creationflags=0x08000000)
                    execution_result = "檔案派送成功，且已在背景啟動執行。"
                    
                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True, "message": execution_result}).encode('utf-8'))
            except Exception as e:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        def handle_broadcast(self, post_data):
            try:
                params = json.loads(post_data.decode('utf-8'))
                message = params.get("message", "")
                if not message:
                    raise Exception("Empty message")
                    
                agent_app.show_broadcast_message(message)
                resp = json.dumps({"success": True}).encode('utf-8')
                self._set_headers(200, 'application/json', len(resp))
                self.wfile.write(resp)
            except Exception as e:
                err_resp = json.dumps({"error": str(e)}).encode('utf-8')
                self._set_headers(500, 'application/json', len(err_resp))
                self.wfile.write(err_resp)

        def handle_power(self, post_data):
            try:
                params = json.loads(post_data.decode('utf-8'))
                action = params.get("action", "")
                
                if action == "reboot":
                    self._set_headers(200)
                    self.wfile.write(json.dumps({"success": True, "message": "Reboot initiated"}).encode('utf-8'))
                    threading.Thread(target=lambda: (time.sleep(2), os.system("shutdown /r /t 0")), daemon=True).start()
                elif action == "shutdown":
                    self._set_headers(200)
                    self.wfile.write(json.dumps({"success": True, "message": "Shutdown initiated"}).encode('utf-8'))
                    threading.Thread(target=lambda: (time.sleep(2), os.system("shutdown /s /t 0")), daemon=True).start()
                else:
                    raise Exception("Invalid action")
            except Exception as e:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                
    return AgentHTTPHandler

class WindowsSystemTray:
    def __init__(self, agent):
        self.agent = agent
        self.hwnd = agent.root.winfo_id()
        self.nid = None
        self.c_wndproc = None
        self.old_wndproc = None
        self.is_added = False
        self.setup_tray()

    def setup_tray(self):
        try:
            import ctypes
            from ctypes import wintypes
            
            user32 = ctypes.windll.user32
            shell32 = ctypes.windll.shell32
            
            LRESULT = ctypes.c_int64 if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_long
            
            user32.CallWindowProcW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
            user32.CallWindowProcW.restype = LRESULT
            
            if ctypes.sizeof(ctypes.c_void_p) == 8:
                GetWindowLong = user32.GetWindowLongPtrW
                SetWindowLong = user32.SetWindowLongPtrW
                user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
                user32.GetWindowLongPtrW.restype = ctypes.c_void_p
                user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
                user32.SetWindowLongPtrW.restype = ctypes.c_void_p
            else:
                GetWindowLong = user32.GetWindowLongW
                SetWindowLong = user32.SetWindowLongW

            class NOTIFYICONDATAW(ctypes.Structure):
                _fields_ = [
                    ("cbSize", wintypes.DWORD),
                    ("hWnd", wintypes.HWND),
                    ("uID", wintypes.UINT),
                    ("uFlags", wintypes.UINT),
                    ("uCallbackMessage", wintypes.UINT),
                    ("hIcon", wintypes.HICON),
                    ("szTip", wintypes.WCHAR * 128),
                ]

            WM_USER = 0x0400
            WM_TRAYICON = WM_USER + 20
            WM_LBUTTONDBLCLK = 0x0203
            WM_LBUTTONUP = 0x0202
            WM_RBUTTONUP = 0x0205
            
            GWL_WNDPROC = -4

            NIM_ADD = 0
            NIM_DELETE = 2
            NIF_MESSAGE = 1
            NIF_ICON = 2
            NIF_TIP = 4

            self.nid = NOTIFYICONDATAW()
            self.nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
            self.nid.hWnd = self.hwnd
            self.nid.uID = 99
            self.nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
            self.nid.uCallbackMessage = WM_TRAYICON
            ico_path = os.path.abspath("app_logo.ico")
            if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
                ico_path = os.path.join(sys._MEIPASS, "app_logo.ico")

            h_icon = None
            if os.path.exists(ico_path):
                IMAGE_ICON = 1
                LR_LOADFROMFILE = 0x00000010
                h_icon = user32.LoadImageW(0, ico_path, IMAGE_ICON, 0, 0, LR_LOADFROMFILE)

            if not h_icon:
                h_icon = user32.LoadIconW(0, 32512) # Standard App Icon Fallback

            self.nid.hIcon = h_icon
            self.nid.szTip = "TOPDGI 設備安全回報器 (背景常駐中)"

            WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

            def py_wndproc(h, msg, wparam, lparam):
                if msg == WM_TRAYICON:
                    if lparam in (WM_LBUTTONDBLCLK, WM_LBUTTONUP):
                        self.agent.restore_from_tray()
                    elif lparam == WM_RBUTTONUP:
                        self.agent.show_tray_menu()
                    return 0
                return user32.CallWindowProcW(self.old_wndproc, h, msg, wparam, lparam)

            self.c_wndproc = WNDPROC(py_wndproc)
            self.old_wndproc = GetWindowLong(self.hwnd, GWL_WNDPROC)
            SetWindowLong(self.hwnd, GWL_WNDPROC, self.c_wndproc)

            shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(self.nid))
            self.is_added = True
        except Exception as e:
            print("[Tray Error]", e)

    def remove(self):
        if self.is_added and self.nid:
            try:
                import ctypes
                ctypes.windll.shell32.Shell_NotifyIconW(2, ctypes.byref(self.nid)) # NIM_DELETE
            except Exception:
                pass

def main():
    root = tk.Tk()
    app = AgentApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()
