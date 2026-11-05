# -*- coding: utf-8 -*-
"""
Client HackRF One lewat USB lokal (sumber radio alternatif selain Web-888).

Antarmuka kelas SENGAJA dibuat sama dengan Web888Client (start/stop/status,
set_frequency/set_mode, pop_audio/pop_monitor_audio, get_meter_level,
is_squelch_open, get_latest, ...) supaya app_faster_whisper_lokal.py bisa
memakai keduanya bergantian tanpa cabang kode khusus per perangkat --
termasuk record_radio_web888() untuk VOX/rekam dan /web888/audio-chunk
untuk monitor audio di browser.

Sumber IQ:
  - "hackrf": proses `hackrf_transfer -r -` (paket hackrf, mis.
    `brew install hackrf` di macOS / `apt install hackrf` di Linux) yang
    mengalirkan sampel IQ int8 mentah ke stdout. hackrf_transfer tidak bisa
    retune saat jalan, jadi:
      * frekuensi yang masih di dalam bentang sample rate cukup digeser
        secara digital (mixer NCO) -- instan, tanpa putus;
      * frekuensi di luar bentang -> proses di-restart di center baru
        (jeda ~0.5 dtk).
  - "sim": generator IQ sintetis (noise + pemancar NFM yang PTT on/off)
    untuk mencoba UI, waterfall, monitor & VOX TANPA perangkat HackRF.

DSP (semua numpy/scipy, tanpa GNU Radio):
  IQ @ sample_rate -> FFT spektrum (waterfall)
                   -> mixer ke baseband -> FIR + decimate ke 240 kHz
                   -> filter kanal (lebar = bandwidth) -> demod NFM/WFM/AM/USB/LSB
                   -> FIR + decimate ke audio 24 kHz
  Squelch adaptif: daya kanal dibanding noise floor (median bin FFT).
"""

from __future__ import annotations

from collections import deque
import os
import shutil
import subprocess
import sys
import threading
import time
from typing import Deque, Optional, Tuple

import numpy as np
from scipy.signal import firwin, lfilter, upfirdn


HACKRF_CHANNEL_RATE = 240_000   # rate tengah setelah decimate tahap 1
HACKRF_AUDIO_RATE = 24_000      # rate audio keluaran (mono float32)
HACKRF_FFT_SIZE = 4096
HACKRF_BLOCKS_PER_SEC = 20      # = SPECTRUM_TARGET_FPS di app


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return float(default)


class _FirDecimator:
    """FIR + decimate kontinu antar-blok (overlap-save lewat upfirdn).

    Panjang tiap blok input harus kelipatan `down` supaya fase decimation
    tidak bergeser dari blok ke blok.
    """

    def __init__(self, taps: np.ndarray, down: int, dtype=np.complex64):
        self.taps = taps.astype(np.float32)
        self.down = int(down)
        hist = len(self.taps) - 1
        self.hist_len = ((hist + self.down - 1) // self.down) * self.down
        self.hist = np.zeros(self.hist_len, dtype=dtype)

    def process(self, x: np.ndarray) -> np.ndarray:
        z = np.concatenate([self.hist, x])
        y = upfirdn(self.taps, z, down=self.down)
        first = self.hist_len // self.down
        out = y[first:first + len(x) // self.down]
        self.hist = z[-self.hist_len:] if self.hist_len else self.hist
        return out


def _hackrf_transfer_path() -> str:
    exe = shutil.which("hackrf_transfer")
    if not exe:
        raise RuntimeError(
            "Driver Radio V2 belum terpasang di server. Pasang dulu "
            "(macOS: brew install hackrf, Linux: sudo apt install hackrf), "
            "atau pakai Radio V2 · USB di browser yang tidak butuh driver."
        )
    return exe


class _HackRFTransferSource:
    """Baca IQ int8 dari `hackrf_transfer -r -`."""

    def __init__(self, center_hz: int, sample_rate: int, lna_gain: int, vga_gain: int, amp: bool):
        exe = _hackrf_transfer_path()
        cmd = [
            exe, "-r", "-",
            "-f", str(int(center_hz)),
            "-s", str(int(sample_rate)),
            "-l", str(int(lna_gain)),
            "-g", str(int(vga_gain)),
            "-a", "1" if amp else "0",
        ]
        self.proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0
        )
        self.stderr_tail: Deque[str] = deque(maxlen=8)
        threading.Thread(target=self._drain_stderr, daemon=True, name="hackrf-stderr").start()

    def _drain_stderr(self):
        for raw in iter(self.proc.stderr.readline, b""):
            line = raw.decode("utf-8", errors="ignore").strip()
            if line:
                self.stderr_tail.append(line)

    def read(self, n_samples: int) -> np.ndarray:
        need = n_samples * 2
        buf = bytearray()
        while len(buf) < need:
            chunk = self.proc.stdout.read(need - len(buf))
            if not chunk:
                detail = " | ".join(self.stderr_tail) or "proses berhenti"
                raise RuntimeError(f"Driver Radio V2 berhenti: {detail}")
            buf.extend(chunk)
        iq = np.frombuffer(bytes(buf), dtype=np.int8).astype(np.float32) / 128.0
        return (iq[0::2] + 1j * iq[1::2]).astype(np.complex64)

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(timeout=2.0)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass


class _SimulatedSource:
    """IQ sintetis real-time: noise + satu pemancar NFM yang PTT on/off.

    Pemancar ada di HACKRF_SIM_TX_HZ (default 155.7 MHz = frekuensi default
    panel), PTT HACKRF_SIM_ON_SEC detik nyala lalu HACKRF_SIM_OFF_SEC mati.
    """

    def __init__(self, center_hz: int, sample_rate: int, **_):
        self.center_hz = int(center_hz)
        self.sample_rate = int(sample_rate)
        self.tx_hz = _env_float("HACKRF_SIM_TX_HZ", 155_700_000)
        self.on_sec = _env_float("HACKRF_SIM_ON_SEC", 3.0)
        self.off_sec = _env_float("HACKRF_SIM_OFF_SEC", 3.0)
        self.n = 0
        self.t0 = time.monotonic()
        self.rng = np.random.default_rng()
        self.mod_phase = 0.0

    def read(self, n_samples: int) -> np.ndarray:
        sr = self.sample_rate
        # Jaga laju real-time seperti perangkat sungguhan.
        due = self.t0 + (self.n + n_samples) / sr
        delay = due - time.monotonic()
        if delay > 0:
            time.sleep(delay)

        t = (self.n + np.arange(n_samples)) / sr
        noise = (self.rng.standard_normal(n_samples) + 1j * self.rng.standard_normal(n_samples)) * 0.01
        out = noise.astype(np.complex64)

        offset = self.tx_hz - self.center_hz
        cycle = self.on_sec + self.off_sec
        if abs(offset) < sr / 2 and (t[0] % cycle) < self.on_sec:
            # "Suara" sintetis: dua nada yang amplitudonya naik-turun ala suku kata.
            audio = (
                np.sin(2 * np.pi * 440 * t) * 0.6
                + np.sin(2 * np.pi * 1250 * t) * 0.4
            ) * (0.55 + 0.45 * np.sin(2 * np.pi * 3.0 * t))
            deviation = 3000.0
            phase = self.mod_phase + 2 * np.pi * np.cumsum(offset + deviation * audio) / sr
            self.mod_phase = float(phase[-1] % (2 * np.pi))
            out = out + (0.3 * np.exp(1j * phase)).astype(np.complex64)
        else:
            self.mod_phase = float((self.mod_phase + 2 * np.pi * offset * n_samples / sr) % (2 * np.pi))

        self.n += n_samples
        return out

    def close(self):
        pass


class HackRFClient:
    """Satu HackRF One (atau simulasinya); antarmuka = Web888Client."""

    _MODES = {"fm": "nbfm", "nfm": "nbfm", "nbfm": "nbfm", "wfm": "wfm", "am": "am", "usb": "usb", "lsb": "lsb"}

    def __init__(self):
        self.lock = threading.RLock()

        self.simulate = False
        self.running = False
        self.connected_snd = False
        self.connected_wf = False
        self.audio_ready = False
        self.error: Optional[str] = None
        self._generation = 0
        self._thread: Optional[threading.Thread] = None

        self.sample_rate_hz = int(_env_float("HACKRF_SAMPLE_RATE", 2_400_000))
        self.lna_gain = int(_env_float("HACKRF_LNA_GAIN", 24))   # 0..40, langkah 8
        self.vga_gain = int(_env_float("HACKRF_VGA_GAIN", 20))   # 0..62, langkah 2
        self.amp = os.environ.get("HACKRF_AMP", "0").strip() == "1"
        # Target ditaruh sejauh ini dari center supaya tidak kena DC spike HackRF.
        self.lo_offset_hz = int(_env_float("HACKRF_LO_OFFSET_HZ", 200_000))

        self.freq_hz = 100_000_000
        self.center_hz = self.freq_hz + self.lo_offset_hz
        self.mode = "nbfm"
        self.bandwidth_hz = 12500

        self.audio_sample_rate = float(HACKRF_AUDIO_RATE)
        self.latest_db: Optional[np.ndarray] = None
        self.latest_ts = 0.0

        self._audio_chunks: Deque[np.ndarray] = deque()
        self._audio_lock = threading.Lock()
        self._audio_sample_count = 0
        self._monitor_chunks: Deque[np.ndarray] = deque()
        self._monitor_lock = threading.Lock()
        self._monitor_sample_count = 0
        self.audio_buffer_seconds = _env_float("HACKRF_RECORD_BUFFER_SECONDS", 25)
        self.monitor_buffer_seconds = _env_float("HACKRF_MONITOR_BUFFER_SECONDS", 0.4)

        self.current_rms = 0.0
        # Squelch adaptif: buka kalau daya kanal >= noise floor + SNR ini (dB).
        self.squelch_snr_db = _env_float("HACKRF_SQUELCH_SNR_DB", 10.0)
        self.squelch_hysteresis_db = _env_float("HACKRF_SQUELCH_HYSTERESIS_DB", 3.0)
        self.current_snr_db: Optional[float] = None
        self.current_channel_dbfs: Optional[float] = None
        self.squelch_open = False
        self.meter_ceil_snr_db = _env_float("HACKRF_METER_CEIL_SNR_DB", 40.0)
        self.monitor_closed_gain = _env_float("HACKRF_MONITOR_CLOSED_GAIN", 0.025)
        self._monitor_gain = self.monitor_closed_gain

        self._dsp_dirty = True

    # ------------------------------------------------------------------
    # Status dan lifecycle
    # ------------------------------------------------------------------
    def status(self):
        with self.lock:
            return {
                "running": self.running,
                "connected": bool(self.connected_snd or self.connected_wf),
                "connected_snd": self.connected_snd,
                "connected_wf": self.connected_wf,
                "audio_ready": self.audio_ready,
                "audio_sample_rate": self.audio_sample_rate,
                "error": self.error,
                "host": "simulasi" if self.simulate else "USB",
                "port": None,
                "simulate": self.simulate,
                "freq_hz": self.freq_hz,
                "center_freq_hz": self.center_hz,
                "mode": self.mode.upper(),
                "bandwidth_hz": self.bandwidth_hz,
                "sample_rate_hz": self.sample_rate_hz,
                "wf_span_hz": self.sample_rate_hz,
                "lna_gain": self.lna_gain,
                "vga_gain": self.vga_gain,
                "amp": self.amp,
                "squelch_snr_db": self.squelch_snr_db,
                "snr_db": self.current_snr_db,
                "smeter_dbm": self.current_channel_dbfs,
                "squelch_open": self.squelch_open,
            }

    @staticmethod
    def is_available() -> bool:
        return shutil.which("hackrf_transfer") is not None

    def start(self, simulate=False, freq_hz=None, mode=None, bandwidth_hz=None,
              lna_gain=None, vga_gain=None, amp=None, **_):
        if not simulate:
            _hackrf_transfer_path()  # gagal cepat dengan pesan instalasi yang jelas

        self.stop()
        with self.lock:
            self.simulate = bool(simulate)
            if freq_hz is not None:
                self.freq_hz = int(freq_hz)
            if mode:
                self.mode = self._normalize_mode(mode)
            if bandwidth_hz is not None:
                self.bandwidth_hz = max(int(bandwidth_hz), 500)
            if lna_gain is not None:
                self.lna_gain = int(max(0, min(40, int(lna_gain))) // 8 * 8)
            if vga_gain is not None:
                self.vga_gain = int(max(0, min(62, int(vga_gain))) // 2 * 2)
            if amp is not None:
                self.amp = bool(amp)
            self.center_hz = self.freq_hz + self.lo_offset_hz
            self._generation += 1
            generation = self._generation
            self.running = True
            self.error = None
            self._dsp_dirty = True

        self.clear_audio()
        self.clear_monitor_audio()
        self._thread = threading.Thread(
            target=self._run, args=(generation,), daemon=True, name="hackrf-rx"
        )
        self._thread.start()
        label = "simulasi" if simulate else "USB"
        print(f"[HACKRF] Mulai ({label}) di {self.freq_hz/1e6:.6f} MHz …", file=sys.stderr)

    def stop(self):
        with self.lock:
            self.running = False
            self._generation += 1
            thread = self._thread
            self._thread = None
        if thread and thread is not threading.current_thread() and thread.is_alive():
            thread.join(timeout=3.0)
        with self.lock:
            self.connected_snd = False
            self.connected_wf = False
            self.audio_ready = False
        self.clear_audio()
        self.clear_monitor_audio()

    def _active(self, generation: int) -> bool:
        with self.lock:
            return self.running and self._generation == generation

    # ------------------------------------------------------------------
    # Tuning
    # ------------------------------------------------------------------
    @classmethod
    def _normalize_mode(cls, mode) -> str:
        value = str(mode or "nbfm").strip().lower()
        return cls._MODES.get(value, "nbfm")

    def _needs_recenter_locked(self) -> bool:
        offset = abs(self.freq_hz - self.center_hz)
        usable = self.sample_rate_hz * 0.4 - self.bandwidth_hz
        return offset > usable or offset < 20_000

    def set_frequency(self, hz):
        with self.lock:
            self.freq_hz = int(hz)
            if self._needs_recenter_locked():
                self.center_hz = self.freq_hz + self.lo_offset_hz
            self._dsp_dirty = True
        self.clear_audio()

    def set_mode(self, mode, bandwidth_hz):
        with self.lock:
            self.mode = self._normalize_mode(mode)
            if bandwidth_hz:
                self.bandwidth_hz = max(int(bandwidth_hz), 500)
            self._dsp_dirty = True
        self.clear_audio()

    def set_wf_span_hz(self, span_hz):
        # Span = sample rate HackRF; zoom dilakukan di browser (crop), sama
        # seperti jalur rtl_tcp.
        return False

    def set_squelch(self, snr_db: float):
        """Ambang squelch adaptif (dB di atas noise floor), sama perannya dengan
        Web888Client.set_squelch (dBm)."""
        with self.lock:
            self.squelch_snr_db = float(snr_db)

    # ------------------------------------------------------------------
    # Buffer audio (sama persis dengan Web888Client)
    # ------------------------------------------------------------------
    def _push_bounded(self, chunks, lock, count_attr, seconds, samples):
        max_samples = max(int(self.audio_sample_rate * seconds), 1)
        with lock:
            chunks.append(samples)
            setattr(self, count_attr, getattr(self, count_attr) + int(samples.size))
            while getattr(self, count_attr) > max_samples and chunks:
                old = chunks.popleft()
                setattr(self, count_attr, getattr(self, count_attr) - int(old.size))

    def _drain(self, chunks, count_attr, max_samples):
        arrays, taken = [], 0
        limit = None if max_samples is None else max(int(max_samples), 1)
        while chunks and (limit is None or taken < limit):
            arr = chunks.popleft()
            if limit is not None and taken + arr.size > limit:
                cut = limit - taken
                arrays.append(arr[:cut])
                chunks.appendleft(arr[cut:])
                taken += cut
                break
            arrays.append(arr)
            taken += int(arr.size)
        setattr(self, count_attr, max(getattr(self, count_attr) - taken, 0))
        if not arrays:
            return np.array([], dtype=np.float32)
        return np.concatenate(arrays).astype(np.float32, copy=False)

    def clear_audio(self):
        with self._audio_lock:
            self._audio_chunks.clear()
            self._audio_sample_count = 0

    def clear_monitor_audio(self):
        with self._monitor_lock:
            self._monitor_chunks.clear()
            self._monitor_sample_count = 0

    def pop_audio(self, max_samples: Optional[int] = None) -> np.ndarray:
        with self._audio_lock:
            return self._drain(self._audio_chunks, "_audio_sample_count", max_samples)

    def pop_monitor_audio(self, max_samples: Optional[int] = None) -> np.ndarray:
        with self._monitor_lock:
            return self._drain(self._monitor_chunks, "_monitor_sample_count", max_samples)

    def is_squelch_open(self) -> bool:
        with self._audio_lock:
            return bool(self.squelch_open)

    def get_audio_sample_rate(self) -> int:
        return int(self.audio_sample_rate)

    def get_meter_level(self) -> Tuple[float, float, Optional[float], bool]:
        """(level 0..1, threshold 0..1, daya kanal dBFS, squelch_open).

        Skala level = SNR kanal 0..meter_ceil_snr_db, supaya garis threshold
        di meter UI pas dengan titik squelch membuka.
        """
        with self._audio_lock:
            snr = self.current_snr_db
            dbfs = self.current_channel_dbfs
            squelch_open = bool(self.squelch_open)
        ceil = max(self.meter_ceil_snr_db, 1e-6)
        threshold_level = max(0.0, min(1.0, self.squelch_snr_db / ceil))
        if snr is None:
            return 0.0, threshold_level, None, squelch_open
        return max(0.0, min(1.0, snr / ceil)), threshold_level, dbfs, squelch_open

    def get_latest(self):
        with self.lock:
            if self.latest_db is None:
                return None
            return {
                "db": self.latest_db.tolist(),
                "timestamp": self.latest_ts,
                "sample_rate_hz": self.sample_rate_hz,
                "fft_size": int(self.latest_db.size),
                "center_freq_hz": self.center_hz,
            }

    # ------------------------------------------------------------------
    # DSP
    # ------------------------------------------------------------------
    def _build_dsp(self):
        """(Re)build filter sesuai sample rate, mode & bandwidth saat ini."""
        with self.lock:
            sr = self.sample_rate_hz
            mode, bw = self.mode, self.bandwidth_hz
            freq, center = self.freq_hz, self.center_hz

        d1 = max(sr // HACKRF_CHANNEL_RATE, 1)
        ch_rate = sr / d1
        d2 = max(int(round(ch_rate / HACKRF_AUDIO_RATE)), 1)

        # SSB: geser kanal setengah bandwidth supaya filter simetris cukup.
        ssb_shift = {"usb": bw / 2.0, "lsb": -bw / 2.0}.get(mode, 0.0)
        half_bw = min(bw / 2.0, ch_rate * 0.45)
        audio_cut = min(
            {"wfm": 15_000.0, "am": bw / 2.0}.get(mode, max(bw / 2.0, 3_000.0)),
            HACKRF_AUDIO_RATE * 0.45,
        )
        self._dsp = {
            "d1": d1,
            "ch_rate": ch_rate,
            "mix_hz": (freq - center) + ssb_shift,
            "mix_phase": 0.0,
            "ssb_shift": ssb_shift,
            "ssb_phase": 0.0,
            "stage1": _FirDecimator(firwin(129, min(120_000.0, ch_rate * 0.45), fs=sr), d1),
            "channel_taps": firwin(129, half_bw, fs=ch_rate).astype(np.float32),
            "channel_zi": np.zeros(128, dtype=np.complex64),
            "audio": _FirDecimator(firwin(129, audio_cut, fs=ch_rate), d2, dtype=np.float32),
            "prev_iq": np.complex64(0),
            # Skala demod FM: deviasi acuan (Hz) -> amplitudo audio ~1.0
            "fm_scale": ch_rate / (2 * np.pi * (75_000.0 if mode == "wfm" else 5_000.0)),
            "dc": 0.0,
            "window": np.hanning(HACKRF_FFT_SIZE).astype(np.float32),
            "chan_bins": (freq - center, bw),
        }
        self._dsp_dirty = False

    def _spectrum(self, iq: np.ndarray, sr: int) -> Tuple[np.ndarray, np.ndarray]:
        n = HACKRF_FFT_SIZE
        win = self._dsp["window"]
        frames = min(len(iq) // n, 8)
        power = np.zeros(n, dtype=np.float64)
        for k in range(frames):
            seg = iq[k * n:(k + 1) * n] * win
            power += np.abs(np.fft.fftshift(np.fft.fft(seg))) ** 2
        power /= max(frames, 1) * (n * n)
        return power, 10.0 * np.log10(power + 1e-20)

    def _measure_channel(self, power: np.ndarray, sr: int):
        n = power.size
        offset, bw = self._dsp["chan_bins"]
        bin_hz = sr / n
        center_bin = n // 2 + int(round(offset / bin_hz))
        half_bins = max(int(round(bw / 2 / bin_hz)), 1)
        lo, hi = max(center_bin - half_bins, 0), min(center_bin + half_bins + 1, n)
        if hi <= lo:
            return None, None
        noise_bin = float(np.median(power))
        chan = float(np.sum(power[lo:hi]))
        expected_noise = noise_bin * (hi - lo)
        snr = 10.0 * np.log10((chan + 1e-20) / (expected_noise + 1e-20))
        return snr, 10.0 * np.log10(chan + 1e-20)

    def _demodulate(self, iq: np.ndarray) -> np.ndarray:
        dsp = self._dsp
        sr = self.sample_rate_hz
        n = np.arange(len(iq))

        # Mixer: geser frekuensi target ke 0 Hz (fase kontinu antar-blok).
        step = -2 * np.pi * dsp["mix_hz"] / sr
        osc = np.exp(1j * (dsp["mix_phase"] + step * n)).astype(np.complex64)
        dsp["mix_phase"] = float((dsp["mix_phase"] + step * len(iq)) % (2 * np.pi))
        x = dsp["stage1"].process(iq * osc)

        x, dsp["channel_zi"] = lfilter(dsp["channel_taps"], [1.0], x, zi=dsp["channel_zi"])
        x = x.astype(np.complex64)

        mode = self.mode
        if mode in ("nbfm", "wfm"):
            prev = np.concatenate([[dsp["prev_iq"]], x[:-1]])
            dsp["prev_iq"] = x[-1]
            audio = np.angle(x * np.conj(prev)).astype(np.float32) * np.float32(dsp["fm_scale"])
        elif mode == "am":
            audio = np.abs(x).astype(np.float32)
        else:  # usb / lsb
            ch_rate = dsp["ch_rate"]
            m = np.arange(len(x))
            step2 = 2 * np.pi * dsp["ssb_shift"] / ch_rate
            osc2 = np.exp(1j * (dsp["ssb_phase"] + step2 * m))
            dsp["ssb_phase"] = float((dsp["ssb_phase"] + step2 * len(x)) % (2 * np.pi))
            audio = np.real(x * osc2).astype(np.float32) * 4.0

        audio = dsp["audio"].process(audio)
        # Buang DC pelan-pelan (penting untuk AM & offset frekuensi kecil di FM).
        mean = float(np.mean(audio)) if audio.size else 0.0
        dsp["dc"] = 0.95 * dsp["dc"] + 0.05 * mean
        audio = audio - np.float32(dsp["dc"] if mode != "am" else mean)
        if mode == "am":
            peak = float(np.max(np.abs(audio))) if audio.size else 0.0
            if peak > 1e-6:
                audio = audio * np.float32(min(0.5 / peak, 50.0))
        return np.clip(audio, -1.0, 1.0).astype(np.float32)

    def _update_squelch(self, snr: Optional[float], dbfs: Optional[float]) -> bool:
        # Disimpan sebagai float/bool Python biasa: nilai numpy (np.float64/np.bool_)
        # membuat jsonify(status()) gagal ("Object of type bool is not JSON serializable").
        snr = None if snr is None else float(snr)
        dbfs = None if dbfs is None else float(dbfs)
        with self._audio_lock:
            if snr is None:
                self.squelch_open = False
            else:
                was_open = self.squelch_open
                thr = self.squelch_snr_db - (self.squelch_hysteresis_db if was_open else 0.0)
                self.squelch_open = bool(snr >= thr)
            self.current_snr_db = snr
            self.current_channel_dbfs = dbfs
            return self.squelch_open

    def _run(self, generation: int):
        source = None
        source_key = None
        while self._active(generation):
            with self.lock:
                sr = self.sample_rate_hz
                key = (self.center_hz, sr, self.lna_gain, self.vga_gain, self.amp)
                dirty = self._dsp_dirty
            # Panjang blok harus kelipatan total decimation (sample rate -> audio)
            # supaya fase kedua decimator tetap sinkron dari blok ke blok.
            unit = max(sr // HACKRF_AUDIO_RATE, 1)
            block = max((sr // HACKRF_BLOCKS_PER_SEC) // unit, 1) * unit
            try:
                if source is None or key != source_key:
                    if source is not None:
                        source.close()
                    with self.lock:
                        self.connected_snd = self.connected_wf = False
                    cls = _SimulatedSource if self.simulate else _HackRFTransferSource
                    source = cls(center_hz=key[0], sample_rate=sr, lna_gain=key[2], vga_gain=key[3], amp=key[4])
                    source_key = key
                    dirty = True
                if dirty:
                    self._build_dsp()

                iq = source.read(block)
                if not self._active(generation):
                    break

                power, db = self._spectrum(iq, sr)
                snr, dbfs = self._measure_channel(power, sr)
                audio = self._demodulate(iq)
                squelch_open = self._update_squelch(snr, dbfs)

                with self.lock:
                    self.latest_db = db.astype(np.float32)
                    self.latest_ts = time.time()
                    self.connected_snd = self.connected_wf = True
                    self.audio_ready = True
                    self.error = None

                rms = float(np.sqrt(np.mean(audio * audio))) if audio.size else 0.0
                self.current_rms = rms if squelch_open else 0.0
                if squelch_open:
                    self._push_bounded(self._audio_chunks, self._audio_lock, "_audio_sample_count",
                                       self.audio_buffer_seconds, audio)
                target_gain = 1.0 if squelch_open else max(0.0, min(self.monitor_closed_gain, 1.0))
                smoothing = 0.45 if target_gain > self._monitor_gain else 0.18
                self._monitor_gain += (target_gain - self._monitor_gain) * smoothing
                self._push_bounded(self._monitor_chunks, self._monitor_lock, "_monitor_sample_count",
                                   self.monitor_buffer_seconds, audio * np.float32(self._monitor_gain))
            except Exception as exc:
                with self.lock:
                    self.connected_snd = self.connected_wf = False
                    self.error = str(exc)
                print(f"[HACKRF] {exc}", file=sys.stderr)
                if source is not None:
                    source.close()
                source = None
                # Tunggu sebentar sebelum coba lagi (mis. HackRF dicabut/dipakai program lain).
                for _ in range(8):
                    if not self._active(generation):
                        break
                    time.sleep(0.25)

        if source is not None:
            source.close()
