# -*- coding: utf-8 -*-
"""
Mode Live: radio didengarkan terus dan setiap ucapan (satu siklus PTT) langsung
ditranskrip & diterjemahkan, tanpa menunggu sesi rekam selesai.

Dua thread per sesi:
  - capture: memotong audio radio per PTT (fungsi VOX yang sudah ada) dan
    memasukkan tiap ucapan ke antrian. Tidak pernah menunggu GPU, jadi ucapan
    berikutnya tetap tertangkap walau ucapan sebelumnya masih diproses.
  - worker : mengambil ucapan dari antrian, menjalankan `process` (Whisper ->
    terjemahan -> simpan ke database) lalu menaruh hasilnya di `items`.

Saat dihentikan, ucapan yang sudah masuk antrian tetap diselesaikan dulu.
UI mengambil hasil baru dengan polling `snapshot(after=<id terakhir>)`.
Modul ini tidak tahu apa-apa soal model/radio: semuanya disuntikkan lewat
`capture` dan `process`, sehingga bisa diuji tanpa model AI maupun radio.
"""

from __future__ import annotations

import queue
import threading
import time
import traceback
from collections import deque
from typing import Callable, Optional

# capture(on_segment, cancel_event): blok sampai cancel_event di-set; boleh raise
# bila sumber radio terputus. on_segment(segment, sample_rate) dipanggil per ucapan.
Capture = Callable[[Callable[[object, int], None], threading.Event], object]
# process(segment, sample_rate, context) -> dict hasil, atau None bila ucapan dilewati
# (mis. terlalu pelan setelah dibersihkan). context = {"heard_at", "meta"}.
Process = Callable[[object, int, dict], Optional[dict]]


class LiveSession:
    def __init__(self, max_items: int = 200, max_queue: int = 32):
        self._lock = threading.Lock()
        self._items: deque = deque(maxlen=max_items)
        self._max_queue = max_queue
        self._queue: queue.Queue = queue.Queue(maxsize=max_queue)
        self._next_id = 1
        self._cancel = threading.Event()
        self._capture_done = threading.Event()
        self._finished = threading.Event()
        self._finished.set()
        self.running = False
        self.processing = False
        self.info: dict = {}
        self.error: Optional[str] = None
        self.started_at: Optional[float] = None
        self.stats = self._empty_stats()

    @staticmethod
    def _empty_stats() -> dict:
        return {"heard": 0, "done": 0, "skipped": 0, "dropped": 0, "failed": 0, "last_latency_sec": None}

    # ---------- kontrol sesi ----------
    def start(self, capture: Capture, process: Process, info: Optional[dict] = None,
              on_finish: Optional[Callable[[], None]] = None) -> bool:
        """Mulai sesi baru. False bila sesi sebelumnya belum selesai."""
        with self._lock:
            if not self._finished.is_set():
                return False
            self._finished.clear()
            self._cancel.clear()
            self._capture_done.clear()
            self._queue = queue.Queue(maxsize=self._max_queue)
            self.running = True
            self.processing = False
            self.info = dict(info or {})
            self.error = None
            self.started_at = time.time()
            self.stats = self._empty_stats()

        threading.Thread(target=self._capture_loop, args=(capture,), name="live-capture", daemon=True).start()
        threading.Thread(target=self._worker_loop, args=(process, on_finish), name="live-worker", daemon=True).start()
        return True

    def stop(self):
        """Berhenti mendengarkan. Ucapan yang sudah di antrian tetap diproses."""
        self._cancel.set()

    def wait_finished(self, timeout: Optional[float] = None) -> bool:
        return self._finished.wait(timeout)

    def update_meta(self, meta: dict):
        """Info radio terbaru dari UI (frekuensi, mode) untuk ucapan berikutnya."""
        if isinstance(meta, dict):
            with self._lock:
                self.info["meta"] = dict(meta)

    # ---------- hasil ----------
    def snapshot(self, after: int = 0) -> dict:
        with self._lock:
            items = [dict(item) for item in self._items if item["id"] > after]
            return {
                "running": self.running,
                "stopping": self.running and self._cancel.is_set(),
                "processing": self.processing,
                "queue": self._queue.qsize(),
                "info": {k: v for k, v in self.info.items() if k != "meta"},
                "error": self.error,
                "started_at": self.started_at,
                "stats": dict(self.stats),
                "last_id": self._next_id - 1,
                "items": items,
            }

    # ---------- thread ----------
    def _add_item(self, item: dict) -> dict:
        with self._lock:
            item["id"] = self._next_id
            self._next_id += 1
            self._items.append(item)
            return item

    def _on_segment(self, segment, sample_rate: int):
        with self._lock:
            context = {"heard_at": time.time(), "meta": dict(self.info.get("meta") or {})}
            self.stats["heard"] += 1
        try:
            self._queue.put_nowait((segment, int(sample_rate), context))
        except queue.Full:
            with self._lock:
                self.stats["dropped"] += 1
            self._add_item({
                "at": context["heard_at"],
                "error": "Antrian penuh: ucapan ini dilewati karena proses tertinggal terlalu jauh.",
            })

    def _capture_loop(self, capture: Capture):
        try:
            capture(self._on_segment, self._cancel)
        except Exception as exc:
            traceback.print_exc()
            with self._lock:
                self.error = str(exc) or exc.__class__.__name__
        finally:
            self._cancel.set()
            self._capture_done.set()

    def _worker_loop(self, process: Process, on_finish: Optional[Callable[[], None]]):
        try:
            while True:
                try:
                    segment, sample_rate, context = self._queue.get(timeout=0.2)
                except queue.Empty:
                    if self._capture_done.is_set():
                        break
                    continue
                self.processing = True
                try:
                    result = process(segment, sample_rate, context)
                except Exception as exc:
                    traceback.print_exc()
                    with self._lock:
                        self.stats["failed"] += 1
                    self._add_item({"at": context["heard_at"], "error": f"Gagal memproses ucapan: {exc}"})
                    continue
                finally:
                    self.processing = False
                if result is None:
                    with self._lock:
                        self.stats["skipped"] += 1
                    continue
                latency = time.time() - context["heard_at"]
                with self._lock:
                    self.stats["done"] += 1
                    self.stats["last_latency_sec"] = round(latency, 2)
                self._add_item({**result, "at": context["heard_at"], "latency_sec": round(latency, 2)})
        finally:
            with self._lock:
                self.running = False
                self.processing = False
            try:
                if on_finish:
                    on_finish()
            finally:
                self._finished.set()
