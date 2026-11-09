# -*- coding: utf-8 -*-
"""
Pilihan perangkat untuk model AI (Whisper & terjemahan): GPU NVIDIA tertentu,
otomatis, atau CPU.

- Deteksi GPU NVIDIA lewat `nvidia-smi` (ikut driver; jalan juga sebelum torch
  dimuat dan di mode tanpa model). Indeksnya sama dengan indeks CUDA karena
  aplikasi memasang CUDA_DEVICE_ORDER=PCI_BUS_ID sebelum torch dimuat.
- GPU lain (mis. Intel bawaan laptop) hanya ditampilkan: CUDA/CTranslate2 tidak
  bisa memakainya; GPU itu dipakai browser untuk tampilan.
- Otomatis = GPU NVIDIA dengan VRAM terbesar, atau CPU bila tidak ada.
- Pilihan disimpan di device-settings.json; YALI_DEVICE di radio-translate.env
  (auto | cpu | cuda:N) mengalahkannya.

Ganti GPU tidak perlu build/konversi ulang: model Whisper dan hasil konversi
`-ct2` tidak terikat ke GPU tertentu; tipe hitung dipilih saat model dimuat
sesuai kemampuan GPU (pick_compute_type).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Iterable, List, Optional

CHOICE_RE = re.compile(r"^(auto|cpu|cuda:\d+)$")
NO_WINDOW = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW: tanpa konsol berkedip


def valid_choice(choice) -> bool:
    return isinstance(choice, str) and bool(CHOICE_RE.match(choice.strip().lower()))


def parse_nvidia_list(text: str) -> List[dict]:
    """Keluaran `nvidia-smi --query-gpu=index,name,memory.total,compute_cap --format=csv,noheader,nounits`."""
    gpus = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 4 or not parts[0].isdigit():
            continue
        index, name, memory, capability = parts
        try:
            vram_mb = float(memory)
        except ValueError:
            vram_mb = None
        gpus.append({"index": int(index), "name": name, "vram_mb": vram_mb,
                     "compute_cap": capability if re.match(r"^\d+\.\d+$", capability) else None})
    return gpus


def list_nvidia_gpus(smi: Optional[str]) -> List[dict]:
    if not smi:
        return []
    try:
        out = subprocess.run([smi, "--query-gpu=index,name,memory.total,compute_cap", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10, creationflags=NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        return []
    return parse_nvidia_list(out.stdout) if out.returncode == 0 else []


def list_other_gpus() -> List[str]:
    """Nama semua kartu grafis menurut Windows (untuk menampilkan GPU Intel/AMD)."""
    if os.name != "nt":
        return []
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }"],
            capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        return []
    names = [line.strip() for line in out.stdout.splitlines() if line.strip()]
    return [name for name in names if "nvidia" not in name.lower()]


def auto_pick(gpus: Iterable[dict]) -> Optional[int]:
    """GPU NVIDIA dengan VRAM terbesar (indeks terkecil bila sama), atau None."""
    best = None
    for gpu in gpus:
        if best is None or (gpu.get("vram_mb") or 0) > (best.get("vram_mb") or 0):
            best = gpu
    return best["index"] if best else None


def resolve_choice(choice: str, cuda_count: int, vram_by_index: dict) -> Optional[int]:
    """Indeks CUDA yang dipakai untuk pilihan ini, atau None untuk CPU."""
    choice = (choice or "auto").strip().lower()
    if choice == "cpu" or cuda_count <= 0:
        return None
    if choice.startswith("cuda:"):
        index = int(choice.split(":", 1)[1])
        if index < cuda_count:
            return index
    return auto_pick({"index": i, "vram_mb": vram_by_index.get(i, 0)} for i in range(cuda_count))


def pick_compute_type(supported: Iterable[str], preferred: Optional[str], device: str) -> str:
    """Tipe hitung CTranslate2 yang didukung perangkat: pilihan pengguna bila didukung,
    selain itu yang tercepat (GPU lama tanpa fp16 jatuh ke int8 atau float32)."""
    supported = set(supported)
    order = ["int8_float16", "int8", "float16", "float32"] if device == "cuda" else ["int8", "float32"]
    for compute in ([preferred] if preferred else []) + order:
        if compute in supported:
            return compute
    return "float32"


class DeviceSettings:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.choice = "auto"
        try:
            saved = json.loads(self.path.read_text(encoding="utf-8")).get("device")
            if valid_choice(saved):
                self.choice = saved.strip().lower()
        except (OSError, ValueError, AttributeError):
            pass
        env = os.environ.get("YALI_DEVICE", "").strip().lower()
        self.locked_by_env = valid_choice(env)
        if self.locked_by_env:
            self.choice = env

    def save(self, choice: str):
        if not valid_choice(choice):
            raise ValueError(f"Pilihan perangkat tidak dikenal: {choice!r}")
        self.choice = choice.strip().lower()
        self.path.write_text(json.dumps({"device": self.choice}, indent=1), encoding="utf-8")
