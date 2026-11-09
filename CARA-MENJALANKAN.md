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

## Auto Translate: Live dan Manual

**Live** (bawaan): sambungkan radio di **Set Radio**, buka **Auto Translate**, lalu
tekan **Mulai Live**. Radio didengar terus; setiap kali PTT dilepas, ucapan itu
langsung ditranskrip dan diterjemahkan, lalu muncul sebagai kartu (terbaru di atas)
dengan jam, frekuensi, teks Papua dan terjemahan Indonesia. Centang **Bacakan
terjemahan otomatis** untuk TTS. Semua ucapan juga tersimpan di halaman **Rekaman**.
Selama Live berjalan, Rekam & Translate manual tidak bisa dipakai (radionya sama).

**Otomatis (selalu dengarkan)**: centang di bar Live supaya operator tidak perlu
menekan apa pun. Live mulai sendiri begitu ada radio tersambung di Set Radio, terus
mendengarkan, menunggu (bukan berhenti) saat audio hilang sementara, dan pindah
sendiri bila sumber radio berganti. Setiap suara yang masuk direkam ke halaman
**Rekaman**. Setelannya tersimpan (`live-settings.json`), jadi tetap nyala setelah
aplikasi dibuka ulang; tinggal sambungkan radio. **Hentikan Live** sekaligus
mematikan Otomatis; centang lagi untuk menyalakan.

**Manual (cara lama)**: tab kedua di Auto Translate. Isinya sama seperti dulu:
rekam satu sesi, unggah WAV/MP3, atau ketik teks Papua.

Live memproses dalam dua tahap yang berjalan bersamaan: begitu Whisper selesai,
teks Papua langsung tampil ("Menerjemahkan…"), lalu terjemahannya menyusul di kartu
yang sama. Ucapan berikutnya sudah ditranskrip selagi ucapan sebelumnya diterjemahkan,
dan ucapan yang datang beruntun masuk antrian (tidak ada yang terlewat). Setiap kartu
menunjukkan lama tiap tahap ("teks 0,3 dtk · terjemahan 0,5 dtk").

Dengan GPU NVIDIA 6 GB ke atas (mis. RTX 3070), Whisper dan model terjemahan dimuat
sekali saat aplikasi dibuka dan tetap di GPU (`YALI_LOW_VRAM_MODE`). Terjemahan memakai
**CTranslate2** di CUDA, mesin yang sama dengan faster-whisper, dan biasanya beberapa
kali lebih cepat dari cara lama. Pertama kali dipakai, model `best_bleu_*` dikonversi
otomatis ke folder `best_bleu_*-ct2` di sebelahnya (sekali, sekitar 1 menit, +1,2 GB
per bahasa). Selama konversi terjemahan tetap jalan dengan cara lama. Kalau model
diganti, konversi diulang sendiri. Untuk kembali ke cara lama:
`YALI_MT_BACKEND=transformers` di `radio-translate.env`. Pill model di Hasil Live
menunjukkan GPU yang dipakai; arahkan kursor ke pill itu untuk melihat mesin Whisper
dan terjemahan.

## GPU dan log

Bar di bawah kontrol Live menunjukkan GPU NVIDIA (beban sekarang dan puncak beberapa
detik terakhir, VRAM, suhu) serta mesin Whisper dan terjemahan yang dipakai. Wajar
bila di Task Manager GPU Intel terlihat sibuk dan GPU NVIDIA seperti diam: browser
(tampilan, spektrum) memakai GPU Intel, sedangkan Whisper dan terjemahan memakai
NVIDIA lewat CUDA hanya sepersekian detik per ucapan. Beban CUDA tampil di grafik
"Cuda"/"Compute" Task Manager (klik judul grafik "3D" lalu pilih), bukan di "3D".

GPU 4 GB (mis. RTX 3050 Laptop): sebelum model terjemahan dikonversi ke CTranslate2,
Whisper dan terjemahan bergantian dimuat dari disk. Setelah konversi (otomatis, sekali)
keduanya muat bersamaan di GPU dan tidak dimuat ulang lagi.

Log ada di folder `logs/` (tombol **Buka folder log** di bar GPU): `radio-translate.log`
untuk sesi sekarang, `radio-translate.1.log` … `.10.log` untuk 10 sesi sebelumnya.
Setiap baris diberi jam, dan setiap ucapan Live dicatat lengkap: lama audio, lama
Whisper dan terjemahan beserta mesinnya, kapan teks tampil, VRAM, dan teksnya.

## Filter suara radio

Di **Set Radio → Listener → Filter suara** (berlaku untuk Radio V1 · Web-888 dan
Radio V2 lewat server):

| Preset | Isi | Kapan dipakai |
|---|---|---|
| Mati | suara asli | membandingkan |
| Ringan | pita suara HT 300–3400 Hz, perjelas suara, AGC | sinyal sudah bersih tapi pelan |
| **Standar** (bawaan) | pita 300–3000 Hz + peredam noise AI GTCRN + perjelas + AGC | desis/noise biasa |
| Kuat | Standar + pita lebih sempit + sela ucapan dibisukan | noise berat |

Pilihan di bawahnya bisa diubah satu per satu (peredam noise GTCRN atau Speex,
penguat 0 sampai +18 dB, dsb.); setelan diingat browser. Filter hanya mengubah
suara yang **didengar**: rekaman dan Whisper tetap memakai suara asli, karena
denoise sebelum Whisper justru sering menambah salah dengar.
Radio V2 · USB di browser memutar suaranya sendiri di panel radio, jadi filter
ini belum berlaku untuk sumber itu.

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

Klik **Cek update** di kanan atas (aplikasi juga mengecek sendiri saat dibuka).
Bila ada versi baru, tombol menjadi **Update ke vX**: klik, konfirmasi, lalu tutup
dan buka lagi aplikasinya. Tidak perlu git, cukup internet ke GitHub. Model AI,
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
