# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec Radio Translate Papua. Jangan dipanggil langsung; pakai:
#   uv run --locked --group build python packaging/build.py [--with-ai]
# Hasil: dist/RadioTranslatePapua/ (Windows & Linux) atau dist/RadioTranslatePapua.app (macOS).
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).parent
APP = "RadioTranslatePapua"
VERSION = os.environ.get("RADIO_BUILD_VERSION", "1.0.0")
WITH_AI = os.environ.get("RADIO_BUILD_AI") == "1"
ICON = str(ROOT / "static" / "logo.jpeg")  # Pillow mengubahnya jadi .ico/.icns

datas = [
    (str(ROOT / "templates"), "templates"),
    (str(ROOT / "static"), "static"),
    (str(ROOT / "listener_kit"), "listener_kit"),
]
hiddenimports = ["app_faster_whisper_lokal", "web888_client", "hackrf_client", "webusb_audio_bridge"]
# matplotlib hanya dipakai noisereduce.plotting (tidak pernah dimuat aplikasi).
excludes = ["matplotlib", "tkinter", "IPython", "pytest"]

if WITH_AI:
    for package in ("faster_whisper", "ctranslate2", "transformers", "peft", "sentencepiece", "tokenizers"):
        hiddenimports += collect_submodules(package)
    datas += collect_data_files("faster_whisper")  # model VAD Silero (assets/*.onnx)
    datas += collect_data_files("transformers", include_py_files=False)
else:
    excludes += ["torch", "torchvision", "torchaudio", "transformers", "faster_whisper",
                 "ctranslate2", "peft", "sentencepiece", "tokenizers", "accelerate", "onnxruntime"]

a = Analysis(
    [str(ROOT / "radio_launcher.py")],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP,
    # Windows/Linux: jendela konsol berisi log (menutupnya = menutup aplikasi).
    # macOS: aplikasi tanpa konsol; log di folder data, tutup lewat tombol di halaman.
    console=sys.platform != "darwin",
    icon=ICON,
)
coll = COLLECT(exe, a.binaries, a.datas, name=APP)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name=f"{APP}.app",
        icon=ICON,
        bundle_identifier="id.rtigroup.radiotranslatepapua",
        version=VERSION,
        info_plist={
            "CFBundleDisplayName": "Radio Translate Papua",
            "CFBundleShortVersionString": VERSION,
            # Input audio lokal (VB-Cable/USB) untuk Rekam & Translate.
            "NSMicrophoneUsageDescription": "Merekam audio radio untuk diterjemahkan.",
            "NSHighResolutionCapable": True,
        },
    )
