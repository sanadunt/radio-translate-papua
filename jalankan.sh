#!/usr/bin/env bash
# Radio Translate Papua (macOS & Linux): ./jalankan.sh [--port 5050] [--no-browser]
# Pertama kali: memasang uv (pengelola Python), lalu Python 3.12 dan semua
# dependency otomatis sesuai uv.lock. Paket AI ikut dipasang bila ada folder
# model (models/ atau whisper-*) di folder ini, atau bila RADIO_AI=1.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
    echo "Memasang uv, pengelola Python, sekali saja..."
    curl -LsSf https://astral.sh/uv/install.sh | sh || { echo "Gagal memasang uv. Cek koneksi internet."; exit 1; }
    export PATH="$HOME/.local/bin:$PATH"
fi

extras=()
if [ -d models ] || compgen -G "whisper-*/" >/dev/null; then extras=(--extra ai); fi
[ "${RADIO_AI:-}" = "1" ] && extras=(--extra ai)
[ "${RADIO_AI:-}" = "0" ] && extras=()

exec uv run --locked "${extras[@]}" python radio_launcher.py "$@"
