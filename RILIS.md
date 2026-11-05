# Rilis & update otomatis

Aplikasi mengecek **GitHub Releases** repo ini setiap kali halaman dibuka. Bila ada
rilis yang lebih baru dari versi di `pyproject.toml`, muncul tombol **Update ke vX**
di kanan atas. Satu klik memasang update; aplikasi lalu ditutup dan dibuka lagi
lewat script `Jalankan-…` (dependency ikut disesuaikan bila `uv.lock` berubah).

Syarat: repo **public** (API rilis GitHub tanpa login hanya bisa membaca repo public).

## Membuat rilis (developer)

```bash
./rilis.sh 1.1.0
```

Script itu: cek tidak ada perubahan yang belum di-commit → `npm test` & `npm run test:py`
→ ubah versi di `pyproject.toml` + `uv lock` → commit + tag `v1.1.0` → push →
`gh release create` dengan catatan otomatis dari commit. Hanya commit yang sudah
dirilis yang sampai ke pengguna; push biasa ke `main` tidak memicu update.

Versi mengikuti `X.Y.Z`: naikkan Z untuk perbaikan kecil, Y untuk fitur baru.

## Cara update dipasang

| Cara aplikasi dipasang | Yang dilakukan tombol Update |
|---|---|
| Download ZIP dari GitHub | Unduh ZIP rilis, timpa file kode. File lama disalin ke `update-backup/v<versi lama>/` |
| `git clone` | `git pull --ff-only` (gagal dengan pesan jelas bila ada perubahan lokal) |
| Installer (.exe/.app) | Membuka halaman rilis untuk mengunduh installer baru |

Tidak pernah disentuh: model AI (`models/`, `whisper-*`, `best_bleu_*`), `.venv`,
`radio-translate.env`, `logs/`, `rekaman_radio/`, `.git`.

Setelan: `RADIO_UPDATE_CHECK=0` di `radio-translate.env` mematikan pengecekan;
`RADIO_UPDATE_REPO=pemilik/repo` memakai repo lain (mis. fork).

Kembali ke versi lama (mode ZIP): salin isi `update-backup/v<versi>/` ke folder
aplikasi, lalu buka ulang.
