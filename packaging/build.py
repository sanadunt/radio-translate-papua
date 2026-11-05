#!/usr/bin/env python3
"""
Membangun paket Radio Translate Papua untuk OS tempat skrip ini dijalankan
(PyInstaller tidak bisa cross-compile; untuk OS lain pakai GitHub Actions di
.github/workflows/build.yml):

    uv run --locked --group build python packaging/build.py            # versi Lite (tanpa AI)
    uv run --locked --group build --extra ai python packaging/build.py --with-ai

Hasil di dist/:
    Windows : RadioTranslatePapua-<versi>-windows-x64[-ai]-setup.exe (bila Inno Setup ada) + .zip
    macOS   : RadioTranslatePapua-<versi>-macos-<arch>[-ai].dmg
    Linux   : radio-translate-papua_<versi>_<arch>[-ai].deb
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
APP = "RadioTranslatePapua"
DISPLAY_NAME = "Radio Translate Papua"
DEB_NAME = "radio-translate-papua"


def read_version() -> str:
    import tomllib
    with open(ROOT / "pyproject.toml", "rb") as f:
        return tomllib.load(f)["project"]["version"]


def run(cmd, **kwargs):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, **kwargs)


def pyinstaller(version: str, with_ai: bool):
    env = dict(os.environ, RADIO_BUILD_VERSION=version, RADIO_BUILD_AI="1" if with_ai else "0")
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
         "--distpath", DIST, "--workpath", ROOT / "build",
         ROOT / "packaging" / "radio_translate.spec"], env=env, cwd=ROOT)


def build_windows(version: str, suffix: str) -> list[Path]:
    folder = DIST / APP
    outputs = []
    archive = shutil.make_archive(str(DIST / f"{APP}-{version}-windows-x64{suffix}"), "zip", DIST, APP)
    outputs.append(Path(archive))
    iscc = shutil.which("iscc") or next(
        (str(p) for p in (Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Inno Setup 6" / "ISCC.exe",
                          Path(os.environ.get("PROGRAMFILES", "")) / "Inno Setup 6" / "ISCC.exe") if p.exists()),
        None,
    )
    if iscc:
        from PIL import Image  # ikut terpasang lewat noisereduce
        icon = ROOT / "build" / "logo.ico"
        Image.open(ROOT / "static" / "logo.jpeg").save(icon, sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
        name = f"{APP}-{version}-windows-x64{suffix}-setup"
        run([iscc, f"/DAppVersion={version}", f"/DSourceDir={folder}", f"/DOutputDir={DIST}",
             f"/DOutputName={name}", f"/DIconFile={icon}", ROOT / "packaging" / "windows" / "installer.iss"])
        outputs.append(DIST / f"{name}.exe")
    else:
        print("Inno Setup (ISCC.exe) tidak ditemukan: hanya membuat .zip. Pasang dari https://jrsoftware.org/isinfo.php")
    return outputs


def build_macos(version: str, suffix: str) -> list[Path]:
    app = DIST / f"{APP}.app"
    arch = platform.machine()
    stage = ROOT / "build" / "dmg"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    run(["ditto", app, stage / f"{APP}.app"])
    (stage / "Applications").symlink_to("/Applications")
    dmg = DIST / f"{APP}-{version}-macos-{arch}{suffix}.dmg"
    dmg.unlink(missing_ok=True)
    run(["hdiutil", "create", "-volname", DISPLAY_NAME, "-srcfolder", stage, "-ov", "-format", "UDZO", dmg])
    return [dmg]


def build_linux(version: str, suffix: str) -> list[Path]:
    arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine(), platform.machine())
    stage = ROOT / "build" / "deb"
    shutil.rmtree(stage, ignore_errors=True)
    install_dir = stage / "opt" / DEB_NAME
    shutil.copytree(DIST / APP, install_dir, symlinks=True)
    (stage / "usr" / "bin").mkdir(parents=True)
    (stage / "usr" / "bin" / DEB_NAME).symlink_to(f"/opt/{DEB_NAME}/{APP}")
    (stage / "usr" / "share" / "applications").mkdir(parents=True)
    (stage / "usr" / "share" / "pixmaps").mkdir(parents=True)
    shutil.copy(ROOT / "static" / "logo.jpeg", stage / "usr" / "share" / "pixmaps" / f"{DEB_NAME}.jpeg")
    (stage / "usr" / "share" / "applications" / f"{DEB_NAME}.desktop").write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        f"Name={DISPLAY_NAME}\n"
        "Comment=Penerjemah Bahasa Papua dari radio\n"
        f"Exec=/opt/{DEB_NAME}/{APP}\n"
        f"Icon=/usr/share/pixmaps/{DEB_NAME}.jpeg\n"
        "Terminal=true\n"
        "Categories=AudioVideo;Utility;\n",
        encoding="utf-8",
    )
    size_kb = sum(f.stat().st_size for f in stage.rglob("*") if f.is_file() and not f.is_symlink()) // 1024
    (stage / "DEBIAN").mkdir()
    (stage / "DEBIAN" / "control").write_text(
        f"Package: {DEB_NAME}\n"
        f"Version: {version}\n"
        "Section: sound\n"
        "Priority: optional\n"
        f"Architecture: {arch}\n"
        # sounddevice di Linux memakai PortAudio dari sistem.
        "Depends: libportaudio2\n"
        f"Installed-Size: {size_kb}\n"
        f"Maintainer: {os.environ.get('DEB_MAINTAINER', 'Radio RTI Group <maintainer@localhost>')}\n"
        f"Description: {DISPLAY_NAME}\n"
        " Penerjemah Bahasa Papua ke Indonesia dari radio (Radio V1 Web-888, Radio V2 USB).\n",
        encoding="utf-8",
    )
    deb = DIST / f"{DEB_NAME}_{version}_{arch}{suffix}.deb"
    run(["dpkg-deb", "--root-owner-group", "--build", stage, deb])
    return [deb]


def main():
    parser = argparse.ArgumentParser(description="Bangun installer untuk OS ini.")
    parser.add_argument("--with-ai", action="store_true", help="ikutkan paket AI (torch, faster-whisper, ...)")
    args = parser.parse_args()
    if args.with_ai:
        import importlib.util
        if importlib.util.find_spec("faster_whisper") is None:
            sys.exit("Paket AI belum terpasang: jalankan dengan `uv run --locked --group build --extra ai ...`.")

    version = read_version()
    suffix = "-ai" if args.with_ai else ""
    pyinstaller(version, args.with_ai)
    system = platform.system()
    if system == "Windows":
        outputs = build_windows(version, suffix)
    elif system == "Darwin":
        outputs = build_macos(version, suffix)
    else:
        outputs = build_linux(version, suffix)
    print("\nSelesai:")
    for path in outputs:
        print(f"  {path}  ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
