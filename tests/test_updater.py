"""Test update otomatis (tanpa internet). Jalankan: npm run test:py"""
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import updater  # noqa: E402

ROOT = "sanadunt-radio-translate-papua-abc1234"


def make_release_zip(path: Path, files: dict, modes: dict = None):
    """ZIP dengan susunan zipball GitHub: semua file di bawah satu folder akar."""
    with zipfile.ZipFile(path, "w") as archive:
        for name, content in files.items():
            info = zipfile.ZipInfo(name if name.startswith("../") else f"{ROOT}/{name}")
            info.external_attr = ((modes or {}).get(name, 0o644) & 0o777) << 16
            archive.writestr(info, content)


class VersionTest(unittest.TestCase):
    def test_parse_and_compare(self):
        self.assertEqual(updater.parse_version("v1.2.3"), (1, 2, 3))
        self.assertEqual(updater.parse_version("1.10.0"), (1, 10, 0))
        self.assertIsNone(updater.parse_version("v1.2"))
        self.assertIsNone(updater.parse_version("latest"))
        self.assertTrue(updater.is_newer("v1.10.0", "1.9.9"))
        self.assertFalse(updater.is_newer("v1.0.0", "1.0.0"))
        self.assertFalse(updater.is_newer("rusak", "1.0.0"))


class ApplyZipTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.app = base / "app"
        self.app.mkdir()
        self.backup = base / "backup"
        self.zip = base / "update.zip"
        (self.app / "radio_launcher.py").write_text("lama\n")
        (self.app / "README.md").write_text("sama\n")
        (self.app / "radio-translate.env").write_text("RADIO_AI=1\n")
        (self.app / "models").mkdir()
        (self.app / "models" / "x.bin").write_text("model asli\n")

    def tearDown(self):
        self._tmp.cleanup()

    def test_overwrites_code_and_keeps_user_data(self):
        make_release_zip(self.zip, {
            "radio_launcher.py": "baru\n",
            "README.md": "sama\n",
            "static/script.js": "js baru\n",
            "jalankan.sh": "#!/bin/sh\n",
            "radio-translate.env": "RADIO_AI=0\n",
            "models/x.bin": "palsu\n",
            "whisper-ambai-v2-10epochs-faster-whisper/model.bin": "palsu\n",
            "static/../../keluar.txt": "jahat\n",  # path traversal di dalam akar: dilewati
        }, modes={"jalankan.sh": 0o755})
        written = updater.apply_zip(self.zip, self.app, self.backup)

        self.assertEqual(sorted(written), ["jalankan.sh", "radio_launcher.py", "static/script.js"])
        self.assertEqual((self.app / "radio_launcher.py").read_text(), "baru\n")
        self.assertEqual((self.backup / "radio_launcher.py").read_text(), "lama\n")
        self.assertFalse((self.backup / "README.md").exists())  # tidak berubah, tidak di-backup
        self.assertEqual((self.app / "radio-translate.env").read_text(), "RADIO_AI=1\n")
        self.assertEqual((self.app / "models" / "x.bin").read_text(), "model asli\n")
        self.assertFalse((self.app / "whisper-ambai-v2-10epochs-faster-whisper").exists())
        self.assertFalse((self.app.parent / "keluar.txt").exists())
        if os.name != "nt":
            self.assertTrue(os.stat(self.app / "jalankan.sh").st_mode & 0o100)

    def test_rejects_zip_without_app(self):
        make_release_zip(self.zip, {"lain.txt": "x"})
        with self.assertRaises(updater.UpdateError):
            updater.apply_zip(self.zip, self.app, self.backup)

    def test_rejects_entries_outside_root(self):
        make_release_zip(self.zip, {"radio_launcher.py": "baru\n", "../keluar.txt": "jahat\n"})
        with self.assertRaises(updater.UpdateError):
            updater.apply_zip(self.zip, self.app, self.backup)
        self.assertEqual((self.app / "radio_launcher.py").read_text(), "lama\n")


class InstallModeTest(unittest.TestCase):
    def test_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp)
            self.assertEqual(updater.install_mode(app, frozen=True), "installer")
            self.assertEqual(updater.install_mode(app, frozen=False), "zip")
            (app / ".git").mkdir()
            with mock.patch.object(updater.shutil, "which", return_value="/usr/bin/git"):
                self.assertEqual(updater.install_mode(app, frozen=False), "git")
            # Host tanpa git: folder .git ada, tetapi update tetap lewat ZIP.
            with mock.patch.object(updater.shutil, "which", return_value=None):
                self.assertEqual(updater.install_mode(app, frozen=False), "zip")


class CheckLatestTest(unittest.TestCase):
    def fake_response(self, payload, url="https://api.github.com/repos/o/r/releases/latest"):
        response = io.BytesIO(json.dumps(payload).encode())
        response.geturl = lambda: url
        response.__enter__ = lambda self=response: self
        response.__exit__ = lambda *a: None
        return response

    def test_reads_latest_release(self):
        payload = {"tag_name": "v1.2.0", "name": "Rilis 1.2", "body": "Catatan",
                   "zipball_url": "https://api.github.com/repos/o/r/zipball/v1.2.0",
                   "html_url": "https://github.com/o/r/releases/tag/v1.2.0"}
        with mock.patch.object(updater.urllib.request, "urlopen", return_value=self.fake_response(payload)):
            latest = updater.check_latest("o/r")
        self.assertEqual(latest["version"], "1.2.0")
        self.assertEqual(latest["notes"], "Catatan")

    def test_private_or_no_release_is_explained(self):
        error = urllib.error.HTTPError("u", 404, "Not Found", {}, None)
        with mock.patch.object(updater.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(updater.UpdateError, "privat"):
                updater.check_latest("o/r")

    def test_only_github_hosts(self):
        with self.assertRaises(updater.UpdateError):
            updater._check_url("https://evil.example/update.zip")
        with self.assertRaises(updater.UpdateError):
            updater._check_url("http://api.github.com/repos/o/r")
        updater._check_url("https://codeload.github.com/o/r/legacy.zip/refs/tags/v1.2.0")


if __name__ == "__main__":
    unittest.main()
