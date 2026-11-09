# -*- coding: utf-8 -*-
"""
Update otomatis dari GitHub Releases.

Kanal update = rilis GitHub (tag vX.Y.Z), bukan setiap commit: pengguna hanya
menerima versi yang memang sudah dirilis (lihat RILIS.md). Cara memasang:

  - Folder hasil `git clone` (ada .git/) dan git terpasang: `git pull --ff-only`.
  - Folder hasil download ZIP: unduh ZIP rilis dari GitHub lalu timpa file kode.
    File & folder data pengguna (PRESERVE) tidak pernah disentuh; file yang
    ditimpa disalin dulu ke update-backup/<versi lama>/.
  - Installer (.exe/.app): tidak diperbarui di tempat; pengguna diarahkan ke
    halaman rilis untuk mengunduh installer baru.

Update baru dipakai setelah aplikasi dibuka ulang lewat script Jalankan-*, yang
sekalian menyesuaikan dependency bila uv.lock berubah.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

DEFAULT_REPO = "sanadunt/radio-translate-papua"
ALLOWED_HOSTS = {"api.github.com", "codeload.github.com", "github.com"}
MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024
BACKUP_DIR = "update-backup"

# Data pengguna di folder aplikasi: tidak pernah ditimpa oleh update.
PRESERVE = {
    ".git", ".venv", "models", "logs", "rekaman_radio", "radio-translate.env", "live-settings.json",
    BACKUP_DIR, "__pycache__", "virtual_env_papua", "build", "dist", "node_modules",
}
PRESERVE_PATTERNS = (re.compile(r"^whisper-.*"), re.compile(r"^best_bleu_.*"))

VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


class UpdateError(Exception):
    """Kegagalan dengan pesan yang bisa ditampilkan ke operator."""


def parse_version(text):
    match = VERSION_RE.match(str(text or "").strip())
    return tuple(int(part) for part in match.groups()) if match else None


def is_newer(candidate, current) -> bool:
    new, old = parse_version(candidate), parse_version(current)
    return bool(new and old and new > old)


def is_preserved(relative: PurePosixPath) -> bool:
    first = relative.parts[0] if relative.parts else ""
    return first in PRESERVE or any(p.match(first) for p in PRESERVE_PATTERNS)


def install_mode(app_dir: Path, frozen: bool) -> str:
    if frozen:
        return "installer"
    # git pull hanya bila folder hasil clone DAN git terpasang; host tanpa git
    # (mis. folder .git ikut tersalin dari komputer lain) tetap bisa update lewat ZIP.
    if (Path(app_dir) / ".git").is_dir() and shutil.which("git"):
        return "git"
    return "zip"


def _check_url(url: str):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or (parsed.hostname or "") not in ALLOWED_HOSTS:
        raise UpdateError(f"Alamat unduhan tidak diizinkan: {url}")


def _open(url: str, timeout: float):
    _check_url(url)
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "RadioTranslatePapua-updater",
    })
    response = urllib.request.urlopen(request, timeout=timeout)
    _check_url(response.geturl())  # setelah redirect (codeload.github.com)
    return response


def check_latest(repo: str = DEFAULT_REPO, timeout: float = 8.0) -> dict:
    """Rilis terbaru di GitHub: {tag, version, name, notes, zip_url, html_url, published_at}."""
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    try:
        with _open(url, timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise UpdateError("Belum ada rilis di GitHub, atau repo masih privat.") from exc
        if exc.code == 403:
            raise UpdateError("Batas permintaan GitHub tercapai; coba lagi nanti.") from exc
        raise UpdateError(f"GitHub menjawab HTTP {exc.code}.") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise UpdateError(f"Tidak bisa menghubungi GitHub ({exc}).") from exc
    tag = data.get("tag_name") or ""
    version = parse_version(tag)
    if not version:
        raise UpdateError(f"Tag rilis terbaru tidak berformat vX.Y.Z: {tag!r}")
    return {
        "tag": tag,
        "version": ".".join(map(str, version)),
        "name": data.get("name") or tag,
        "notes": (data.get("body") or "").strip(),
        "zip_url": data.get("zipball_url") or f"https://api.github.com/repos/{repo}/zipball/{tag}",
        "html_url": data.get("html_url") or f"https://github.com/{repo}/releases/tag/{tag}",
        "published_at": data.get("published_at"),
    }


def download(url: str, dest: Path, timeout: float = 60.0) -> Path:
    total = 0
    with _open(url, timeout) as response, open(dest, "wb") as out:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_DOWNLOAD_BYTES:
                raise UpdateError("Unduhan update terlalu besar.")
            out.write(chunk)
    if not zipfile.is_zipfile(dest):
        raise UpdateError("Unduhan update bukan file ZIP yang valid.")
    return dest


def apply_zip(zip_path: Path, app_dir: Path, backup_root: Path) -> list:
    """Timpa file kode dengan isi ZIP rilis GitHub (<owner>-<repo>-<sha>/...).

    Mengembalikan daftar path yang ditulis. File lama yang ditimpa disalin dulu
    ke backup_root. File data pengguna (PRESERVE) dilewati.
    """
    app_dir = Path(app_dir).resolve()
    written = []
    with zipfile.ZipFile(zip_path) as archive:
        entries = [e for e in archive.infolist() if not e.is_dir()]
        roots = {PurePosixPath(e.filename).parts[0] for e in entries}
        if len(roots) != 1:
            raise UpdateError("Isi ZIP update tidak dikenali (bukan arsip rilis GitHub).")
        if not any(PurePosixPath(e.filename).parts[1:] == ("radio_launcher.py",) for e in entries):
            raise UpdateError("ZIP update tidak berisi radio_launcher.py.")
        for entry in entries:
            relative = PurePosixPath(*PurePosixPath(entry.filename).parts[1:])
            if not relative.parts or ".." in relative.parts or relative.is_absolute():
                continue
            if is_preserved(relative):
                continue
            target = (app_dir / Path(*relative.parts)).resolve()
            if app_dir not in target.parents:
                continue
            data = archive.read(entry)
            if target.is_file():
                if target.read_bytes() == data:
                    continue
                backup = backup_root / Path(*relative.parts)
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, backup)
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".update-tmp")
            tmp.write_bytes(data)
            mode = (entry.external_attr >> 16) & 0o777
            if mode & 0o111:
                os.chmod(tmp, mode | 0o644)
            os.replace(tmp, target)
            written.append(str(relative))
    return written


def apply_git(app_dir: Path, timeout: float = 120.0) -> str:
    git = shutil.which("git")
    if not git:
        raise UpdateError("Folder ini hasil git clone tapi git tidak ditemukan; jalankan `git pull` sendiri.")
    result = subprocess.run([git, "-C", str(app_dir), "pull", "--ff-only"],
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()[-1:] or ["git pull gagal"]
        raise UpdateError(f"git pull gagal: {detail[0]} (ada perubahan lokal? jalankan git status).")
    return result.stdout.strip()


def install_update(app_dir: Path, current_version: str, latest: dict, frozen: bool) -> dict:
    mode = install_mode(app_dir, frozen)
    if mode == "installer":
        raise UpdateError(f"Versi installer: unduh installer baru di {latest['html_url']}")
    if mode == "git":
        return {"mode": mode, "output": apply_git(app_dir)}
    backup_root = Path(app_dir) / BACKUP_DIR / f"v{current_version}"
    with tempfile.TemporaryDirectory(prefix="radio-update-") as tmp:
        zip_path = download(latest["zip_url"], Path(tmp) / "update.zip")
        written = apply_zip(zip_path, Path(app_dir), backup_root)
    return {"mode": mode, "written": written, "backup": str(backup_root)}
