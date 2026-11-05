# -*- coding: utf-8 -*-
"""
Pemeriksaan folder model AI dan penulisan setelan untuk wizard "Model AI".

Tidak memuat model maupun torch: hanya memeriksa nama folder & file yang
dibutuhkan app_faster_whisper_lokal.py (WHISPER_MODEL_DIRS / MT_MODEL_DIRS),
supaya wizard bisa menunjukkan file apa saja yang kurang tanpa mengunduh apa pun.
"""

from __future__ import annotations

import platform
import shutil
import subprocess
from pathlib import Path

LANGUAGES = {"ambai": "Ambai", "biak": "Biak"}
DEFAULT_LANGUAGE = "ambai"

# Nama folder harus sama dengan app_faster_whisper_lokal.py.
MODEL_FOLDERS = {
    "ambai": {
        "whisper": "whisper-ambai-v2-10epochs-faster-whisper",
        "mt": "best_bleu_ambai",
    },
    "biak": {
        "whisper": "whisper-biak-v4-10epochs-faster-whisper",
        "mt": "best_bleu_biak",
    },
}
KIND_LABELS = {"whisper": "Suara → teks (Whisper)", "mt": "Terjemahan → Indonesia"}

# Setiap entri: satu nama file, atau tuple = salah satu dari nama itu cukup.
WHISPER_REQUIRED = ["model.bin", "config.json", "tokenizer.json", ("vocabulary.json", "vocabulary.txt")]
WHISPER_OPTIONAL = ["preprocessor_config.json"]
MT_FULL_REQUIRED = ["config.json", ("model.safetensors", "pytorch_model.bin"),
                    ("tokenizer.json", "sentencepiece.bpe.model"), "tokenizer_config.json"]
MT_FULL_OPTIONAL = ["generation_config.json", "special_tokens_map.json", "sentencepiece.bpe.model"]
# Adapter LoRA/PEFT: base model diunduh dari internet saat pertama dipakai.
MT_ADAPTER_REQUIRED = ["adapter_config.json", ("adapter_model.safetensors", "adapter_model.bin")]


def _label(entry) -> str:
    return " atau ".join(entry) if isinstance(entry, tuple) else entry


def _present(folder: Path, entry) -> bool:
    names = entry if isinstance(entry, tuple) else (entry,)
    return any((folder / name).is_file() for name in names)


def check_model_folder(base: Path, lang: str, kind: str) -> dict:
    name = MODEL_FOLDERS[lang][kind]
    folder = base / name
    report = {
        "lang": lang,
        "kind": kind,
        "label": KIND_LABELS[kind],
        "folder": name,
        "path": str(folder),
        "exists": folder.is_dir(),
        "ok": False,
        "missing": [],
        "missing_optional": [],
        "hint": None,
    }
    if not folder.is_dir():
        report["missing"] = [f"folder {name}"]
        return report

    if kind == "mt" and (folder / "adapter_config.json").is_file() and not (folder / "config.json").is_file():
        required, optional = MT_ADAPTER_REQUIRED, []
        report["hint"] = "Adapter LoRA: base model diunduh dari internet saat terjemahan pertama."
    elif kind == "mt":
        required, optional = MT_FULL_REQUIRED, MT_FULL_OPTIONAL
    else:
        required, optional = WHISPER_REQUIRED, WHISPER_OPTIONAL

    report["missing"] = [_label(e) for e in required if not _present(folder, e)]
    report["missing_optional"] = [_label(e) for e in optional if not _present(folder, e)]
    report["ok"] = not report["missing"]
    # Ekstrak zip dari Google Drive sering berlapis: <nama>/<nama>/model.bin
    if not report["ok"] and (folder / name).is_dir():
        report["hint"] = f"Folder berlapis: pindahkan isi {name}/{name}/ satu tingkat ke atas."
    return report


def resolve_model_dir(path: Path) -> Path:
    """Folder yang dipilih, atau subfolder models/ di dalamnya bila model ada di sana."""
    path = Path(path).expanduser()
    if not any((path / folders[k]).is_dir() for folders in MODEL_FOLDERS.values() for k in folders):
        if (path / "models").is_dir():
            return path / "models"
    return path


def check_model_dir(path) -> dict:
    base = resolve_model_dir(Path(path))
    languages = {}
    for lang, title in LANGUAGES.items():
        items = [check_model_folder(base, lang, kind) for kind in ("whisper", "mt")]
        languages[lang] = {"title": title, "ok": all(i["ok"] for i in items), "items": items}
    return {
        "model_dir": str(base),
        "exists": base.is_dir(),
        "languages": languages,
        # Bahasa default wajib lengkap supaya mode AI aktif; Biak boleh menyusul.
        "ready": languages[DEFAULT_LANGUAGE]["ok"],
    }


# ----------------------------------------------------------------------
# Setelan (radio-translate.env)
# ----------------------------------------------------------------------
def update_env_file(path: Path, updates: dict) -> None:
    """Ganti/menambah baris NAMA=nilai; nilai None menonaktifkan baris (diberi #).

    Baris yang sedang aktif diganti di tempat; kalau belum ada, baris contoh
    "# NAMA=..." dari template dipakai; selain itu ditambahkan di akhir.
    """
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    def key_of(line: str, commented: bool):
        text = line.strip()
        if commented:
            if not text.startswith("#"):
                return None
            text = text.lstrip("#").strip()
        elif text.startswith("#"):
            return None
        if "=" not in text:
            return None
        key = text.split("=", 1)[0].strip()
        return key[len("export "):].strip() if key.startswith("export ") else key

    for key, value in updates.items():
        new_line = f"{key}={value}" if value is not None else None
        active = [i for i, line in enumerate(lines) if key_of(line, False) == key]
        if active:
            # Baris aktif pertama diberi nilai baru (atau dinonaktifkan); duplikatnya dinonaktifkan.
            first, duplicates = active[0], active[1:]
            lines[first] = new_line if new_line is not None else f"# {lines[first].strip()}"
            for i in duplicates:
                lines[i] = f"# {lines[i].strip()}"
            continue
        if value is None:
            continue
        example = next((i for i, line in enumerate(lines) if key_of(line, True) == key), None)
        if example is not None:
            lines.insert(example + 1, new_line)
        else:
            lines.append(new_line)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ----------------------------------------------------------------------
# Dialog pilih folder (di komputer tempat server jalan)
# ----------------------------------------------------------------------
PICK_PROMPT = "Pilih folder model AI Radio Translate Papua"


def folder_picker_available() -> bool:
    system = platform.system()
    if system in ("Darwin", "Windows"):
        return True
    return bool(shutil.which("zenity") or shutil.which("kdialog"))


def pick_folder(timeout: float = 600.0):
    """Path folder yang dipilih, "" bila dibatalkan, None bila tidak ada dialog."""
    system = platform.system()
    if system == "Darwin":
        cmd = ["osascript", "-e", f'POSIX path of (choose folder with prompt "{PICK_PROMPT}")']
    elif system == "Windows":
        script = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true};"
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
            f"$d.Description = '{PICK_PROMPT}';"
            "[Console]::OutputEncoding = [Text.Encoding]::UTF8;"
            "if ($d.ShowDialog($owner) -eq 'OK') { Write-Output $d.SelectedPath }"
        )
        cmd = ["powershell", "-NoProfile", "-STA", "-Command", script]
    elif shutil.which("zenity"):
        cmd = ["zenity", "--file-selection", "--directory", f"--title={PICK_PROMPT}"]
    elif shutil.which("kdialog"):
        cmd = ["kdialog", "--getexistingdirectory", str(Path.home()), "--title", PICK_PROMPT]
    else:
        return None
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return ""
    return result.stdout.strip().rstrip("/\\") or ""
