#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Launcher Radio Translate Papua: satu pintu masuk untuk semua cara menjalankan
(script klik-dua-kali lewat uv, maupun installer .exe/.app/.deb).

Yang dikerjakan:
  1. Menentukan folder data (model AI, rekaman, setelan, log) dan memuat setelan
     dari radio-translate.env di sana.
  2. Satu instance saja: kalau aplikasi sudah jalan, cukup buka jendelanya lagi.
  3. Menjalankan app_faster_whisper_lokal.py dengan server produksi (waitress).
  4. Membuka Chrome/Edge dalam mode aplikasi (Radio V2 butuh WebUSB, yang hanya
     ada di Chromium), atau browser biasa bila tidak ada.
  5. Menyediakan /app/info dan /app/shutdown (tombol "Tutup Aplikasi" di halaman).

    python radio_launcher.py [--port 5050] [--host 0.0.0.0] [--data-dir DIR] [--no-browser]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import warnings
import webbrowser
from pathlib import Path

APP_NAME = "Radio Translate Papua"
APP_ID = "RadioTranslatePapua"
FALLBACK_VERSION = "1.0.0"  # dipakai bila pyproject.toml tidak ada (installer)
DEFAULT_PORT = 5050  # 5000 dipakai AirPlay Receiver di macOS
CONFIG_FILENAME = "radio-translate.env"

CONFIG_TEMPLATE = """\
# Setelan Radio Translate Papua. Satu baris NAMA=nilai; hapus tanda # di depan
# baris untuk mengaktifkannya. Variabel lingkungan sistem tetap menang atas file ini.

# Port web lokal. Kalau diganti, Radio V2 perlu dipasangkan ulang (izin USB per alamat).
# RADIO_PORT=5050

# 0.0.0.0 = bisa dibuka dari HP/laptop lain di jaringan yang sama; 127.0.0.1 = komputer ini saja.
# RADIO_HOST=0.0.0.0

# app = jendela aplikasi Chrome/Edge, tab = tab browser biasa, none = jangan buka browser.
# RADIO_BROWSER=app

# 1 = jalan tanpa model AI; 0 = wajib pakai model. Kosong = otomatis.
# YALI_NO_MODEL=1

# Folder model AI (default: folder "models" di folder data ini).
# YALI_MODEL_DIR=

# GPU: auto = Whisper & model terjemahan tetap di GPU bila VRAM >= 6 GB (mis. RTX 3070);
# 1 = bergantian dimuat dari disk (GPU 4 GB); 0 = selalu keduanya di GPU.
# YALI_LOW_VRAM_MODE=auto
# YALI_WHISPER_COMPUTE=int8_float16
# 0 = model baru dimuat saat ucapan pertama, bukan saat aplikasi dibuka.
# YALI_PRELOAD_MODELS=1
# Mode Live: potongan suara lebih pendek dari ini (detik) tidak diterjemahkan.
# YALI_LIVE_MIN_SECONDS=0.6

# Radio V1 (Web-888 / SDR++): offset konverter dan alamat rigctl / rtl_tcp.
# WEB888_FREQ_OFFSET_HZ=-122880000
# RIGCTL_HOST=192.168.0.148
# RIGCTL_PORT=8073
# RTLTCP_HOST=192.168.0.148
# RTLTCP_PORT=8073

# Radio V2 lewat server: gain dan offset.
# HACKRF_LNA_GAIN=24
# HACKRF_VGA_GAIN=20
# HACKRF_FREQ_OFFSET_HZ=0
"""


# ----------------------------------------------------------------------
# Folder
# ----------------------------------------------------------------------
def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def code_dir() -> Path:
    """Folder kode & aset (templates/, static/, listener_kit/)."""
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent


def read_app_version() -> str:
    """Versi dari pyproject.toml (satu sumber versi, dipakai juga oleh rilis GitHub)."""
    try:
        import tomllib
        with open(code_dir() / "pyproject.toml", "rb") as f:
            return tomllib.load(f)["project"]["version"]
    except (OSError, KeyError, ValueError):
        return os.environ.get("RADIO_BUILD_VERSION", FALLBACK_VERSION)


APP_VERSION = read_app_version()


def default_data_dir() -> Path:
    """Folder data yang bisa ditulis. Dari source: folder project (susunan Drive)."""
    if not is_frozen():
        return code_dir()
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        return base / APP_ID
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / APP_ID
    base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "radio-translate-papua"


# ----------------------------------------------------------------------
# Setelan
# ----------------------------------------------------------------------
def parse_env_file(text: str) -> dict:
    """Baris NAMA=nilai; komentar (#) dan baris kosong diabaikan, tanda kutip dilepas."""
    values = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.split(" #", 1)[0].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def load_config(data_dir: Path) -> Path:
    config_path = data_dir / CONFIG_FILENAME
    if not config_path.exists():
        config_path.write_text(CONFIG_TEMPLATE, encoding="utf-8")
    for key, value in parse_env_file(config_path.read_text(encoding="utf-8")).items():
        os.environ.setdefault(key, value)
    return config_path


# ----------------------------------------------------------------------
# Log: semua print ke konsol juga ditulis ke file (aplikasi .app/.exe tanpa konsol)
# ----------------------------------------------------------------------
class _Tee:
    def __init__(self, stream, log_file):
        self._stream = stream
        self._log = log_file

    def write(self, text):
        if self._stream is not None:
            try:
                self._stream.write(text)
            except Exception:
                pass
        self._log.write(text)
        self._log.flush()
        return len(text)

    def flush(self):
        if self._stream is not None:
            try:
                self._stream.flush()
            except Exception:
                pass
        self._log.flush()

    def isatty(self):
        return False


def setup_logging(data_dir: Path) -> Path:
    log_dir = data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "radio-translate.log"
    log_file = open(log_path, "w", encoding="utf-8", buffering=1)
    sys.stdout = _Tee(sys.stdout, log_file)
    sys.stderr = _Tee(sys.stderr, log_file)
    return log_path


def say(message: str):
    print(f"[LAUNCHER] {message}", file=sys.stderr, flush=True)


def show_error(message: str):
    """Pesan error yang tetap terlihat walau aplikasi tanpa jendela konsol."""
    say(f"ERROR: {message}")
    if not is_frozen():
        return  # dari terminal/script: pesannya sudah terlihat di konsol
    try:
        if platform.system() == "Darwin":
            subprocess.run(
                ["osascript", "-e", f'display alert "{APP_NAME}" message {json.dumps(message)} as critical'],
                check=False, timeout=120,
            )
        elif platform.system() == "Windows":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x10)
    except Exception:
        pass


# ----------------------------------------------------------------------
# Port & instance tunggal
# ----------------------------------------------------------------------
def running_instance(port: int):
    """Info /app/info kalau aplikasi ini sudah jalan di port tsb, selain itu None."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/app/info", timeout=1.5) as res:
            info = json.loads(res.read().decode("utf-8"))
            return info if info.get("app") == APP_ID else None
    except Exception:
        return None


# Port yang ditolak Chrome/Edge (ERR_UNSAFE_PORT) di sekitar rentang yang dipakai.
CHROME_BLOCKED_PORTS = {5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080}


def port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        # Di Windows SO_REUSEADDR membolehkan bind walau port sedang dipakai program
        # lain, jadi di sana pakai SO_EXCLUSIVEADDRUSE. Di Unix SO_REUSEADDR hanya
        # mengabaikan sisa TIME_WAIT dari run sebelumnya (sama seperti waitress).
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0" if host in ("", "0.0.0.0") else host, port))
            return True
        except OSError:
            return False


# ----------------------------------------------------------------------
# Browser
# ----------------------------------------------------------------------
def find_chromium() -> str | None:
    """Chrome/Edge/Chromium (WebUSB untuk Radio V2)."""
    system = platform.system()
    candidates = []
    if system == "Windows":
        for env in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            root = os.environ.get(env)
            if root:
                candidates += [
                    Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe",
                    Path(root) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                ]
    elif system == "Darwin":
        for name in ("Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"):
            candidates.append(Path("/Applications") / f"{name}.app" / "Contents" / "MacOS" / name)
            candidates.append(Path.home() / "Applications" / f"{name}.app" / "Contents" / "MacOS" / name)
    else:
        for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
            found = shutil.which(name)
            if found:
                candidates.append(Path(found))
    for path in candidates:
        if path.exists():
            return str(path)
    return None


def open_browser(url: str, mode: str):
    if mode == "none":
        return
    chromium = find_chromium()
    if mode == "app" and chromium:
        say(f"Membuka jendela aplikasi: {url}")
        subprocess.Popen([chromium, f"--app={url}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    if not chromium:
        say("Chrome/Edge tidak ditemukan: Radio V2 (USB di browser) butuh Chrome atau Edge.")
    say(f"Membuka browser: {url}")
    webbrowser.open(url)


# ----------------------------------------------------------------------
# Server
# ----------------------------------------------------------------------
def register_app_routes(core, data_dir: Path, config_path: Path, log_path: Path):
    from flask import jsonify, request

    @core.app.route("/app/info", methods=["GET"])
    def app_info():
        return jsonify({
            "ok": True,
            "app": APP_ID,
            "name": APP_NAME,
            "version": APP_VERSION,
            "managed": True,
            "data_dir": str(data_dir),
            "model_dir": str(core.MODEL_DIR),
            "config": str(config_path),
            "log": str(log_path),
            "no_model": core.NO_MODEL_MODE,
        })

    @core.app.route("/app/shutdown", methods=["POST"])
    def app_shutdown():
        # Hanya dari komputer ini, bukan dari perangkat lain di jaringan.
        if request.remote_addr not in ("127.0.0.1", "::1"):
            return jsonify({"ok": False, "error": "Hanya bisa ditutup dari komputer ini."}), 403

        def stop():
            time.sleep(0.3)
            say("Ditutup dari halaman web.")
            try:
                core.stop_all_radio_sources()
            except Exception:
                pass
            os._exit(0)

        threading.Thread(target=stop, daemon=True).start()
        return jsonify({"ok": True})

    register_setup_routes(core, config_path)
    register_update_routes(core)


# ----------------------------------------------------------------------
# Update otomatis dari GitHub Releases (updater.py). Dicek saat halaman dibuka
# (hasilnya di-cache supaya tidak kena batas permintaan GitHub); dipasang lewat
# tombol "Update" di header, lalu dipakai setelah aplikasi dibuka ulang.
# RADIO_UPDATE_CHECK=0 mematikan pengecekan; RADIO_UPDATE_REPO=pemilik/repo.
# ----------------------------------------------------------------------
UPDATE_CACHE_SECONDS = 600


def register_update_routes(core):
    from flask import jsonify, request
    import updater

    app_dir = code_dir()
    repo = os.environ.get("RADIO_UPDATE_REPO", updater.DEFAULT_REPO)
    cache = {"at": 0.0, "result": None}
    state = {"installed": None}

    def check(force: bool):
        if not force and cache["result"] and time.monotonic() - cache["at"] < UPDATE_CACHE_SECONDS:
            return cache["result"]
        result = {"ok": True, "current": APP_VERSION, "repo": repo,
                  "mode": updater.install_mode(app_dir, is_frozen()), "update_available": False}
        try:
            latest = updater.check_latest(repo)
            result["latest"] = latest
            result["update_available"] = updater.is_newer(latest["version"], APP_VERSION)
        except updater.UpdateError as exc:
            result["error"] = str(exc)
        cache.update(at=time.monotonic(), result=result)
        return result

    @core.app.route("/app/update/status", methods=["GET"])
    def update_status():
        # force=1 = operator menekan "Cek update"; RADIO_UPDATE_CHECK=0 hanya
        # mematikan pengecekan otomatis saat halaman dibuka.
        force = request.args.get("force") == "1"
        if os.environ.get("RADIO_UPDATE_CHECK", "1") == "0" and not force:
            return jsonify({"ok": True, "current": APP_VERSION, "disabled": True, "update_available": False})
        result = dict(check(force))
        result["installed"] = state["installed"]
        return jsonify(result)

    @core.app.route("/app/update/apply", methods=["POST"])
    def update_apply():
        if request.remote_addr not in ("127.0.0.1", "::1"):
            return jsonify({"ok": False, "error": "Update hanya bisa dipasang dari komputer ini."}), 403
        status = check(force=True)
        if not status.get("update_available"):
            return jsonify({"ok": False, "error": status.get("error") or "Sudah versi terbaru."}), 400
        latest = status["latest"]
        say(f"Memasang update {APP_VERSION} -> {latest['version']} ({status['mode']}) …")
        try:
            result = updater.install_update(app_dir, APP_VERSION, latest, is_frozen())
        except (updater.UpdateError, OSError, subprocess.SubprocessError) as exc:
            say(f"Update gagal: {exc}")
            return jsonify({"ok": False, "error": str(exc)}), 500
        state["installed"] = latest["version"]
        say(f"Update {latest['version']} terpasang; dipakai setelah aplikasi dibuka ulang.")
        return jsonify({"ok": True, "version": latest["version"], **result})


# ----------------------------------------------------------------------
# Wizard "Model AI": memilih pakai AI (dan folder modelnya) atau radio saja.
# Pilihan disimpan di radio-translate.env: RADIO_SETUP_DONE, RADIO_AI (dibaca
# juga oleh script Jalankan-* untuk memasang paket AI), YALI_MODEL_DIR,
# YALI_NO_MODEL. Setelan baru dipakai setelah aplikasi dibuka ulang.
# ----------------------------------------------------------------------
def ai_packages_installed() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def register_setup_routes(core, config_path: Path):
    from flask import jsonify, request
    import model_setup

    def saved():
        return parse_env_file(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}

    def is_local():
        return request.remote_addr in ("127.0.0.1", "::1")

    @core.app.route("/app/setup/status", methods=["GET"])
    def setup_status():
        settings = saved()
        done = settings.get("RADIO_SETUP_DONE") == "1"
        mode = None
        if done:
            mode = "ai" if settings.get("RADIO_AI") == "1" else "radio"
        model_dir = settings.get("YALI_MODEL_DIR") or str(core.MODEL_DIR)
        return jsonify({
            "ok": True,
            "setup_done": done,
            "mode": mode,
            "ai_packages": ai_packages_installed(),
            "frozen": is_frozen(),
            "no_model_now": core.NO_MODEL_MODE,
            "picker": model_setup.folder_picker_available() and is_local(),
            "check": model_setup.check_model_dir(model_dir),
        })

    @core.app.route("/app/setup/check", methods=["POST"])
    def setup_check():
        path = str((request.get_json(silent=True) or {}).get("path") or "").strip()
        if not path:
            return jsonify({"ok": False, "error": "Isi folder model dulu."}), 400
        return jsonify({"ok": True, "check": model_setup.check_model_dir(path)})

    @core.app.route("/app/setup/pick-folder", methods=["POST"])
    def setup_pick_folder():
        # Dialog muncul di komputer tempat aplikasi jalan, jadi hanya dari komputer itu.
        if not is_local():
            return jsonify({"ok": False, "error": "Pilih folder hanya bisa dari komputer ini; ketik path-nya."}), 403
        path = model_setup.pick_folder()
        if path is None:
            return jsonify({"ok": False, "error": "Dialog pilih folder tidak tersedia; ketik path-nya."})
        if not path:
            return jsonify({"ok": True, "cancelled": True})
        return jsonify({"ok": True, "path": path, "check": model_setup.check_model_dir(path)})

    @core.app.route("/app/setup/save", methods=["POST"])
    def setup_save():
        data = request.get_json(silent=True) or {}
        mode = data.get("mode")
        if mode == "radio":
            model_setup.update_env_file(config_path, {
                "RADIO_SETUP_DONE": "1", "RADIO_AI": "0", "YALI_NO_MODEL": "1",
            })
            return jsonify({"ok": True, "next": "none" if core.NO_MODEL_MODE else "reopen"})
        if mode != "ai":
            return jsonify({"ok": False, "error": "Pilihan tidak dikenal."}), 400

        check = model_setup.check_model_dir(str(data.get("path") or core.MODEL_DIR))
        if not check["ready"]:
            return jsonify({"ok": False, "error": "Model Ambai belum lengkap.", "check": check}), 400
        model_setup.update_env_file(config_path, {
            "RADIO_SETUP_DONE": "1", "RADIO_AI": "1", "YALI_NO_MODEL": None,
            "YALI_MODEL_DIR": check["model_dir"],
        })
        if not ai_packages_installed():
            next_step = "installer-ai" if is_frozen() else "rerun-script"
        elif core.NO_MODEL_MODE or Path(check["model_dir"]) != Path(core.MODEL_DIR):
            next_step = "reopen"
        else:
            next_step = "none"
        return jsonify({"ok": True, "next": next_step, "check": check})


def wait_until_up(port: int, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if running_instance(port):
            return True
        time.sleep(0.2)
    return False


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="radio-translate", description=APP_NAME)
    parser.add_argument("--port", type=int, help=f"port web lokal (default {DEFAULT_PORT})")
    parser.add_argument("--host", help="alamat listen (default 0.0.0.0)")
    parser.add_argument("--data-dir", help="folder model, rekaman, setelan & log")
    parser.add_argument("--no-browser", action="store_true", help="jangan buka browser")
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir or os.environ.get("RADIO_DATA_DIR") or default_data_dir()).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    if is_frozen():
        (data_dir / "models").mkdir(exist_ok=True)
    config_path = load_config(data_dir)

    port = args.port or int(os.environ.get("RADIO_PORT", DEFAULT_PORT))
    host = args.host or os.environ.get("RADIO_HOST", "0.0.0.0")
    browser_mode = "none" if args.no_browser else os.environ.get("RADIO_BROWSER", "app").strip().lower()

    # Sebelum membuka file log: instance yang sedang jalan masih menulis ke sana.
    if running_instance(port):
        say(f"Aplikasi sudah jalan di port {port}; membuka jendelanya saja.")
        open_browser(f"http://localhost:{port}/", browser_mode)
        return 0

    log_path = setup_logging(data_dir)
    say(f"{APP_NAME} {APP_VERSION}")
    say(f"Folder data : {data_dir}")
    say(f"Setelan     : {config_path}")
    say(f"Log         : {log_path}")

    if port in CHROME_BLOCKED_PORTS:
        show_error(f"Port {port} ditolak Chrome/Edge (port tidak aman). Ganti RADIO_PORT di {config_path}.")
        return 1
    if not port_is_free(host, port):
        requested = port
        port = next((p for p in range(requested + 1, requested + 20)
                     if p not in CHROME_BLOCKED_PORTS and port_is_free(host, p)), 0)
        if not port:
            show_error(f"Port {requested} dipakai program lain. Ganti RADIO_PORT di {config_path}.")
            return 1
        say(f"Port {requested} dipakai program lain, memakai port {port}. "
            f"(Radio V2 perlu dipasangkan ulang di port baru; atur RADIO_PORT di setelan.)")

    os.environ["RADIO_DATA_DIR"] = str(data_dir)
    os.environ["YALI_SKIP_BOOTSTRAP"] = "1"
    os.environ["YALI_PORT"] = str(port)
    if "YALI_NO_MODEL" not in os.environ and importlib.util.find_spec("faster_whisper") is None:
        # Versi tanpa paket AI (installer Lite / uv tanpa --extra ai).
        os.environ["YALI_NO_MODEL"] = "1"
        say("Paket AI tidak terpasang: jalan dalam MODE TANPA MODEL.")

    sys.path.insert(0, str(code_dir()))
    # pydub 0.25 memakai regex lama yang memicu SyntaxWarning di Python 3.12+.
    warnings.filterwarnings("ignore", category=SyntaxWarning)
    try:
        import app_faster_whisper_lokal as core
    except Exception as exc:
        show_error(f"Gagal memuat aplikasi: {exc}\n\nLihat log: {log_path}")
        raise

    register_app_routes(core, data_dir, config_path, log_path)
    core.prepare_runtime()
    say(f"Folder model: {core.MODEL_DIR}")

    url = f"http://localhost:{port}/"
    threading.Thread(
        target=lambda: wait_until_up(port) and open_browser(url, browser_mode),
        daemon=True,
    ).start()

    from waitress import serve
    say(f"Server jalan di {url}  (tutup dengan tombol 'Tutup Aplikasi' atau Ctrl+C)")
    try:
        # /record-radio menahan satu thread selama rekaman; sisanya untuk polling UI.
        serve(core.app, host=host, port=port, threads=24, ident=APP_NAME, _quiet=True)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            core.stop_all_radio_sources()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
