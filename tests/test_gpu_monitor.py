"""Test pemantau GPU (gpu_monitor.py) dan log launcher. Jalankan: npm run test:py"""
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gpu_monitor  # noqa: E402
import radio_launcher  # noqa: E402


class ParseTest(unittest.TestCase):
    def test_parses_nvidia_smi_csv(self):
        sample = gpu_monitor.parse_line("0, NVIDIA GeForce RTX 3050 Laptop GPU, 37, 2350, 4096, 61, 18.52\n")
        self.assertEqual(sample, {"index": 0, "name": "NVIDIA GeForce RTX 3050 Laptop GPU", "util": 37.0,
                                  "mem_used_mb": 2350.0, "mem_total_mb": 4096.0, "temp_c": 61.0, "power_w": 18.52})

    def test_not_available_values_and_bad_lines(self):
        self.assertIsNone(gpu_monitor.parse_line("1, NVIDIA X, [N/A], 100, 4096, 50, [N/A]")["util"])
        self.assertIsNone(gpu_monitor.parse_line("garbage"))

    def test_without_nvidia_smi(self):
        monitor = gpu_monitor.GpuMonitor()
        monitor.smi = None
        self.assertEqual(monitor.snapshot(), {"available": False, "error": None, "gpu": None})


class LogFileTest(unittest.TestCase):
    def test_previous_sessions_are_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            logs = Path(tmp)
            for session in range(radio_launcher.LOG_KEEP + 3):
                (logs / "radio-translate.log").write_text(f"sesi {session}\n")
                radio_launcher.rotate_logs(logs)
            names = sorted(p.name for p in logs.iterdir())
            self.assertEqual(len(names), radio_launcher.LOG_KEEP)
            self.assertEqual((logs / "radio-translate.1.log").read_text(), f"sesi {radio_launcher.LOG_KEEP + 2}\n")

    def test_each_line_gets_a_timestamp(self):
        buffer = io.StringIO()
        tee = radio_launcher._Tee(None, buffer)
        tee.write("satu\ndu")
        tee.write("a\n")
        lines = buffer.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertRegex(lines[0], r"^\d\d:\d\d:\d\d\.\d{3} satu$")
        self.assertRegex(lines[1], r"^\d\d:\d\d:\d\d\.\d{3} dua$")


if __name__ == "__main__":
    unittest.main()
