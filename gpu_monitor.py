# -*- coding: utf-8 -*-
"""
Pemantau GPU NVIDIA untuk UI dan log: beban (%), VRAM terpakai/total, suhu, daya.

Memakai `nvidia-smi` yang ikut terpasang bersama driver NVIDIA (tanpa paket
tambahan) dalam mode streaming (`-lms`): satu proses terus mengirim satu baris
per interval, bukan memanggil nvidia-smi berulang kali. Proses itu hanya hidup
selama ada yang meminta data (UI membuka Mode Live); 30 detik tanpa permintaan
ia dihentikan lagi.

Beban GPU saat inferensi berupa lonjakan pendek (sepersekian detik per ucapan),
jadi selain nilai terakhir juga disimpan puncak beberapa detik terakhir.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Optional

FIELDS = ("index", "name", "utilization.gpu", "memory.used", "memory.total", "temperature.gpu", "power.draw")
INTERVAL_MS = 500
PEAK_WINDOW_SEC = 6.0
IDLE_STOP_SEC = 30.0


def find_nvidia_smi() -> Optional[str]:
    found = shutil.which("nvidia-smi")
    if found:
        return found
    if os.name == "nt":
        for candidate in (
            Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe",
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe",
        ):
            if candidate.is_file():
                return str(candidate)
    return None


def _number(text: str) -> Optional[float]:
    try:
        return float(text)
    except ValueError:
        return None  # "[N/A]" di beberapa GPU laptop


def parse_line(line: str) -> Optional[dict]:
    parts = [p.strip() for p in line.split(",")]
    if len(parts) != len(FIELDS):
        return None
    index, name, util, used, total, temp, power = parts
    return {
        "index": int(index) if index.isdigit() else None,
        "name": name,
        "util": _number(util),
        "mem_used_mb": _number(used),
        "mem_total_mb": _number(total),
        "temp_c": _number(temp),
        "power_w": _number(power),
    }


class GpuMonitor:
    def __init__(self):
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen] = None
        self._latest: Optional[dict] = None
        self._history: deque = deque()
        self._last_request = 0.0
        self._error: Optional[str] = None
        self.smi = find_nvidia_smi()
        self.index: Optional[int] = None   # GPU yang dipantau = GPU yang dipakai model

    def set_index(self, index: Optional[int]):
        """Pantau GPU lain (mis. setelah pilihan perangkat AI diganti)."""
        with self._lock:
            if index == self.index:
                return
            self.index = index
            self._latest = None
            self._history.clear()
            proc, self._proc = self._proc, None
        if proc is not None:
            try:
                proc.terminate()
            except Exception:
                pass

    def snapshot(self) -> dict:
        """Data terbaru (dan menyalakan pemantauan bila belum jalan)."""
        with self._lock:
            self._last_request = time.monotonic()
            if self.smi and self._proc is None and not self._error:
                self._start()
            latest = dict(self._latest) if self._latest else None
            now = time.monotonic()
            peak = max((util for at, util in self._history if now - at <= PEAK_WINDOW_SEC and util is not None),
                       default=None)
        if latest:
            latest["util_peak"] = peak
        return {"available": bool(self.smi) and not self._error, "error": self._error, "gpu": latest}

    def latest(self) -> Optional[dict]:
        """Data terakhir tanpa menyalakan pemantauan (untuk baris log)."""
        with self._lock:
            return dict(self._latest) if self._latest else None

    def _start(self):
        args = [self.smi, f"--query-gpu={','.join(FIELDS)}", "--format=csv,noheader,nounits", f"-lms={INTERVAL_MS}"]
        if self.index is not None:
            args.append(f"--id={self.index}")
        flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW: tanpa jendela konsol berkedip
        try:
            self._proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                          text=True, creationflags=flags)
        except OSError as exc:
            self._error = f"nvidia-smi tidak bisa dijalankan: {exc}"
            return
        threading.Thread(target=self._read_loop, args=(self._proc,), name="gpu-monitor", daemon=True).start()

    def _read_loop(self, proc: subprocess.Popen):
        try:
            for line in proc.stdout:
                sample = parse_line(line)
                if sample is None or (self.index is not None and sample["index"] not in (None, self.index)):
                    continue
                now = time.monotonic()
                with self._lock:
                    self._latest = {**sample, "at": time.time()}
                    self._history.append((now, sample["util"]))
                    while self._history and now - self._history[0][0] > PEAK_WINDOW_SEC:
                        self._history.popleft()
                    idle = now - self._last_request > IDLE_STOP_SEC
                if idle:
                    break
        except Exception as exc:
            print(f"[GPU] Pemantauan nvidia-smi berhenti: {exc}", file=sys.stderr)
        finally:
            try:
                proc.terminate()
            except Exception:
                pass
            with self._lock:
                if self._proc is proc:
                    self._proc = None
                    if self._latest is None and not self._error:
                        self._error = "nvidia-smi tidak mengirim data."
