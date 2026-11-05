"""Test pemeriksa folder model & penulis setelan wizard. Jalankan: npm run test:py"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import model_setup  # noqa: E402

WHISPER_FILES = ["model.bin", "config.json", "preprocessor_config.json", "tokenizer.json", "vocabulary.json"]
# Isi folder di Google Drive (dicek 2026-11-05).
MT_AMBAI_FILES = ["config.json", "generation_config.json", "model.safetensors", "sentencepiece.bpe.model",
                  "special_tokens_map.json", "tokenizer_config.json", "tokenizer.json"]
MT_BIAK_FILES = ["config.json", "generation_config.json", "model.safetensors", "tokenizer_config.json", "tokenizer.json"]


def make_folder(base: Path, name: str, files):
    folder = base / name
    folder.mkdir(parents=True)
    for file in files:
        (folder / file).write_bytes(b"x")
    return folder


def make_drive_layout(base: Path):
    make_folder(base, "whisper-ambai-v2-10epochs-faster-whisper", WHISPER_FILES)
    make_folder(base, "whisper-biak-v4-10epochs-faster-whisper", WHISPER_FILES)
    make_folder(base, "best_bleu_ambai", MT_AMBAI_FILES)
    make_folder(base, "best_bleu_biak", MT_BIAK_FILES)


class CheckModelDirTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_drive_layout_is_ready(self):
        make_drive_layout(self.base)
        report = model_setup.check_model_dir(self.base)
        self.assertTrue(report["ready"])
        self.assertTrue(report["languages"]["ambai"]["ok"])
        self.assertTrue(report["languages"]["biak"]["ok"])
        biak_mt = report["languages"]["biak"]["items"][1]
        self.assertEqual(biak_mt["missing"], [])
        self.assertIn("special_tokens_map.json", biak_mt["missing_optional"])

    def test_empty_folder_lists_every_folder(self):
        report = model_setup.check_model_dir(self.base)
        self.assertFalse(report["ready"])
        missing = [i["missing"] for lang in report["languages"].values() for i in lang["items"]]
        self.assertEqual(missing[0], ["folder whisper-ambai-v2-10epochs-faster-whisper"])
        self.assertEqual(len(missing), 4)

    def test_missing_files_are_named(self):
        make_folder(self.base, "whisper-ambai-v2-10epochs-faster-whisper", ["config.json", "tokenizer.json"])
        make_folder(self.base, "best_bleu_ambai", ["config.json", "tokenizer.json"])
        ambai = model_setup.check_model_dir(self.base)["languages"]["ambai"]
        self.assertEqual(ambai["items"][0]["missing"], ["model.bin", "vocabulary.json atau vocabulary.txt"])
        self.assertEqual(ambai["items"][1]["missing"], ["model.safetensors atau pytorch_model.bin", "tokenizer_config.json"])

    def test_nested_zip_extraction_gets_a_hint(self):
        name = "whisper-ambai-v2-10epochs-faster-whisper"
        make_folder(self.base / name, name, WHISPER_FILES)
        item = model_setup.check_model_dir(self.base)["languages"]["ambai"]["items"][0]
        self.assertFalse(item["ok"])
        self.assertIn("berlapis", item["hint"])

    def test_models_subfolder_is_used(self):
        make_drive_layout(self.base / "models")
        report = model_setup.check_model_dir(self.base)
        self.assertEqual(Path(report["model_dir"]), self.base / "models")
        self.assertTrue(report["ready"])

    def test_lora_adapter_is_accepted(self):
        make_folder(self.base, "whisper-ambai-v2-10epochs-faster-whisper", WHISPER_FILES)
        make_folder(self.base, "best_bleu_ambai", ["adapter_config.json", "adapter_model.safetensors"])
        report = model_setup.check_model_dir(self.base)
        self.assertTrue(report["ready"])
        self.assertIn("internet", report["languages"]["ambai"]["items"][1]["hint"])


class UpdateEnvFileTest(unittest.TestCase):
    def test_uses_template_line_replaces_and_disables(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "radio-translate.env"
            path.write_text("# Port\n# RADIO_PORT=5050\nYALI_NO_MODEL=1\nRADIO_AI=0\n", encoding="utf-8")
            model_setup.update_env_file(path, {
                "RADIO_PORT": "5055",       # dari baris contoh
                "RADIO_AI": "1",            # ganti nilai
                "YALI_NO_MODEL": None,      # nonaktifkan
                "RADIO_SETUP_DONE": "1",    # tambah di akhir
            })
            self.assertEqual(path.read_text(encoding="utf-8").splitlines(), [
                "# Port", "# RADIO_PORT=5050", "RADIO_PORT=5055", "# YALI_NO_MODEL=1", "RADIO_AI=1", "RADIO_SETUP_DONE=1",
            ])

    def test_value_none_for_absent_key_changes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "radio-translate.env"
            path.write_text("RADIO_AI=1\n", encoding="utf-8")
            model_setup.update_env_file(path, {"YALI_NO_MODEL": None})
            self.assertEqual(path.read_text(encoding="utf-8"), "RADIO_AI=1\n")


class CoreConsistencyTest(unittest.TestCase):
    def test_folder_names_match_core_app(self):
        os.environ.setdefault("YALI_NO_MODEL", "1")
        os.environ.setdefault("YALI_SKIP_BOOTSTRAP", "1")
        import app_faster_whisper_lokal as core
        for lang, folders in model_setup.MODEL_FOLDERS.items():
            self.assertEqual(Path(core.WHISPER_MODEL_DIRS[lang]).name, folders["whisper"])
            self.assertEqual(Path(core.MT_MODEL_DIRS[lang]).name, folders["mt"])


if __name__ == "__main__":
    unittest.main()
