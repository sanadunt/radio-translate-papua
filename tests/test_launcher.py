"""Test launcher (tanpa menjalankan server). Jalankan: uv run python -m unittest discover tests"""
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import radio_launcher as launcher  # noqa: E402


class ParseEnvFileTest(unittest.TestCase):
    def test_reads_values_and_skips_comments(self):
        text = (
            "# komentar\n"
            "\n"
            "RADIO_PORT=5055\n"
            "export RADIO_HOST = 127.0.0.1\n"
            "YALI_MODEL_DIR=\"D:\\Model AI\\papua\"\n"
            "RADIO_BROWSER=tab  # komentar di akhir baris\n"
            "# YALI_NO_MODEL=1\n"
            "baris tanpa sama dengan\n"
        )
        self.assertEqual(launcher.parse_env_file(text), {
            "RADIO_PORT": "5055",
            "RADIO_HOST": "127.0.0.1",
            "YALI_MODEL_DIR": "D:\\Model AI\\papua",
            "RADIO_BROWSER": "tab",
        })

    def test_template_has_no_active_settings(self):
        self.assertEqual(launcher.parse_env_file(launcher.CONFIG_TEMPLATE), {})


class LoadConfigTest(unittest.TestCase):
    def test_creates_template_and_env_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            path = launcher.load_config(data_dir)
            self.assertTrue(path.exists())
            path.write_text("RADIO_PORT=5099\nRADIO_HOST=127.0.0.1\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {"RADIO_PORT": "5077"}, clear=False):
                os.environ.pop("RADIO_HOST", None)
                launcher.load_config(data_dir)
                self.assertEqual(os.environ["RADIO_PORT"], "5077")   # variabel sistem menang
                self.assertEqual(os.environ["RADIO_HOST"], "127.0.0.1")  # dari file


class DataDirTest(unittest.TestCase):
    def test_source_run_uses_project_folder(self):
        self.assertEqual(launcher.default_data_dir(), Path(launcher.__file__).resolve().parent)

    def test_frozen_windows_uses_localappdata(self):
        with mock.patch.object(launcher, "is_frozen", return_value=True), \
             mock.patch.object(launcher.platform, "system", return_value="Windows"), \
             mock.patch.dict(os.environ, {"LOCALAPPDATA": "C:\\Users\\op\\AppData\\Local"}):
            self.assertEqual(launcher.default_data_dir(), Path("C:\\Users\\op\\AppData\\Local") / "RadioTranslatePapua")


class PortTest(unittest.TestCase):
    def test_busy_port_is_detected(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as busy:
            busy.bind(("0.0.0.0", 0))
            busy.listen()
            port = busy.getsockname()[1]
            self.assertFalse(launcher.port_is_free("0.0.0.0", port))
        self.assertTrue(launcher.port_is_free("0.0.0.0", port))

    def test_no_instance_on_free_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        self.assertIsNone(launcher.running_instance(port))

    def test_chrome_blocked_ports_include_sip(self):
        self.assertIn(5060, launcher.CHROME_BLOCKED_PORTS)
        self.assertNotIn(launcher.DEFAULT_PORT, launcher.CHROME_BLOCKED_PORTS)


if __name__ == "__main__":
    unittest.main()
