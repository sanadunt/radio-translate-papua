"""Test database VFO Record, endpoint /records & /sdr/squelch, dan regresi status HackRF.
Jalankan: npm run test:py"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from records_db import RecordsDB  # noqa: E402


def make_db(tmp: Path) -> RecordsDB:
    audio = tmp / "rekaman_radio"
    audio.mkdir()
    return RecordsDB(tmp / "rekaman.db", audio)


class RecordsDBTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.db = make_db(self.tmp)

    def tearDown(self):
        self.db.close()
        self._tmp.cleanup()

    def add(self, **fields):
        base = dict(kind="terjemah", source="Radio V1 · Web-888", freq_hz=155_700_000, mode="NBFM",
                    bandwidth_hz=12500, lang="ambai", duration_sec=3.2, sample_rate=12000, segments=2)
        base.update(fields)
        return self.db.add(**base)

    def test_opens_lazily(self):
        self.assertFalse((self.tmp / "rekaman.db").exists())
        self.add()
        self.assertTrue((self.tmp / "rekaman.db").exists())

    def test_add_and_get(self):
        record_id = self.add(text_papua="kalimat satu.", text_indonesia="satu.", file="a.wav")
        item = self.db.get(record_id)
        self.assertEqual(item["freq_hz"], 155_700_000)
        self.assertEqual(item["segments"], 2)
        self.assertEqual(item["note"], "")
        self.assertFalse(item["has_audio"])
        self.assertRegex(item["created_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$")
        self.assertIsNone(self.db.get(999))
        with self.assertRaises(ValueError):
            self.add(kind="lain")

    def test_list_search_filter_and_pages(self):
        self.add(text_papua="Kapal Masuk", created_at="2026-11-05T10:00:00+09:00")
        self.add(kind="simpan", lang="biak", source="Radio V2 · USB di browser", created_at="2026-11-05T11:00:00+09:00")
        self.add(text_indonesia="cuaca buruk", created_at="2026-11-05T12:00:00+09:00")
        total, items = self.db.list()
        self.assertEqual(total, 3)
        self.assertEqual([i["created_at"][11:13] for i in items], ["12", "11", "10"])  # terbaru dulu
        self.assertEqual(self.db.list(q="kapal")[0], 1)          # tanpa beda huruf besar/kecil
        self.assertEqual(self.db.list(q="usb di browser")[0], 1)  # cari di sumber
        self.assertEqual(self.db.list(lang="biak")[0], 1)
        self.assertEqual(self.db.list(kind="terjemah")[0], 2)
        total, page = self.db.list(limit=2, offset=2)
        self.assertEqual((total, len(page)), (3, 1))

    def test_note_and_delete_removes_file(self):
        wav = self.tmp / "rekaman_radio" / "radio_x.wav"
        wav.write_bytes(b"RIFF")
        record_id = self.add(file="radio_x.wav")
        self.assertTrue(self.db.get(record_id)["has_audio"])
        self.assertEqual(self.db.update_note(record_id, "kapal nelayan")["note"], "kapal nelayan")
        self.assertEqual(self.db.list(q="nelayan")[0], 1)
        self.assertIsNone(self.db.update_note(999, "x"))
        self.assertTrue(self.db.delete(record_id))
        self.assertFalse(wav.exists())
        self.assertFalse(self.db.delete(record_id))

    def test_file_outside_audio_dir_is_never_touched(self):
        outside = self.tmp / "penting.txt"
        outside.write_text("jangan dihapus")
        record_id = self.add(file="../penting.txt")
        self.assertFalse(self.db.get(record_id)["has_audio"])
        self.db.delete(record_id)
        self.assertTrue(outside.exists())


def import_core():
    os.environ.setdefault("YALI_NO_MODEL", "1")
    os.environ.setdefault("YALI_SKIP_BOOTSTRAP", "1")
    import app_faster_whisper_lokal as core
    return core


class EndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.core = import_core()
        cls._tmp = tempfile.TemporaryDirectory()
        cls.original = cls.core.records
        cls.core.records = make_db(Path(cls._tmp.name))
        cls.client = cls.core.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.core.records.close()
        cls.core.records = cls.original
        cls._tmp.cleanup()

    def test_records_crud_and_audio(self):
        db = self.core.records
        wav = db.audio_dir / "radio_20261105_140211_ambai_1.wav"
        wav.write_bytes(b"RIFF....WAVE")
        record_id = db.add(kind="terjemah", source="Radio V1 · Web-888", freq_hz=155_700_000, lang="ambai",
                           duration_sec=1.0, file=wav.name, text_papua="a.", text_indonesia="b.",
                           created_at="2026-11-05T14:02:11+09:00")
        res = self.client.get("/records?q=b.&limit=9999").get_json()
        self.assertTrue(res["ok"])
        self.assertEqual(res["total"], 1)
        self.assertEqual(res["items"][0]["id"], record_id)
        self.assertEqual(self.client.get(f"/records/{record_id}").get_json()["item"]["text_papua"], "a.")
        self.assertEqual(self.client.get("/records/999").status_code, 404)

        audio = self.client.get(f"/records/{record_id}/audio")
        self.assertEqual(audio.status_code, 200)
        self.assertEqual(audio.mimetype, "audio/wav")
        audio.close()
        download = self.client.get(f"/records/{record_id}/audio?download=1")
        self.assertIn("rekaman_20261105_140211_155.700MHz_ambai.wav", download.headers["Content-Disposition"])
        download.close()

        patched = self.client.patch(f"/records/{record_id}", json={"note": "catatan"}).get_json()
        self.assertEqual(patched["item"]["note"], "catatan")
        self.assertEqual(self.client.patch(f"/records/{record_id}", json={"note": "x" * 2001}).status_code, 400)
        self.assertEqual(self.client.patch(f"/records/{record_id}", json={}).status_code, 400)

        self.assertTrue(self.client.delete(f"/records/{record_id}").get_json()["ok"])
        self.assertFalse(wav.exists())
        self.assertEqual(self.client.delete(f"/records/{record_id}").status_code, 404)
        self.assertEqual(self.client.get(f"/records/{record_id}/audio").status_code, 404)

    def test_squelch_unsupported_without_direct_radio(self):
        self.core._set_active_source("sdrpp")
        self.assertEqual(self.client.get("/sdr/squelch").get_json(), {"ok": True, "supported": False, "source": "sdrpp"})
        self.assertEqual(self.client.post("/sdr/squelch", json={"value": 10}).status_code, 400)


class HackRFStatusRegressionTest(unittest.TestCase):
    """Dulu status() berisi np.bool_/np.float64 sehingga start ke-2 hackrf-sim gagal (HTTP 500)."""

    def wait_for_measurement(self, client):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and client.current_snr_db is None:
            time.sleep(0.1)
        self.assertIsNotNone(client.current_snr_db)

    def test_status_is_json_after_running_and_restart(self):
        from hackrf_client import HackRFClient
        client = HackRFClient()
        try:
            client.start(simulate=True, freq_hz=155_700_000)
            self.wait_for_measurement(client)
            status = client.status()
            json.dumps(status)
            self.assertIs(type(status["squelch_open"]), bool)
            client.start(simulate=True, freq_hz=155_700_000)
            self.wait_for_measurement(client)
            json.dumps(client.status())
        finally:
            client.stop()

    def test_spectrum_start_twice_and_squelch_api(self):
        core = import_core()
        http = core.app.test_client()
        try:
            first = http.post("/spectrum/start", json={"source": "hackrf-sim"})
            self.assertEqual(first.status_code, 200, first.get_json())
            self.wait_for_measurement(core.hackrf)
            second = http.post("/spectrum/start", json={"source": "hackrf-sim"})
            self.assertEqual(second.status_code, 200, second.get_json())

            squelch = http.get("/sdr/squelch").get_json()
            self.assertEqual((squelch["supported"], squelch["unit"], squelch["min"], squelch["max"]), (True, "dB SNR", 0.0, 40.0))
            self.assertIs(type(squelch["open"]), bool)
            changed = http.post("/sdr/squelch", json={"value": 15}).get_json()
            self.assertEqual(changed["value"], 15.0)
            self.assertEqual(http.post("/sdr/squelch", json={"value": 99}).status_code, 400)
        finally:
            core.stop_all_radio_sources()
            core._set_active_source("sdrpp")


if __name__ == "__main__":
    unittest.main()
