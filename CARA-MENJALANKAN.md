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

## Model AI (wizard)

Saat pertama dibuka, aplikasi menampilkan wizard **Model AI** (bisa dibuka lagi
kapan saja lewat tombol **Model AI** di kanan atas):

- **Hanya radio dulu**: spektrum, radio, rekam dan upload jalan tanpa AI; hasil
  Whisper/terjemahan berupa teks penanda `[TANPA MODEL]`.
- **Pakai AI penerjemah**: pilih folder model (tombol *Pilih folder…* atau ketik
  path). Wizard memeriksa setiap model dan menyebut **file apa yang kurang**,
  termasuk folder berlapis hasil ekstrak zip. Model Ambai wajib lengkap, Biak
  boleh menyusul. Setelah disimpan: tutup aplikasi lalu jalankan lagi script
  `Jalankan-…`; paket AI (torch CUDA di Windows/Linux, ±3 GB) dipasang otomatis
  sekali.
- **Lewati sementara**: tutup wizard untuk sesi ini saja.

Wizard muncul lagi otomatis bila AI dipilih tapi ada file model atau paket AI
yang kurang. Aplikasi tidak pernah mengunduh model sendiri.

Folder model dari Google Drive (nama harus persis sama):

| Folder | Isi wajib |
|---|---|
| `whisper-ambai-v2-10epochs-faster-whisper` | `model.bin`, `config.json`, `tokenizer.json`, `vocabulary.json` |
| `whisper-biak-v4-10epochs-faster-whisper` | sama |
| `best_bleu_ambai` | `config.json`, `model.safetensors`, `tokenizer.json`, `tokenizer_config.json` |
| `best_bleu_biak` | sama |

Pilihan wizard tersimpan di `radio-translate.env` (`RADIO_SETUP_DONE`,
`RADIO_AI`, `YALI_MODEL_DIR`, `YALI_NO_MODEL`). Tanpa wizard: taruh folder model
di folder ini (atau `models/`) dan script otomatis memasang paket AI; paksa
dengan variabel `RADIO_AI=1` atau `RADIO_AI=0`.

## Setelan

Run pertama membuat **`radio-translate.env`** di folder ini, berisi semua setelan
dengan penjelasan (port, akses dari HP di jaringan yang sama, offset Web-888,
alamat rigctl/rtl_tcp, gain Radio V2, ...). Hapus tanda `#` di depan baris untuk
mengaktifkan, lalu jalankan ulang. Log ada di `logs/radio-translate.log`.

Pilihan baris perintah: `--port 5055`, `--host 127.0.0.1`, `--no-browser`,
`--data-dir <folder>` (contoh: `./jalankan.sh --no-browser`).

## Update

Saat dibuka, aplikasi mengecek rilis terbaru di GitHub. Bila ada versi baru, klik
**Update ke vX** di kanan atas, lalu tutup dan buka lagi aplikasinya. Model AI,
rekaman dan setelan tidak disentuh. Detail & cara membuat rilis: [RILIS.md](RILIS.md).

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
