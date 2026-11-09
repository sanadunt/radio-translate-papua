# Radio Translate Papua

Penerjemah Bahasa Papua (Ambai, Biak) ke Bahasa Indonesia dari radio, dengan speech-to-text
Whisper, terjemahan mBART dan TTS Indonesia.

- **Radio V1**: Web-888 (KiwiSDR) lewat jaringan, atau SDR++ (rigctl + rtl_tcp).
- **Radio V2**: perangkat radio USB, dijalankan di browser (Listener Kit, WebUSB) atau lewat server.

Cara menjalankan (klik dua kali, tanpa memasang Python): lihat **[CARA-MENJALANKAN.md](CARA-MENJALANKAN.md)**.

## Isi

| Path | Isi |
|---|---|
| `radio_launcher.py` | Pintu masuk: setelan, port, server (waitress), membuka jendela Chrome/Edge |
| `app_faster_whisper_lokal.py` | Backend Flask: rekam/VOX, Whisper, terjemahan, TTS, kontrol radio |
| `web888_client.py` | Radio V1: Web-888 lewat WebSocket |
| `hackrf_client.py` | Radio V2 lewat server (`hackrf_transfer`) dan simulasinya |
| `webusb_audio_bridge.py` | Audio Radio V2 dari browser untuk Rekam & Translate |
| `live_translator.py` | Mode Live: dengar terus, tiap PTT langsung ditranskrip & diterjemahkan |
| `templates/`, `static/` | Frontend |
| `static/radio-audio-filter.js` | Filter suara monitor: bandpass, peredam noise AI (GTCRN/Speex, `static/vendor/`), AGC |
| `listener_kit/` | Build Listener Kit (AGPL-3.0, lihat `listener_kit/SOURCE.md`) |
| `updater.py`, `rilis.sh` | Update otomatis dari GitHub Releases (lihat RILIS.md) |
| `model_setup.py` | Wizard Model AI: cek file model, simpan setelan |
| `packaging/` | Persiapan installer .exe/.dmg/.deb (belum diuji) |
| `tests/` | `npm test`, `npm run test:py`, `npm run test:e2e` |

Model AI tidak ada di repo ini (besar); ambil dari Google Drive, lihat CARA-MENJALANKAN.md.
