#!/usr/bin/env bash
# Radio Translate Papua (macOS & Linux): ./jalankan.sh [--port 5050] [--no-browser]
# Pertama kali: memasang uv (pengelola Python), lalu Python 3.12 dan semua
# dependency otomatis sesuai uv.lock. Paket AI ikut dipasang bila ada folder
# model (models/ atau whisper-*) di folder ini, bila wizard "Model AI" menyimpan
# RADIO_AI=1 di radio-translate.env, atau bila variabel RADIO_AI=1.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
    echo "Memasang uv, pengelola Python, sekali saja..."
    curl -LsSf https://astral.sh/uv/install.sh | sh || { echo "Gagal memasang uv. Cek koneksi internet."; exit 1; }
    export PATH="$HOME/.local/bin:$PATH"
fi

extras=()
if [ -d models ] || compgen -G "whisper-*/" >/dev/null; then extras=(--extra ai); fi
# Pilihan wizard "Model AI" di halaman (disimpan di radio-translate.env).
if [ -f radio-translate.env ]; then
    grep -q '^RADIO_AI=1' radio-translate.env && extras=(--extra ai)
    grep -q '^RADIO_AI=0' radio-translate.env && extras=()
fi
[ "${RADIO_AI:-}" = "1" ] && extras=(--extra ai)
[ "${RADIO_AI:-}" = "0" ] && extras=()

exec uv run --locked "${extras[@]}" python radio_launcher.py "$@"
