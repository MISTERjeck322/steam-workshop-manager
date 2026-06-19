from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
import uvicorn
import json
import os
import re
import shutil
import subprocess
import threading
import queue
import urllib.request
import urllib.parse
import sys
from datetime import datetime

# --- НАСТРОЙКИ ПУТЕЙ С УЧЕТОМ КОМПИЛЯЦИИ ---
DB_FILE = "downloaded_mods.json"
GAME_SETTINGS_FILE = "game_settings.json"

if getattr(sys, 'frozen', False):
    # Если скрипт скомпилирован (PyInstaller), используем папку, где лежит .exe file
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # Если скрипт запущен как обычный .py файл
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
STEAMCMD_PATH = os.path.join(BASE_DIR, "steamCMD", "steamcmd.exe")
# ------------------------------------------

db_lock = threading.Lock()
settings_lock = threading.Lock()
download_queue = queue.Queue()

# Потокобезопасный реестр запущенных процессов SteamCMD {mod_id: subprocess.Popen}
active_processes = {}
active_processes_lock = threading.Lock()


class ModData(BaseModel):
    url: str
    title: str = "Неизвестный мод"
    imageUrl: str = ""
    gameName: str = "Steam Game"
    appId: str = ""


class GameSettingsData(BaseModel):
    customPath: str
    gameName: str = ""


def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "", name).strip()


def load_mods():
    with db_lock:
        if not os.path.exists(DB_FILE):
            return []
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []


def save_mods(mods):
    with db_lock:
        with open(DB_FILE, "w", encoding="utf-8") as f:
            json.dump(mods, f, ensure_ascii=False, indent=4)


def load_game_settings():
    with settings_lock:
        if not os.path.exists(GAME_SETTINGS_FILE):
            return {}
        try:
            with open(GAME_SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}


def save_game_settings(settings):
    with settings_lock:
        with open(GAME_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=4)


def update_mod_status(mod_id: str, updates: dict):
    mods = load_mods()
    for m in mods:
        if m["id"] == mod_id:
            m.update(updates)
            break
    save_mods(mods)


def fetch_steam_mods_details(mod_ids: list) -> dict:
    """Получает детальную информацию о модах из официального Web API Steam."""
    if not mod_ids:
        return {}
    
    url = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/"
    data = {
        "itemcount": len(mod_ids)
    }
    for i, fid in enumerate(mod_ids):
        data[f"publishedfileids[{i}]"] = str(fid)
        
    encoded_data = urllib.parse.urlencode(data).encode("utf-8")
    
    try:
        req = urllib.request.Request(url, data=encoded_data, method="POST")
        with urllib.request.urlopen(req, timeout=10) as response:
            resp_data = json.loads(response.read().decode("utf-8"))
            details = resp_data.get("response", {}).get("publishedfiledetails", [])
            return {item["publishedfileid"]: item for item in details if item.get("result") == 1}
    except Exception as e:
        print(f"[СЕРВЕР] Ошибка запроса к Steam API: {e}")
        return {}


def get_local_mod_mtime(local_path: str) -> int:
    """Определяет время изменения локальных файлов мода на диске."""
    if not local_path or not os.path.exists(local_path):
        return 0
    max_mtime = os.path.getmtime(local_path)
    try:
        for root, dirs, files in os.walk(local_path):
            for f in files:
                fp = os.path.join(root, f)
                if os.path.exists(fp):
                    max_mtime = max(max_mtime, os.path.getmtime(fp))
    except Exception:
        pass
    return int(max_mtime)


def get_actual_mod_root(base_path: str) -> str:
    """
    Универсальный поиск реального корня мода.
    Пропускает пустые папки-обертки (например, 'mods/ModName' в Project Zomboid).
    """
    current_path = base_path
    
    while True:
        try:
            items = os.listdir(current_path)
        except Exception:
            break
            
        if not items:
            break
            
        folders = []
        files = []
        
        for item in items:
            full_path = os.path.join(current_path, item)
            if os.path.isdir(full_path):
                folders.append(full_path)
            else:
                files.append(full_path)
                
        # Если обнаружен хотя бы один файл (конфиг, манифест и т.д.), это рабочий корень
        if len(files) > 0:
            break
            
        # Если папок больше одной, останавливаемся, чтобы не потерять структуру
        if len(folders) > 1:
            break
            
        # Если файлов нет и папка ровно одна — это обертка. Переходим глубже
        if len(folders) == 1:
            current_path = folders[0]
        else:
            break
            
    return current_path


def run_steamcmd_single(app_id: str, mod_id: str):
    """Запускает процесс скачивания и сохраняет ссылку на него в глобальном реестре."""
    if not os.path.exists(STEAMCMD_PATH):
        return False, None, f"SteamCMD не найден по пути {STEAMCMD_PATH}"

    cmd = [
        STEAMCMD_PATH,
        "+login", "anonymous",
        "+workshop_download_item", str(app_id), str(mod_id), "validate",
        "+quit"
    ]

    print(f"[СЕРВЕР] Запуск загрузки мода {mod_id} (AppID: {app_id})...")

    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

    env = os.environ.copy()
    env["STEAMCMD_NO_UPDATE"] = "1"

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            startupinfo=startupinfo,
            env=env
        )

        with active_processes_lock:
            active_processes[mod_id] = process

        downloaded_path = None
        success = False
        error_message = None

        buffer = []
        try:
            while True:
                char = process.stdout.read(1)
                if not char:
                    break
                
                if char in ('\r', '\n'):
                    line = "".join(buffer).strip()
                    if line:
                        print(f"[SteamCMD]: {line}")
                        
                        if "progress:" in line:
                            match = re.search(r"progress:\s+([\d\.]+)", line)
                            if match:
                                try:
                                    pct = float(match.group(1))
                                    mods = load_mods()
                                    current_status = "downloading"
                                    for m in mods:
                                        if m["id"] == mod_id:
                                            if m.get("status") in ["updating", "downloading"]:
                                                current_status = m["status"]
                                            break
                                    update_mod_status(mod_id, {"status": current_status, "progress": pct})
                                except ValueError:
                                    pass
                        
                        if "Success. Downloaded item" in line:
                            success = True
                            path_match = re.search(r'to "([^"]+)"', line)
                            if path_match:
                                downloaded_path = path_match.group(1)
                        
                        elif "ERROR!" in line or "Failed to install" in line:
                            error_message = line
                        elif "Access Denied" in line:
                            error_message = "Доступ запрещен: требуется купленная копия игры."

                    buffer = []
                else:
                    buffer.append(char)
        except Exception as read_err:
            print(f"[СЕРВЕР] Чтение вывода процесса {mod_id} прервано.")
            error_message = "Скачивание прервано пользователем."

        process.wait()

        if success and downloaded_path:
            return True, downloaded_path, None
        else:
            return False, None, error_message or "Загрузка не удалась или была отменена."

    except Exception as e:
        return False, None, f"Ошибка при запуске SteamCMD: {e}"
    finally:
        with active_processes_lock:
            if mod_id in active_processes:
                del active_processes[mod_id]


def download_worker():
    """Фоновый воркер очереди задач."""
    while True:
        task = download_queue.get()
        if task is None:
            break
        mod_id, app_id, title, game_name = task
        try:
            process_task(mod_id, app_id, title, game_name)
        except Exception as e:
            print(f"[СЕРВЕР] Ошибка воркера на моде {mod_id}: {e}")
            update_mod_status(mod_id, {"status": "failed", "error": f"Ошибка воркера: {str(e)}"})
        finally:
            download_queue.task_done()


def process_task(mod_id: str, app_id: str, title: str, game_name: str):
    mods = load_mods()
    existing_mod = next((m for m in mods if m["id"] == mod_id), None)
    if not existing_mod:
        print(f"[СЕРВЕР] Скачивание мода {mod_id} отменено, так как он был удален из очереди.")
        return

    if not app_id:
        update_mod_status(mod_id, {"status": "failed", "error": "Не определен App ID игры."})
        return

    task_status = "downloading"
    if existing_mod.get("status") == "updating":
        task_status = "updating"

    update_mod_status(mod_id, {
        "status": task_status,
        "progress": 0.0,
        "error": None,
        "downloadedAt": datetime.now().strftime("%d.%m.%Y %H:%M")
    })

    success, downloaded_path, error_msg = run_steamcmd_single(app_id, mod_id)

    mods = load_mods()
    if not any(m["id"] == mod_id for m in mods):
        print(f"[СЕРВЕР] Мод {mod_id} был удален во время загрузки. Копирование файлов отменено.")
        return

    if success and downloaded_path and os.path.exists(downloaded_path):
        try:
            # Определение пути назначения
            settings = load_game_settings()
            custom_path = settings.get(str(app_id), {}).get("customPath")
            
            safe_mod_folder = f"{sanitize_filename(title)}_{mod_id}"
            
            if custom_path and custom_path.strip():
                # Использование пользовательской папки
                target_path = os.path.join(custom_path.strip(), safe_mod_folder)
            else:
                # Использование папки по умолчанию
                safe_game_folder = sanitize_filename(game_name)
                target_path = os.path.join(DOWNLOADS_DIR, safe_game_folder, safe_mod_folder)

            os.makedirs(target_path, exist_ok=True)

            # Очистка целевой папки перед копированием
            for item in os.listdir(target_path):
                item_p = os.path.join(target_path, item)
                if os.path.isdir(item_p):
                    shutil.rmtree(item_p)
                else:
                    os.remove(item_p)

            # Вычисление реального корня мода без лишней вложенности
            actual_source_path = get_actual_mod_root(downloaded_path)

            # Копирование структуры файлов из реального корня
            for item in os.listdir(actual_source_path):
                s = os.path.join(actual_source_path, item)
                d = os.path.join(target_path, item)
                if os.path.isdir(s):
                    shutil.copytree(s, d)
                else:
                    shutil.copy2(s, d)

            time_updated = None
            try:
                details = fetch_steam_mods_details([mod_id])
                if mod_id in details:
                    time_updated = int(details[mod_id].get("time_updated", 0))
            except Exception:
                pass

            updates = {
                "status": "completed",
                "progress": 100.0,
                "localPath": target_path,
                "version": f"Загружено ({datetime.now().strftime('%d.%m.%Y %H:%M')})"
            }
            if time_updated:
                updates["time_updated"] = time_updated

            update_mod_status(mod_id, updates)
            print(f"[СЕРВЕР] Скачивание {mod_id} успешно завершено.")
        except Exception as e:
            update_mod_status(mod_id, {"status": "failed", "error": f"Ошибка копирования файлов: {e}"})
    else:
        update_mod_status(mod_id, {
            "status": "failed",
            "progress": 0.0,
            "error": error_msg or "Неизвестная ошибка SteamCMD."
        })


# Старт фонового воркера
worker_thread = threading.Thread(target=download_worker, daemon=True)
worker_thread.start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/download")
async def handle_download(data: ModData):
    mod_id = "unknown"
    match = re.search(r'id=(\d+)', data.url)
    if match:
        mod_id = match.group(1)

    mods = load_mods()
    existing_mod = next((m for m in mods if m["id"] == mod_id), None)
    current_time = datetime.now().strftime("%d.%m.%Y %H:%M")

    if not existing_mod:
        new_mod = {
            "id": mod_id,
            "appid": data.appId,
            "url": data.url,
            "title": data.title,
            "imageUrl": data.imageUrl,
            "gameName": data.gameName,
            "version": f"В очереди ({current_time})",
            "downloadedAt": current_time,
            "status": "pending",
            "progress": 0.0,
            "error": None,
            "localPath": None
        }
        mods.append(new_mod)
        save_mods(mods)
    else:
        if existing_mod.get("status") in ["failed", "pending", "completed", "update_available"]:
            update_mod_status(mod_id, {
                "status": "updating",
                "progress": 0.0,
                "error": None,
                "appid": data.appId
            })
        else:
            return {"status": "exists", "message": f"Мод {mod_id} уже загружается или готов."}

    download_queue.put((mod_id, data.appId, data.title, data.gameName))
    return {"status": "ok", "message": f"Мод {mod_id} добавлен в очередь!"}


@app.get("/mods")
async def get_mods():
    return load_mods()


@app.delete("/mods/{mod_id}")
async def delete_mod(mod_id: str):
    with active_processes_lock:
        if mod_id in active_processes:
            proc = active_processes[mod_id]
            try:
                print(f"[СЕРВЕР] Обнаружена активная загрузка мода {mod_id}. Прерываем процесс SteamCMD...")
                proc.kill()
            except Exception as e:
                print(f"[СЕРВЕР] Ошибка при убийстве процесса для мода {mod_id}: {e}")

    mods = load_mods()
    mod_to_delete = next((m for m in mods if m["id"] == mod_id), None)
    
    deleted_from_disk = False
    if mod_to_delete:
        local_path = mod_to_delete.get("localPath")
        if local_path and os.path.exists(local_path):
            try:
                if os.path.isdir(local_path):
                    shutil.rmtree(local_path)
                else:
                    os.remove(local_path)
                deleted_from_disk = True
                
                parent_dir = os.path.dirname(local_path)
                if os.path.exists(parent_dir) and os.path.isdir(parent_dir):
                    if not os.listdir(parent_dir):
                        os.rmdir(parent_dir)
            except Exception as e:
                print(f"[СЕРВЕР] Не удалось стереть директорию мода {mod_id} с диска: {e}")

    updated_mods = [m for m in mods if m["id"] != mod_id]
    save_mods(updated_mods)
    
    msg = f"Мод {mod_id} удален"
    if deleted_from_disk:
        msg += " и файлы стерты"
    return {"status": "ok", "message": msg}


@app.post("/check-updates")
async def check_updates():
    """Сравнивает время изменения локальных файлов с реальными данными из API Steam."""
    mods = load_mods()
    completed_mods = [m for m in mods if m.get("status") in ["completed", "update_available"]]
    
    if not completed_mods:
        return {"status": "ok", "message": "Нет скачанных модов для проверки обновлений."}
        
    mod_ids = [m["id"] for m in completed_mods]
    details = fetch_steam_mods_details(mod_ids)
    
    updated_count = 0
    for mod in mods:
        if mod["id"] in details:
            item_details = details[mod["id"]]
            remote_time = int(item_details.get("time_updated", 0))
            
            local_path = mod.get("localPath")
            local_time = 0
            if local_path and os.path.exists(local_path):
                local_time = get_local_mod_mtime(local_path)
                
            if remote_time > local_time + 60:
                mod["status"] = "update_available"
                formatted_date = datetime.fromtimestamp(remote_time).strftime('%d.%m.%Y %H:%M')
                mod["version"] = f"Доступно обновление ({formatted_date})"
                updated_count += 1
            else:
                mod["status"] = "completed"
                formatted_date = datetime.fromtimestamp(remote_time).strftime('%d.%m.%Y %H:%M')
                mod["version"] = f"Актуальная версия ({formatted_date})"
                
            mod["time_updated"] = remote_time
            
    save_mods(mods)
    
    if updated_count > 0:
        return {"status": "ok", "message": f"Проверка завершена. Найдено обновлений: {updated_count}."}
    else:
        return {"status": "ok", "message": "Все установленные моды актуальны."}


@app.post("/update-all")
async def update_all_mods():
    mods = load_mods()
    queued_count = 0
    for mod in mods:
        if mod.get("status") in ["update_available", "failed"]:
            update_mod_status(mod["id"], {"status": "updating", "progress": 0.0, "error": None})
            download_queue.put((mod["id"], mod.get("appid", ""), mod["title"], mod["gameName"]))
            queued_count += 1
            
    if queued_count > 0:
        return {"status": "ok", "message": f"Запущено обновление для {queued_count} модов."}
    else:
        return {"status": "ok", "message": "Нет доступных обновлений. Сначала запустите 'Проверить обновления'."}


# --- УПРАВЛЕНИЕ НАСТРОЙКАМИ ПУТЕЙ ИГР ---

@app.get("/game-settings")
async def get_game_settings():
    return load_game_settings()


@app.post("/game-settings/{appid}")
async def update_game_settings(appid: str, data: GameSettingsData):
    settings = load_game_settings()
    
    # Очистка пути от кавычек (часто бывает при Shift+Прав Клик -> Скопировать как путь)
    clean_path = data.customPath.strip().strip('"\'')
    
    settings[appid] = {
        "customPath": clean_path,
        "gameName": data.gameName
    }
    save_game_settings(settings)
    return {"status": "ok", "message": f"Путь для AppID {appid} сохранен: {clean_path}"}


if __name__ == "__main__":
    print(f"Используемый путь к SteamCMD: {STEAMCMD_PATH}")
    print(f"Каталог сохранения модов: {DOWNLOADS_DIR}")
    uvicorn.run(app, host="127.0.0.1", port=8080)