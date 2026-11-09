"""Test Mode Live (live_translator.py + endpoint /live/*). Jalankan: npm run test:py"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from live_translator import LiveSession  # noqa: E402
from records_db import RecordsDB  # noqa: E402


def fake_capture(segments, then_wait=True, error=None):
    """Capture palsu: kirim `segments` lalu (opsional) tunggu sampai dihentikan."""
    def capture(on_segment, cancel):
        for segment in segments:
            on_segment(segment, 16000)
        if error:
            raise RuntimeError(error)
        if then_wait:
            cancel.wait(5)
    return capture


class LiveSessionTest(unittest.TestCase):
    def run_session(self, capture, process, stop=True):
        session = LiveSession(max_queue=4)
        finished = []
        self.assertTrue(session.start(capture, process, {"source": "uji"}, on_finish=lambda: finished.append(1)))
        if stop:
            time.sleep(0.3)
            session.stop()
        self.assertTrue(session.wait_finished(5))
        self.assertEqual(finished, [1])
        return session

    def test_each_utterance_becomes_an_item(self):
        process = lambda seg, sr, ctx: {"text_papua": seg, "text_indonesia": seg.upper()}
        session = self.run_session(fake_capture(["satu", "dua"]), process)
        snap = session.snapshot()
        self.assertFalse(snap["running"])
        self.assertEqual([i["text_indonesia"] for i in snap["items"]], ["SATU", "DUA"])
        self.assertEqual(snap["stats"]["done"], 2)
        self.assertEqual([i["id"] for i in session.snapshot(after=1)["items"]], [2])
        self.assertIsNotNone(snap["items"][0]["latency_sec"])

    def test_skipped_and_failed_utterances(self):
        def process(seg, sr, ctx):
            if seg == "pelan":
                return None
            if seg == "rusak":
                raise ValueError("model error")
            return {"text_papua": seg}
        session = self.run_session(fake_capture(["pelan", "rusak", "baik"]), process)
        snap = session.snapshot()
        self.assertEqual((snap["stats"]["skipped"], snap["stats"]["failed"], snap["stats"]["done"]), (1, 1, 1))
        self.assertIn("model error", snap["items"][0]["error"])
        self.assertEqual(snap["items"][1]["text_papua"], "baik")

    def test_stop_finishes_queued_utterances(self):
        gate = threading.Event()

        def process(seg, sr, ctx):
            gate.wait(5)
            return {"text_papua": seg}
        session = LiveSession(max_queue=8)
        session.start(fake_capture(["a", "b", "c"]), process)
        time.sleep(0.2)
        session.stop()
        self.assertTrue(session.snapshot()["stopping"])
        gate.set()
        self.assertTrue(session.wait_finished(5))
        self.assertEqual([i["text_papua"] for i in session.snapshot()["items"]], ["a", "b", "c"])

    def test_full_queue_drops_with_message(self):
        gate = threading.Event()

        def process(seg, sr, ctx):
            gate.wait(5)
            return {"text_papua": seg}
        session = LiveSession(max_queue=1)
        session.start(fake_capture(["1", "2", "3", "4"]), process)
        time.sleep(0.3)
        gate.set()
        session.stop()
        session.wait_finished(5)
        snap = session.snapshot()
        self.assertGreaterEqual(snap["stats"]["dropped"], 1)
        self.assertTrue(any("Antrian penuh" in (i.get("error") or "") for i in snap["items"]))

    def test_capture_error_ends_session(self):
        session = self.run_session(fake_capture(["x"], error="radio terputus"), lambda s, r, c: {"text_papua": s},
                                   stop=False)
        snap = session.snapshot()
        self.assertEqual(snap["error"], "radio terputus")
        self.assertEqual(snap["stats"]["done"], 1)

    def test_meta_is_taken_when_utterance_is_heard(self):
        seen = []
        session = LiveSession()

        def capture(on_segment, cancel):
            on_segment("a", 16000)
            session.update_meta({"freq_hz": 2})
            on_segment("b", 16000)
            cancel.wait(5)
        session.start(capture, lambda s, r, ctx: seen.append(ctx["meta"].get("freq_hz")) or {"text_papua": s},
                      {"meta": {"freq_hz": 1}})
        time.sleep(0.3)
        session.stop()
        session.wait_finished(5)
        self.assertEqual(seen, [1, 2])

    def test_cannot_start_twice(self):
        session = LiveSession()
        session.start(fake_capture([]), lambda s, r, c: None)
        self.assertFalse(session.start(fake_capture([]), lambda s, r, c: None))
        session.stop()
        self.assertTrue(session.wait_finished(5))
        self.assertTrue(session.start(fake_capture([]), lambda s, r, c: None))
        session.stop()
        session.wait_finished(5)


class TwoStageTest(unittest.TestCase):
    """Teks Papua tampil sebelum terjemahan selesai; Whisper ucapan berikutnya jalan selagi menerjemahkan."""

    def test_papua_text_first_then_translation(self):
        gate = threading.Event()
        session = LiveSession()
        translate = lambda result, ctx: gate.wait(5) and {"text_indonesia": result["text_papua"].upper()}
        session.start(fake_capture(["a"]), lambda s, r, c: {"text_papua": s, "_audio": "besar"}, translate=translate)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not session.snapshot()["items"]:
            time.sleep(0.02)
        first = session.snapshot()["items"][0]
        self.assertTrue(first["pending"])
        self.assertEqual(first["text_papua"], "a")
        self.assertNotIn("_audio", first)
        gate.set()
        session.stop()
        self.assertTrue(session.wait_finished(5))
        updated = session.snapshot(after=first["rev"])["items"]
        self.assertEqual([(i["id"], i["text_indonesia"], i["pending"]) for i in updated], [(first["id"], "A", False)])
        self.assertIsNotNone(updated[0]["mt_sec"])

    def test_next_transcription_overlaps_translation(self):
        events = []

        def process(seg, sr, ctx):
            events.append(("stt-start", seg, time.monotonic()))
            time.sleep(0.2)
            return {"text_papua": seg}

        def translate(result, ctx):
            events.append(("mt-start", result["text_papua"], time.monotonic()))
            time.sleep(0.6)
            events.append(("mt-end", result["text_papua"], time.monotonic()))
            return {"text_indonesia": result["text_papua"]}
        session = LiveSession()
        session.start(fake_capture(["1", "2", "3"]), process, translate=translate)
        time.sleep(0.3)
        session.stop()
        self.assertTrue(session.wait_finished(10))
        at = {(kind, seg): t for kind, seg, t in events}
        self.assertLess(at[("stt-start", "2")], at[("mt-end", "1")])  # tumpang tindih
        snap = session.snapshot()
        self.assertEqual(snap["stats"]["done"], 3)
        self.assertEqual([i["text_indonesia"] for i in snap["items"]], ["1", "2", "3"])
        self.assertFalse(snap["running"])


class LiveEndpointTest(unittest.TestCase):
    """Ujung ke ujung tanpa model AI: Radio V2 simulasi (PTT 3 dtk nyala / 3 dtk mati)."""

    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("YALI_NO_MODEL", "1")
        os.environ.setdefault("YALI_SKIP_BOOTSTRAP", "1")
        import app_faster_whisper_lokal as core
        cls.core = core
        cls._tmp = tempfile.TemporaryDirectory()
        tmp = Path(cls._tmp.name)
        (tmp / "rekaman_radio").mkdir()
        cls.originals = (core.records, core.RECORDINGS_DIR)
        core.RECORDINGS_DIR = tmp / "rekaman_radio"
        core.records = RecordsDB(tmp / "rekaman.db", core.RECORDINGS_DIR)
        cls.http = core.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.core.records.close()
        cls.core.records, cls.core.RECORDINGS_DIR = cls.originals
        cls._tmp.cleanup()

    def test_live_translates_each_ptt_and_blocks_manual_record(self):
        core, http = self.core, self.http
        try:
            core._set_last_known_ht_freq(155_700_000)  # frekuensi pemancar simulasi
            self.assertEqual(http.post("/spectrum/start", json={"source": "hackrf-sim"}).status_code, 200)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and not core.hackrf.connected_snd:
                time.sleep(0.1)

            started = http.post("/live/start", json={
                "device_index": core.HACKRF_VIRTUAL_DEVICE_INDEX, "lang": "ambai",
                "meta": {"freq_hz": 155_700_000, "mode": "NBFM"}}).get_json()
            self.assertTrue(started["ok"], started)
            self.assertTrue(started["running"])

            busy = http.post("/record-radio", json={"device_index": core.HACKRF_VIRTUAL_DEVICE_INDEX}).get_json()
            self.assertFalse(busy["ok"])
            self.assertIn("Mode Live", busy["error"])

            items = []
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline and not items:
                items = [i for i in http.get("/live/status?after=0").get_json()["items"]
                         if not i.get("error") and not i.get("pending")]
                time.sleep(0.3)
            self.assertTrue(items, "tidak ada ucapan yang diterjemahkan dari radio simulasi")
            first = items[0]
            self.assertTrue(first["text_papua"].startswith("[TANPA MODEL] Audio"), first)
            self.assertEqual(first["freq_hz"], 155_700_000)
            self.assertEqual(core.records.get(first["record_id"])["segments"], 1)
            self.assertTrue(first["text_indonesia"].startswith("[TANPA MODEL]"), first)
            self.assertNotIn("_audio", first)

            status = http.get(f"/live/status?after={first['rev']}").get_json()
            self.assertTrue(all(i["rev"] > first["rev"] for i in status["items"]))
            self.assertEqual(status["models"]["state"], "off")
        finally:
            http.post("/live/stop")
            self.assertTrue(core.live.wait_finished(10))
            core.stop_all_radio_sources()
            core._set_active_source("sdrpp")
        self.assertFalse(http.get("/live/status").get_json()["running"])
        self.assertTrue(core.pipeline.record_lock.acquire(blocking=False))
        core.pipeline.record_lock.release()

    def test_auto_live_follows_radio_and_survives_disconnect(self):
        core, http = self.core, self.http
        from unittest import mock
        settings_path = Path(self._tmp.name) / "live-settings.json"

        def wait_for(cond, timeout=15):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline and not cond():
                core._auto_live_tick()
                time.sleep(0.2)
            return cond()
        with mock.patch.object(core, "live_auto", core.LiveAutoSettings(settings_path)), \
                mock.patch.object(core, "RADIO_AUDIO_GRACE_SECONDS", 1.0):
            try:
                result = http.post("/live/auto", json={"enabled": True, "device_index": -1}).get_json()
                self.assertTrue(result["auto"]["enabled"])
                self.assertTrue(json.loads(settings_path.read_text())["auto"])
                core._auto_live_tick()
                self.assertFalse(core.live.running)
                self.assertIn("Menunggu radio", http.get("/live/status").get_json()["auto"]["waiting"])

                core._set_last_known_ht_freq(155_700_000)
                http.post("/spectrum/start", json={"source": "hackrf-sim"})
                self.assertTrue(wait_for(lambda: core.live.running), "Live tidak mulai sendiri saat radio tersambung")
                self.assertTrue(core.live.info["auto"])

                # Radio diputus: sesi menunggu sebentar lalu selesai, Otomatis menunggu radio lagi.
                core.stop_all_radio_sources()
                self.assertTrue(wait_for(lambda: not core.live.running and core.live_auto.waiting, 20))
                http.post("/spectrum/start", json={"source": "hackrf-sim"})
                self.assertTrue(wait_for(lambda: core.live.running), "Live tidak mulai lagi saat radio kembali")

                stopped = http.post("/live/stop", json={"disable_auto": True}).get_json()
                self.assertTrue(stopped["ok"])
                self.assertFalse(core.live_auto.enabled)
                self.assertFalse(json.loads(settings_path.read_text())["auto"])
                self.assertTrue(core.live.wait_finished(10))
                core._auto_live_tick()
                self.assertFalse(core.live.running)
            finally:
                core.live.stop()
                core.live.wait_finished(10)
                core.stop_all_radio_sources()
                core._set_active_source("sdrpp")

    def test_start_without_source_is_refused(self):
        result = self.http.post("/live/start", json={"device_index": None}).get_json()
        self.assertFalse(result["ok"])
        self.assertTrue(self.core.pipeline.record_lock.acquire(blocking=False))
        self.core.pipeline.record_lock.release()



class VramPolicyTest(unittest.TestCase):
    """Whisper & terjemahan tetap di GPU bila VRAM cukup (RTX 3070 = 8 GB)."""

    def swap(self, setting, cuda, vram_gb):
        os.environ.setdefault("YALI_NO_MODEL", "1")
        os.environ.setdefault("YALI_SKIP_BOOTSTRAP", "1")
        import app_faster_whisper_lokal as core
        from unittest import mock
        with mock.patch.object(core, "LOW_VRAM_SETTING", setting), \
                mock.patch.object(core, "is_cuda_device", return_value=cuda), \
                mock.patch.object(core, "gpu_total_vram_gb", return_value=vram_gb):
            return core.should_swap_models_for_vram()

    def test_auto_keeps_both_models_on_8gb(self):
        self.assertFalse(self.swap("auto", True, 8.0))
        self.assertTrue(self.swap("auto", True, 4.0))
        self.assertFalse(self.swap("auto", False, 0.0))

    def test_manual_override(self):
        self.assertTrue(self.swap("1", True, 8.0))
        self.assertFalse(self.swap("0", True, 4.0))


if __name__ == "__main__":
    unittest.main()
