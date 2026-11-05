# Prompt video animasi: cara kerja Radio Translate Papua

Dokumen ini berisi (1) ringkasan teknis yang akurat sesuai kode aplikasi, dan
(2) prompt siap tempel untuk agen AI (Claude Code, dsb.) yang membuat video
animasi dengan **Remotion + Three.js**. Salin seluruh blok di bagian 2.

---

## 1. Ringkasan cara kerja (fakta, sesuai kode)

| Tahap | Yang terjadi | Detail teknis |
|---|---|---|
| Pemancar | Operator di Kepulauan Ambai (Kab. Kepulauan Yapen) atau Biak bicara lewat HT | VHF, contoh 155,700 MHz, mode NFM (bandwidth 12,5 kHz) |
| Radio V1 | Penerima jaringan **Web-888** (KiwiSDR) | Audio lewat WebSocket ±12 kHz, squelch dari S-meter (dBm); frekuensi HT digeser offset konverter −122,88 MHz. Alternatif: SDR++ (rigctl + rtl_tcp) |
| Radio V2 | Perangkat radio **USB** | (a) di browser: Listener Kit, WebUSB + DSP Rust/WebAssembly, audio 48 kHz; (b) lewat server: sampel IQ → FFT, mixer, FIR + decimate, demodulasi FM → audio 24 kHz |
| VOX / PTT | Rekaman dimulai saat squelch terbuka / RMS di atas ambang | Pre-roll 0,35 dtk, trigger 0,08 dtk, dilepas setelah 0,65 dtk hening; **satu tekan-lepas PTT = satu segmen ucapan** |
| Pembersihan audio | Per segmen | Buang DC → band-pass 280–3.400 Hz → reduksi noise (profil dari 0,5 dtk paling hening, 78%) → buang hening di ujung → soft gate → saturasi lembut (tanh) → pre-emphasis 0,97 → normalisasi → resample 16 kHz |
| Speech-to-text | **Whisper** hasil fine-tuning per bahasa (Ambai v2, Biak v4; 10 epoch) | faster-whisper / CTranslate2 int8, VAD Silero, beam 1. Input log-Mel spectrogram → encoder–decoder transformer → teks bahasa Papua. Segmen digabung dengan titik: "Kalimat 1. Kalimat 2." |
| Terjemahan | **mBART-50** (many-to-many) hasil fine-tuning "best BLEU" per bahasa | Teks dipecah per kalimat (maks. 80 kata per potongan), beam search 4 cabang, keluaran dipaksa bahasa Indonesia (token `id_ID`), maks. 128 token |
| Suara | TTS Bahasa Indonesia | Google TTS (gTTS), hasil di-cache |
| Antarmuka | Aplikasi web lokal (Flask) | Halaman Set Radio (spektrum, waterfall, frekuensi) dan Auto Translate (rekam, upload, teks, TTS) |

Yang **tidak** boleh dikarang di video: angka akurasi/BLEU, jumlah data latih,
dan contoh kalimat Ambai/Biak asli (pakai kalimat dari tim, atau tandai jelas
sebagai ilustrasi).

---

## 2. Prompt (salin mulai baris di bawah)

```text
Buat project video animasi penjelasan dengan Remotion (v4, TypeScript) dan Three.js
(lewat @remotion/three + @react-three/fiber + @react-three/drei).

=== Video ===
Judul   : "Radio Translate Papua — dari suara radio ke Bahasa Indonesia"
Format  : 1920x1080, 30 fps, ±90 detik (2700 frame), satu Composition "Explainer".
Bahasa  : Indonesia. Nada: jelas, modern, edukatif; untuk pejabat & tim lapangan.
Penonton: awam teknologi, jadi istilah teknis selalu diberi padanan sederhana.

=== Gaya visual (samakan dengan aplikasinya) ===
- Latar gelap teal: #041e21 → #0a3438 (gradien), garis halus rgba(88,214,214,0.22).
- Aksen cyan #3fe0e0 / #7bf3f3, amber #f2b544 (penanda frekuensi), hijau #57e39a (OK),
  merah #ff5f5f (noise/peringatan).
- Font: "Space Grotesk" (judul, label) dan "JetBrains Mono" (angka, frekuensi), lewat
  @remotion/google-fonts.
- Gaya: instrumen radio / dashboard SDR: grid tipis, glow lembut, scanline halus.
- Sebut perangkat sebagai "Radio V1 (Web-888)" dan "Radio V2 (USB)". Jangan memakai
  nama merek perangkat lain.

=== Aturan teknis Remotion (wajib) ===
- Semua animasi diturunkan dari useCurrentFrame() + interpolate()/spring(); JANGAN
  memakai useFrame/requestAnimationFrame/Date.now() untuk gerak, supaya render
  deterministik.
- Three.js di dalam <ThreeCanvas> dari @remotion/three, ukuran = ukuran video.
- Tidak ada Math.random() per frame; kalau butuh acak (noise, partikel) pakai seed
  tetap (mis. fungsi random(seed) dari remotion).
- Tiap adegan satu komponen di src/scenes/, dirangkai dengan <Series> atau <Sequence>;
  durasi adegan di satu file konstanta supaya mudah diatur.
- Transisi antar-adegan pendek (8–12 frame) memakai @remotion/transitions (fade/slide).
- Teks di layar ≤ 12 kata per baris; ukuran minimal 36 px.
- Siapkan slot audio: <Audio> untuk narasi (public/narasi.mp3, opsional) dan musik
  latar pelan; video tetap jalan tanpa file audio.
- Sediakan npm run dev (Remotion Studio) dan npm run render (out/explainer.mp4).

=== Adegan (durasi perkiraan) ===

1. Pembuka (0–6 dtk)
   3D: bola dunia low-poly berputar pelan lalu kamera menukik ke Papua, Teluk
   Cenderawasih. Dua penanda menyala: "Kepulauan Ambai" (−1,93; 136,35) dan
   "Biak" (−1,17; 136,08), masing-masing dilingkari garis putus-putus merah.
   Judul muncul: "Radio Translate Papua".
   Narasi: "Di Papua, ratusan bahasa daerah dipakai sehari-hari, termasuk lewat radio."

2. Masalahnya (6–13 dtk)
   2D: operator di posko menerima suara radio berbahasa Ambai; gelembung kata
   berisi simbol "?" melayang. Teks: "Bagaimana memahami percakapan radio dalam
   bahasa daerah, secara langsung?"

3. Gelombang radio (13–25 dtk)
   3D: HT memancarkan gelombang (cincin cyan mengembang) di 155,700 MHz, mode NFM.
   Gelombang mencapai antena lalu bercabang ke dua penerima:
   - Radio V1: kotak "Web-888" terhubung ke jaringan (garis data bergerak).
   - Radio V2: perangkat USB tercolok ke laptop; label "dibaca langsung oleh browser".
   Di bawahnya muncul spektrum (garis cyan) dan waterfall (biru→kuning→merah) yang
   bergulir, dengan garis amber di 155,700 MHz.
   Narasi: "Sinyal radio ditangkap penerima, lalu tampil sebagai spektrum."

4. Dari sinyal ke suara (25–33 dtk)
   2D: titik-titik IQ berputar (diagram konstelasi) → kotak "Demodulasi FM" →
   bentuk gelombang audio. Label kecil: "sinyal digital → suara".

5. Memotong per ucapan: VOX/PTT (33–42 dtk)
   2D: garis waktu audio panjang. Meter sinyal naik melewati garis ambang (squelch
   terbuka) → blok "Ucapan #1" tersorot; turun di bawah ambang selama 0,65 dtk →
   blok ditutup. Ulangi untuk "Ucapan #2". Tampilkan "pre-roll 0,35 dtk" sebagai
   bagian awal blok yang ikut terambil.
   Narasi: "Setiap kali tombol bicara ditekan lalu dilepas, satu ucapan direkam utuh."

6. Membersihkan audio (42–52 dtk)
   2D: satu spektrogram melewati rangkaian filter berurutan seperti ban berjalan;
   setiap stasiun membuat gambar sedikit lebih bersih:
   band-pass 280–3.400 Hz → reduksi noise → buang hening → penguat lembut →
   normalisasi → 16 kHz. Noise digambar sebagai bintik merah yang menghilang.

7. Suara menjadi teks: Whisper (52–64 dtk)
   3D/2D: spektrogram log-Mel masuk ke "encoder" (tumpukan lapisan bercahaya), lalu
   "decoder" mengeluarkan token satu per satu yang menyusun teks bahasa Papua.
   Label: "Whisper, dilatih khusus untuk Ambai dan Biak".
   Teks keluaran: gunakan placeholder "[kalimat Ambai dari tim]"; jangan mengarang
   kalimat bahasa Ambai.
   Dua ucapan digabung: "[ucapan 1]. [ucapan 2]."

8. Menerjemahkan: mBART-50 (64–76 dtk)
   2D: kalimat Papua dipecah per kalimat → model penerjemah (encoder–decoder) →
   pohon beam search dengan 4 cabang kandidat, cabang terbaik menyala hijau →
   kalimat Bahasa Indonesia "[terjemahan dari tim]".
   Label: "Model terjemahan, keluaran dipaksa Bahasa Indonesia".

9. Hasil di aplikasi (76–84 dtk)
   2D: mock-up layar aplikasi (gaya dashboard di atas): halaman Set Radio
   (spektrum + waterfall) bergeser ke halaman Auto Translate yang menampilkan teks
   Papua dan terjemahan Indonesia; ikon speaker berdenyut: "dibacakan otomatis (TTS)".

10. Ringkasan & penutup (84–90 dtk)
    Diagram alur horizontal yang menyala bergantian:
    Radio → Potong per ucapan → Bersihkan → Whisper → Terjemahan → Suara Indonesia.
    Penutup: logo/teks "Radio RTI Group", "Auto Translate Bahasa Papua".

=== Narasi lengkap ===
Tulis juga file narasi.txt berisi naskah voice-over per adegan (Bahasa Indonesia,
±170 kata total), sinkron dengan durasi di atas.

=== Hasil yang diminta ===
Project Remotion lengkap yang bisa dijalankan (npm i, npm run dev, npm run render),
README singkat cara mengganti teks contoh, durasi adegan, dan file audio.
```
