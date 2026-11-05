# Cara menjalankan Radio Translate Papua

Tidak perlu memasang Python sendiri. Script di folder ini memasang **uv** (pengelola
Python) sekali saja, lalu uv mengunduh Python 3.12 dan semua dependency persis
sesuai `uv.lock`. Run pertama butuh internet dan beberapa menit; berikutnya
langsung jalan.

| OS | Cara |
|---|---|
| Windows | Klik dua kali **`Jalankan-Windows.bat`** |
| macOS | Klik dua kali **`Jalankan-macOS.command`** (pertama kali: klik kanan → Open) |
| Linux | `./jalankan.sh` (sekali saja: `sudo apt install libportaudio2`) |

Aplikasi terbuka sendiri sebagai jendela Chrome/Edge di **http://localhost:5050**.
Membuka script lagi saat aplikasi masih jalan cukup membuka jendelanya lagi.
Untuk menutup: tombol **Tutup Aplikasi** di kanan atas halaman (atau tutup jendela
konsol / Ctrl+C).

Radio V2 · USB di browser butuh **Chrome atau Edge** (WebUSB). Browser lain tetap
bisa memakai Radio V1 dan Auto Translate.

## Model AI

- **Tanpa model** (sekarang): aplikasi otomatis jalan dalam *mode tanpa model*;
  semua fitur radio, rekam dan upload jalan, hasil Whisper/terjemahan berupa teks
  penanda `[TANPA MODEL]`.
- **Dengan model**: taruh folder model dari Google Drive (`whisper-ambai-…`,
  `whisper-biak-…`, `best_bleu_ambai`, `best_bleu_biak`) di folder ini (atau di
  subfolder `models/`), lalu jalankan script lagi. Script otomatis ikut memasang
  paket AI (torch versi CUDA di Windows/Linux, ±3 GB, sekali saja).
  Paksa dengan `RADIO_AI=1` atau `RADIO_AI=0`.

## Setelan

Run pertama membuat **`radio-translate.env`** di folder ini, berisi semua setelan
dengan penjelasan (port, akses dari HP di jaringan yang sama, offset Web-888,
alamat rigctl/rtl_tcp, gain Radio V2, ...). Hapus tanda `#` di depan baris untuk
mengaktifkan, lalu jalankan ulang. Log ada di `logs/radio-translate.log`.

Pilihan baris perintah: `--port 5055`, `--host 127.0.0.1`, `--no-browser`,
`--data-dir <folder>` (contoh: `./jalankan.sh --no-browser`).

## Cara lama

`python app_faster_whisper_lokal.py` tetap jalan seperti sebelumnya (membuat
`.venv` dan memasang dependency sendiri, port 5000).

## Untuk pengembang

```bash
npm test          # adaptor Listener Kit
npm run test:py   # launcher
npm run test:e2e  # Chrome headless; aplikasi harus jalan di localhost:5050
```

`packaging/` berisi persiapan installer (.exe / .dmg / .deb lewat PyInstaller);
**belum dibangun maupun diuji**.
