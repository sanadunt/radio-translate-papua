"""Test pilihan perangkat AI (ai_device.py, /system/device). Jalankan: npm run test:py"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import ai_device  # noqa: E402

SMI = """0, NVIDIA GeForce RTX 3050 Laptop GPU, 4096, 8.6
1, NVIDIA GeForce GTX 1050, 2048, 6.1
"""


class DetectTest(unittest.TestCase):
    def test_parse_and_auto_pick_largest_vram(self):
        gpus = ai_device.parse_nvidia_list(SMI + "rusak\n")
        self.assertEqual([g["name"] for g in gpus], ["NVIDIA GeForce RTX 3050 Laptop GPU", "NVIDIA GeForce GTX 1050"])
        self.assertEqual(gpus[1], {"index": 1, "name": "NVIDIA GeForce GTX 1050", "vram_mb": 2048.0, "compute_cap": "6.1"})
        self.assertEqual(ai_device.auto_pick(gpus), 0)
        self.assertIsNone(ai_device.auto_pick([]))

    def test_resolve_choice(self):
        vram = {0: 2048, 1: 8192}
        self.assertEqual(ai_device.resolve_choice("auto", 2, vram), 1)
        self.assertEqual(ai_device.resolve_choice("cuda:0", 2, vram), 0)
        self.assertEqual(ai_device.resolve_choice("cuda:5", 2, vram), 1)  # GPU hilang -> otomatis
        self.assertIsNone(ai_device.resolve_choice("cpu", 2, vram))
        self.assertIsNone(ai_device.resolve_choice("auto", 0, {}))  # tanpa GPU NVIDIA -> CPU

    def test_compute_type_follows_gpu_support(self):
        rtx = {"float32", "int8", "int8_float32", "int8_float16", "float16", "bfloat16"}
        gtx1050 = {"float32", "int8", "int8_float32"}  # tanpa fp16 cepat
        self.assertEqual(ai_device.pick_compute_type(rtx, "int8_float16", "cuda"), "int8_float16")
        self.assertEqual(ai_device.pick_compute_type(gtx1050, "int8_float16", "cuda"), "int8")
        self.assertEqual(ai_device.pick_compute_type({"float32"}, "int8_float16", "cuda"), "float32")
        self.assertEqual(ai_device.pick_compute_type({"int8", "float32"}, None, "cpu"), "int8")


class SettingsTest(unittest.TestCase):
    def test_save_load_and_env_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "device-settings.json"
            with mock.patch.dict(os.environ, {"YALI_DEVICE": ""}):
                settings = ai_device.DeviceSettings(path)
                self.assertEqual(settings.choice, "auto")
                settings.save("cuda:1")
                self.assertEqual(ai_device.DeviceSettings(path).choice, "cuda:1")
                with self.assertRaises(ValueError):
                    settings.save("gpu intel")
            with mock.patch.dict(os.environ, {"YALI_DEVICE": "cpu"}):
                locked = ai_device.DeviceSettings(path)
                self.assertTrue(locked.locked_by_env)
                self.assertEqual(locked.choice, "cpu")


class EndpointTest(unittest.TestCase):
    def test_devices_and_choice_without_model(self):
        os.environ.setdefault("YALI_NO_MODEL", "1")
        os.environ.setdefault("YALI_SKIP_BOOTSTRAP", "1")
        import app_faster_whisper_lokal as core
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(core, "device_settings", ai_device.DeviceSettings(Path(tmp) / "d.json")), \
                mock.patch.object(core.ai_device, "list_nvidia_gpus", return_value=ai_device.parse_nvidia_list(SMI)), \
                mock.patch.object(core.ai_device, "list_other_gpus", return_value=["Intel(R) UHD Graphics"]):
            core._other_gpus_cache.clear()
            http = core.app.test_client()
            data = http.get("/system/devices").get_json()
            self.assertEqual((data["choice"], data["auto_index"], data["other"]), ("auto", 0, ["Intel(R) UHD Graphics"]))
            changed = http.post("/system/device", json={"choice": "cuda:1"}).get_json()
            self.assertTrue(changed["ok"])
            self.assertEqual(json.loads((Path(tmp) / "d.json").read_text())["device"], "cuda:1")
            self.assertEqual(http.post("/system/device", json={"choice": "intel"}).status_code, 400)
            core._other_gpus_cache.clear()


if __name__ == "__main__":
    unittest.main()
