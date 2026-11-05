#!/usr/bin/env bash
# Membuat rilis baru di GitHub = update yang diterima semua aplikasi terpasang.
#   ./rilis.sh 1.1.0
# Langkah: cek folder bersih -> test -> versi di pyproject.toml + uv.lock ->
# commit + tag v1.1.0 -> push -> GitHub Release (catatan dibuat otomatis dari commit).
# Butuh: git, uv, node, gh (sudah login). Lihat RILIS.md.
set -euo pipefail
cd "$(dirname "$0")"

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Pakai: ./rilis.sh X.Y.Z   (contoh: ./rilis.sh 1.1.0)"
    exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
    echo "Masih ada perubahan yang belum di-commit. Commit atau simpan dulu (git status)."
    exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
    echo "Tag v$version sudah ada."
    exit 1
fi

echo "== Test"
npm test
npm run test:py

echo "== Versi $version"
uv run --no-project python - "$version" <<'PY'
import pathlib, re, sys
path = pathlib.Path("pyproject.toml")
text = path.read_text(encoding="utf-8")
new, count = re.subn(r'(?m)^version = "[^"]*"$', f'version = "{sys.argv[1]}"', text, count=1)
if count != 1:
    sys.exit("Baris version di pyproject.toml tidak ditemukan.")
path.write_text(new, encoding="utf-8")
PY
uv lock

echo "== Commit, tag & push"
git add pyproject.toml uv.lock
git commit -m "Rilis v$version"
git tag -a "v$version" -m "Rilis v$version"
git push origin HEAD "v$version"

echo "== GitHub Release"
gh release create "v$version" --title "v$version" --generate-notes
echo "Selesai: aplikasi yang terpasang akan menawarkan update ke v$version saat dibuka."
