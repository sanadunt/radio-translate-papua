# -*- coding: utf-8 -*-
"""
Jembatan audio HackRF WebUSB (Listener Kit di browser) ke backend.

HackRF WebUSB dipegang oleh browser, bukan oleh backend: halaman Set Radio
menerima audio VFO kit (receiver:audio, 48 kHz mono) lalu meneruskannya ke
POST /webusb/audio sebagai PCM16 -- HANYA selama "Rekam & Translate" /
"Rekam & Simpan" memakai perangkat HackRF WebUSB.

Antarmukanya subset Web888Client yang dipakai record_radio_web888()
(connected_snd, clear_audio, pop_audio, is_squelch_open,
get_audio_sample_rate, current_rms), jadi VOX, segmentasi per PTT, Whisper
dan terjemahan memakai jalur yang sama dengan Web-888 dan HackRF USB.
"""

from __future__ import annotations

from collections import deque
import os
import threading
import time
from typing import Deque, Optional

import numpy as np


class WebUSBAudioBridge:
    def __init__(self):
        self._lock = threading.Lock()
        self._chunks: Deque[np.ndarray] = deque()
        self._sample_count = 0
        self.audio_sample_rate = 48_000
        self.buffer_seconds = float(os.environ.get("WEBUSB_RECORD_BUFFER_SECONDS", "25"))
        # Tanpa kiriman audio selama ini, browser dianggap berhenti meneruskan.
        self.stale_after_sec = float(os.environ.get("WEBUSB_STALE_SECONDS", "2.0"))
        self.last_audio_ts = 0.0
        self.squelch_open = False
        self.current_rms = 0.0
        self.gap_count = 0

    @property
    def connected_snd(self) -> bool:
        return time.monotonic() - self.last_audio_ts < self.stale_after_sec

    def status(self):
        with self._lock:
            buffered = self._sample_count / float(self.audio_sample_rate)
        return {
            "connected": self.connected_snd,
            "sample_rate": self.audio_sample_rate,
            "buffered_sec": round(buffered, 3),
            "squelch_open": self.squelch_open,
            "gaps": self.gap_count,
        }

    def push(self, pcm16: bytes, sample_rate: int, squelch_open: bool, gap: bool = False):
        samples = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(samples * samples))) if samples.size else 0.0
        max_samples = max(int(sample_rate * self.buffer_seconds), 1)
        with self._lock:
            if int(sample_rate) != self.audio_sample_rate:
                # Rate berubah: audio lama tidak boleh tercampur dengan rate baru.
                self._chunks.clear()
                self._sample_count = 0
                self.audio_sample_rate = int(sample_rate)
            if samples.size:
                self._chunks.append(samples)
                self._sample_count += int(samples.size)
            while self._sample_count > max_samples and self._chunks:
                self._sample_count -= int(self._chunks.popleft().size)
            self.squelch_open = bool(squelch_open)
            self.current_rms = rms
            if gap:
                self.gap_count += 1
            self.last_audio_ts = time.monotonic()

    def clear_audio(self):
        with self._lock:
            self._chunks.clear()
            self._sample_count = 0

    def pop_audio(self, max_samples: Optional[int] = None) -> np.ndarray:
        with self._lock:
            arrays, taken = [], 0
            limit = None if max_samples is None else max(int(max_samples), 1)
            while self._chunks and (limit is None or taken < limit):
                arr = self._chunks.popleft()
                if limit is not None and taken + arr.size > limit:
                    cut = limit - taken
                    arrays.append(arr[:cut])
                    self._chunks.appendleft(arr[cut:])
                    taken += cut
                    break
                arrays.append(arr)
                taken += int(arr.size)
            self._sample_count = max(self._sample_count - taken, 0)
        if not arrays:
            return np.array([], dtype=np.float32)
        return np.concatenate(arrays).astype(np.float32, copy=False)

    def is_squelch_open(self) -> bool:
        return bool(self.squelch_open)

    def get_audio_sample_rate(self) -> int:
        return int(self.audio_sample_rate)
