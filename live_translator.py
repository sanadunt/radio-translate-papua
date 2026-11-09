# -*- coding: utf-8 -*-
"""
Mode Live: radio didengarkan terus dan setiap ucapan (satu siklus PTT) langsung
ditranskrip & diterjemahkan, tanpa menunggu sesi rekam selesai.

Tiga thread per sesi, dihubungkan antrian:
  - capture : memotong audio radio per PTT (fungsi VOX yang sudah ada) dan
    memasukkan tiap ucapan ke antrian. Tidak pernah menunggu GPU, jadi ucapan
    berikutnya tetap tertangkap walau ucapan sebelumnya masih diproses.
  - stt     : `process` (bersihkan audio -> Whisper). Hasilnya langsung tampil
    sebagai item (teks Papua) dengan `pending: True`.
  - mt      : `translate` (terjemahan -> simpan). Melengkapi item yang sama.
    Karena terpisah dari stt, ucapan berikutnya sudah ditranskrip selagi ucapan
    sebelumnya diterjemahkan.
Tanpa `translate`, stt langsung menghasilkan item lengkap (dua thread saja).

Saat dihentikan, ucapan yang sudah masuk antrian tetap diselesaikan dulu.
UI mengambil perubahan dengan polling `snapshot(after=<rev terakhir>)`: item
baru maupun item yang baru dilengkapi punya `rev` lebih besar.
Kunci hasil yang diawali "_" (mis. audio) hanya untuk tahap berikutnya dan
tidak pernah dikirim ke UI. Modul ini tidak tahu apa-apa soal model/radio:
semuanya disuntikkan, sehingga bisa diuji tanpa model AI maupun radio.
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
# translate(result, context) -> dict tambahan untuk item yang sama.
Translate = Callable[[dict, dict], Optional[dict]]

_STOP = object()


class LiveSession:
    def __init__(self, max_items: int = 200, max_queue: int = 32):
        self._lock = threading.Lock()
        self._items: deque = deque(maxlen=max_items)
        self._max_queue = max_queue
        self._queue: queue.Queue = queue.Queue(maxsize=max_queue)
        self._mt_queue: queue.Queue = queue.Queue()
        self._next_id = 1
        self._rev = 0
        self._cancel = threading.Event()
        self._finished = threading.Event()
        self._finished.set()
        self.running = False
        self.stt_busy = False
        self.mt_busy = False
        self.info: dict = {}
        self.error: Optional[str] = None
        self.started_at: Optional[float] = None
        self.stats = self._empty_stats()

    @property
    def processing(self) -> bool:
        return self.stt_busy or self.mt_busy

    @staticmethod
    def _empty_stats() -> dict:
        return {"heard": 0, "transcribed": 0, "done": 0, "skipped": 0, "dropped": 0, "failed": 0,
                "last_latency_sec": None, "last_stt_sec": None, "last_mt_sec": None}

    # ---------- kontrol sesi ----------
    def start(self, capture: Capture, process: Process, info: Optional[dict] = None,
              on_finish: Optional[Callable[[], None]] = None, translate: Optional[Translate] = None) -> bool:
        """Mulai sesi baru. False bila sesi sebelumnya belum selesai."""
        with self._lock:
            if not self._finished.is_set():
                return False
            self._finished.clear()
            self._cancel.clear()
            self._queue = queue.Queue(maxsize=self._max_queue)
            self._mt_queue = queue.Queue()
            self.running = True
            self.stt_busy = self.mt_busy = False
            self.info = dict(info or {})
            self.error = None
            self.started_at = time.time()
            self.stats = self._empty_stats()

        capture_done = threading.Event()
        stt_done = threading.Event()
        mt_done = threading.Event()
        if translate is None:
            mt_done.set()
        threading.Thread(target=self._capture_loop, args=(capture, capture_done), name="live-capture", daemon=True).start()
        threading.Thread(target=self._stt_loop, args=(process, translate, capture_done, stt_done),
                         name="live-stt", daemon=True).start()
        if translate is not None:
            threading.Thread(target=self._mt_loop, args=(translate, mt_done), name="live-mt", daemon=True).start()
        threading.Thread(target=self._finish_when_done, args=(stt_done, mt_done, on_finish),
                         name="live-finish", daemon=True).start()
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
        """Status sesi + item yang baru atau berubah sejak rev `after`."""
        with self._lock:
            items = [{k: v for k, v in item.items() if not k.startswith("_")}
                     for item in self._items if item["rev"] > after]
            return {
                "running": self.running,
                "stopping": self.running and self._cancel.is_set(),
                "processing": self.processing,
                "stt_busy": self.stt_busy,
                "mt_busy": self.mt_busy,
                "queue": self._queue.qsize() + self._mt_queue.qsize(),
                "queue_stt": self._queue.qsize(),
                "queue_mt": self._mt_queue.qsize(),
                "info": {k: v for k, v in self.info.items() if k != "meta"},
                "error": self.error,
                "started_at": self.started_at,
                "stats": dict(self.stats),
                "rev": self._rev,
                "items": items,
            }

    # ---------- thread ----------
    def _add_item(self, item: dict) -> dict:
        with self._lock:
            item["id"] = self._next_id
            self._next_id += 1
            self._rev += 1
            item["rev"] = self._rev
            self._items.append(item)
            return item

    def _update_item(self, item: dict, patch: dict):
        with self._lock:
            item.update(patch)
            for key in [k for k in item if k.startswith("_")]:
                del item[key]  # audio dsb. tidak dibutuhkan lagi setelah tahap terakhir
            self._rev += 1
            item["rev"] = self._rev

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

    def _capture_loop(self, capture: Capture, capture_done: threading.Event):
        try:
            capture(self._on_segment, self._cancel)
        except Exception as exc:
            traceback.print_exc()
            with self._lock:
                self.error = str(exc) or exc.__class__.__name__
        finally:
            self._cancel.set()
            capture_done.set()

    def _stt_loop(self, process: Process, translate: Optional[Translate],
                  capture_done: threading.Event, stt_done: threading.Event):
        try:
            while True:
                try:
                    segment, sample_rate, context = self._queue.get(timeout=0.2)
                except queue.Empty:
                    if capture_done.is_set():
                        break
                    continue
                self.stt_busy = True
                started = time.time()
                try:
                    result = process(segment, sample_rate, context)
                except Exception as exc:
                    traceback.print_exc()
                    with self._lock:
                        self.stats["failed"] += 1
                    self._add_item({"at": context["heard_at"], "error": f"Gagal memproses ucapan: {exc}"})
                    continue
                finally:
                    self.stt_busy = False
                if result is None:
                    with self._lock:
                        self.stats["skipped"] += 1
                    continue
                stt_sec = round(time.time() - started, 2)
                text_at = round(time.time() - context["heard_at"], 2)
                with self._lock:
                    self.stats["transcribed"] += 1
                    self.stats["last_stt_sec"] = stt_sec
                if translate is None:
                    with self._lock:
                        self.stats["done"] += 1
                        self.stats["last_latency_sec"] = text_at
                    self._add_item({**result, "at": context["heard_at"], "stt_sec": stt_sec, "latency_sec": text_at})
                    continue
                item = self._add_item({**result, "at": context["heard_at"], "stt_sec": stt_sec,
                                       "text_latency_sec": text_at, "pending": True})
                self._mt_queue.put((item, context))
        finally:
            self.stt_busy = False
            if translate is not None:
                self._mt_queue.put(_STOP)
            stt_done.set()

    def _mt_loop(self, translate: Translate, mt_done: threading.Event):
        try:
            while True:
                job = self._mt_queue.get()
                if job is _STOP:
                    break
                item, context = job
                self.mt_busy = True
                started = time.time()
                try:
                    patch = translate(dict(item), context) or {}
                except Exception as exc:
                    traceback.print_exc()
                    with self._lock:
                        self.stats["failed"] += 1
                    self._update_item(item, {"pending": False, "error": f"Gagal menerjemahkan: {exc}"})
                    continue
                finally:
                    self.mt_busy = False
                mt_sec = round(time.time() - started, 2)
                latency = round(time.time() - context["heard_at"], 2)
                with self._lock:
                    self.stats["done"] += 1
                    self.stats["last_mt_sec"] = mt_sec
                    self.stats["last_latency_sec"] = latency
                self._update_item(item, {**patch, "pending": False, "mt_sec": mt_sec, "latency_sec": latency})
        finally:
            self.mt_busy = False
            mt_done.set()

    def _finish_when_done(self, stt_done: threading.Event, mt_done: threading.Event,
                          on_finish: Optional[Callable[[], None]]):
        stt_done.wait()
        mt_done.wait()
        with self._lock:
            self.running = False
        try:
            if on_finish:
                on_finish()
        finally:
            self._finished.set()
