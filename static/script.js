(() => {
  'use strict';

  /* ============================================================
     KONFIGURASI BACKEND
     Karena halaman ini di-render oleh Flask (render_template) dan
     dibuka lewat http://<host>:5000/, kita pakai path relatif saja
     supaya otomatis memanggil origin yang sama (tanpa masalah CORS).
     ============================================================ */
  const API_BASE = '';

  /* ============================================================
     VIDEO PENGANTAR (Home)
     Isi salah satu dari:
       - nama file video yang ditaruh di folder static/ Flask, format
         apa saja yang bisa diputar browser (mp4, webm, ogg, mov, mkv,
         dst), contoh: 'papua.mp4' -> otomatis diarahkan ke
         '/static/papua.mp4' (folder yang sama dengan logo & style.css)
       - path absolut di server, contoh: '/static/videos/intro.mp4'
       - URL video langsung (http/https) ke file video, contoh:
         'https://example.com/video/intro.mp4'
       - link YouTube (watch, youtu.be, shorts) atau Vimeo, contoh:
         'https://www.youtube.com/watch?v=XXXXXXXXXXX'
     Deteksi sumber & pemilihan pemutar (tag <video> vs iframe embed)
     dilakukan otomatis oleh resolveVideoSource(), lihat di bawah.
     Selama dikosongkan (''), tombol play akan menampilkan pesan
     yang jelas alih-alih memuat file yang tidak ada (mencegah 404).
     ============================================================ */
  const INTRO_VIDEO_URL = 'papua.mp4';

  /* ---- Deteksi sumber video: file langsung vs YouTube/Vimeo ---- */
  function getYouTubeVideoId(url){
    try{
      const u = new URL(url, window.location.href);
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'youtu.be'){
        return u.pathname.slice(1).split('/')[0] || null;
      }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com'){
        if (u.pathname === '/watch') return u.searchParams.get('v');
        const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?]+)/);
        if (m) return m[2];
      }
    } catch(e){ /* bukan URL absolut (kemungkinan path file lokal), abaikan */ }
    return null;
  }
  function getVimeoVideoId(url){
    try{
      const u = new URL(url, window.location.href);
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'vimeo.com' || host === 'player.vimeo.com'){
        const m = u.pathname.match(/(\d+)/);
        if (m) return m[1];
      }
    } catch(e){ /* abaikan */ }
    return null;
  }
  function resolveVideoSource(url){
    const ytId = getYouTubeVideoId(url);
    if (ytId) return { type: 'embed', embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0` };
    const vimeoId = getVimeoVideoId(url);
    if (vimeoId) return { type: 'embed', embedUrl: `https://player.vimeo.com/video/${vimeoId}?autoplay=1` };
    // Bukan YouTube/Vimeo -> anggap file video langsung, diputar lewat tag
    // <video> bawaan. PERBAIKAN: sebelumnya nama file polos (mis. 'papua.mp4')
    // dipakai apa adanya sebagai src, sehingga browser memintanya relatif ke
    // URL halaman ("/papua.mp4") -- BUKAN ke folder static Flask tempat file
    // itu sebenarnya berada ("/static/papua.mp4"), makanya video selalu gagal
    // dimuat ("no supported source was found") walau formatnya sudah benar.
    // Sekarang: URL absolut (http/https), path absolut ("/..."), maupun
    // data: URL dipakai apa adanya; selain itu otomatis diarahkan ke
    // "/static/<nama>", sama seperti logo & style.css di index.html.
    const isAbsolute = /^([a-z][a-z0-9+.-]*:)?\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:');
    const directUrl = isAbsolute ? url : `/static/${url.replace(/^\.?\//, '')}`;
    return { type: 'direct', directUrl };
  }

  /* ============================================================
     UTILITIES
     ============================================================ */
  const $ = (id) => document.getElementById(id);

  function formatMHz(hz){
    return (hz / 1_000_000).toFixed(6);
  }
  function formatMHzShort(hz){
    return (hz / 1_000_000).toFixed(3);
  }
  // Label MHz dengan jumlah desimal yang menyesuaikan besar step antar-tick
  // (mis. step 50 kHz -> "32.60 MHz", step 500 kHz -> "32.5 MHz"), supaya
  // ruler tidak penuh sesak dengan digit yang tidak perlu saat di-zoom out,
  // sekaligus tetap presisi saat di-zoom in -- mirip label pada gambar
  // referensi ("32.60 MHz", "32.65 MHz", dst).
  function formatMHzForStep(hz, stepHz){
    const decimals = stepHz >= 1_000_000 ? 0 : (stepHz >= 100_000 ? 1 : (stepHz >= 10_000 ? 2 : 3));
    return (hz / 1_000_000).toFixed(decimals);
  }
  // Menghitung "step" antar-tick yang rapi (1, 2, atau 5 dikali kelipatan 10)
  // dari sebuah perkiraan kasar -- teknik umum untuk auto-scaling ruler/grid
  // supaya jaraknya selalu bulat & enak dibaca, bukan angka pecahan aneh.
  function niceStep(roughStep){
    if (!(roughStep > 0)) return 1;
    const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const frac = roughStep / pow10;
    let niceFrac;
    if (frac <= 1) niceFrac = 1;
    else if (frac <= 2) niceFrac = 2;
    else if (frac <= 5) niceFrac = 5;
    else niceFrac = 10;
    return niceFrac * pow10;
  }
  function formatHz(hz){
    return Math.round(hz).toLocaleString('id-ID') + ' Hz';
  }
  function formatKHz(hz){
    return (hz / 1000).toFixed(2);
  }
  function clamp(v, min, max){
    return Math.min(max, Math.max(min, v));
  }
  function setSliderFill(slider){
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--fill', pct + '%');
  }
  function truncateForLog(text, max = 90){
    if (!text) return '(kosong)';
    return text.length > max ? text.slice(0, max) + '…' : text;
  }
  async function safeJson(res){
    try { return await res.json(); }
    catch(e){ return { ok: false, error: `Respons server tidak valid (HTTP ${res.status}).` }; }
  }

  /* ============================================================
     LOG CONSOLE
     ============================================================ */
  const logBox = $('logBox');

  function log(message, type = 'info'){
    const line = document.createElement('div');
    line.className = `log-line type-${type}`;
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    line.innerHTML = `<span class="log-time">[${time}]</span><span class="log-msg"></span>`;
    line.querySelector('.log-msg').textContent = message;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function logLangWarningIfAny(data){
    if (data && data.lang_warning){
      log(`Peringatan bahasa: ${data.lang_warning}`, 'warn');
    }
  }

  // Label "Siap" pada status pill sekarang mengikuti bahasa Papua yang
  // sedang aktif ("Ambai Siap" / "Biak Siap"), bukan cuma "Siap" polos --
  // supaya operator selalu tahu bahasa mana yang sedang dipakai hanya
  // dengan melihat status pill. `selectedPapuaLang` di sini dibaca lewat
  // closure (diisi belakangan di bagian "Pilih Bahasa Papua"), aman karena
  // fungsi ini hanya benar-benar dipanggil saat event terjadi, bukan saat
  // skrip pertama kali dijalankan.
  const PAPUA_LANG_LABELS = { ambai: 'Ambai', biak: 'Biak' };
  function papuaSiapLabel(){
    const langLabel = PAPUA_LANG_LABELS[selectedPapuaLang] || '';
    return langLabel ? `${langLabel} Siap` : 'Siap';
  }

  $('clearLogBtn').addEventListener('click', () => {
    logBox.innerHTML = '';
    log('Log dibersihkan.', 'info');
  });

  /* ============================================================
     NAVIGASI HALAMAN (Home / Set Radio / Auto Translate)
     ============================================================ */
  const pages = {
    pageHome: $('pageHome'),
    pageSetRadio: $('pageSetRadio'),
    pageTranslate: $('pageTranslate'),
    pageRecords: $('pageRecords'),
  };
  const navButtons = {
    pageHome: $('navHomeBtn'),
    pageSetRadio: $('navSetRadioBtn'),
    pageTranslate: $('navTranslateBtn'),
    pageRecords: $('navRecordsBtn'),
  };

  function showPage(pageId){
    Object.entries(pages).forEach(([id, el]) => {
      const active = id === pageId;
      el.hidden = !active;
      el.classList.toggle('active', active);
      navButtons[id].setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (pageId === 'pageSetRadio') fitSetRadio();
    if (pageId === 'pageRecords'){
      fitRecords();
      loadRecords();
    }
  }

  // Set Radio dibuat pas satu layar (tanpa scroll halaman): tinggi .radio-console
  // = tinggi jendela dikurangi posisi atasnya, dalam satuan halaman yang sudah
  // di-scale (lihat DESIGN_WIDTH di index.html). Spektrum & waterfall / panel
  // Radio V2 lalu mengisi sisa tinggi lewat flex (style.css "LAYOUT RINGKAS").
  function fitHeightToWindow(el){
    const inner = $('scaleInner');
    if (!el || !inner) return;
    const scale = (inner.getBoundingClientRect().width / inner.offsetWidth) || 1;
    const top = (el.getBoundingClientRect().top - inner.getBoundingClientRect().top) / scale;
    const bottomPad = parseFloat(getComputedStyle(document.querySelector('.pages-wrap')).paddingBottom) || 0;
    const available = window.innerHeight / scale - top - bottomPad;
    el.style.height = `${Math.max(480, Math.floor(available))}px`;
  }

  function fitSetRadio(){
    if (pages.pageSetRadio.hidden) return;
    fitHeightToWindow(document.querySelector('.radio-console'));
    resizeScopeCanvases();
  }

  // Halaman Rekaman juga pas satu layar; tabelnya bergulir di dalam kotaknya.
  function fitRecords(){
    if (pages.pageRecords.hidden) return;
    fitHeightToWindow(document.querySelector('.records-layout'));
  }
  // Setelah applyScale() di index.html (juga dijadwalkan lewat requestAnimationFrame).
  window.addEventListener('resize', () => requestAnimationFrame(() => { fitSetRadio(); fitRecords(); }));

  Object.entries(navButtons).forEach(([id, btn]) => {
    btn.addEventListener('click', () => showPage(id));
  });

  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.goto));
  });



  
  /* ============================================================
     FREQUENCY PANEL (kontrol lokal untuk SDR/receiver eksternal —
     tidak ada endpoint backend terkait, jadi tetap murni UI)
     ============================================================ */
  const freqSlider = $('freqSlider');
  const freqMHzEl = $('freqMHz');
  const freqHzEl = $('freqHz');
  const freqManual = $('freqManual');
  const freqPresets = $('freqPresets');

  let currentFreq = Number(freqSlider.value);
  let userEditingFreq = false; // true selama slider sedang di-drag -> jangan ditimpa oleh polling
  // radio = HT + freqOffsetHz; dipakai buat konversi skala di canvas spektrum.
  // Tidak ada lagi kontrol manual di UI -- nilainya diambil otomatis dari
  // backend (kalibrasi HT <-> WEB-888 sudah tetap/otomatis sejak awal masuk).
  let freqOffsetHz = 0;

  function setFreqActivePreset(hz){
    freqPresets.querySelectorAll('.chip').forEach(chip => {
      chip.classList.toggle('active', Number(chip.dataset.freq) === hz);
    });
  }

  function updateToolbarFreq(hz){
    const el = $('toolbarFreqValue');
    if (el) el.textContent = formatMHz(hz);
  }

  // Update tampilan saja saat slider sedang digeser (live preview), belum kirim ke SDR++.
  // Ini port dari on_slider_drag() di sdrpp_gui_controller.py.
  function previewFreqDisplay(hz){
    const clamped = clamp(hz, Number(freqSlider.min), Number(freqSlider.max));
    freqSlider.value = clamped;
    setSliderFill(freqSlider);
    freqMHzEl.textContent = formatMHz(clamped);
    freqHzEl.textContent = formatHz(clamped) + '  (preview)';
    updateToolbarFreq(clamped);
  }

  // Terapkan frekuensi baru ke tampilan lalu KIRIM ke SDR++.
  // Ini port dari set_target_mhz()/geser()/apply_manual_entry()/on_slider_release().
  function commitFreqDisplay(hz, source = 'slider'){
    currentFreq = clamp(hz, Number(freqSlider.min), Number(freqSlider.max));
    freqSlider.value = currentFreq;
    setSliderFill(freqSlider);
    freqMHzEl.textContent = formatMHz(currentFreq);
    freqHzEl.textContent = formatHz(currentFreq);
    setFreqActivePreset(currentFreq);
    updateToolbarFreq(currentFreq);
    log(`Frekuensi diatur ke ${formatMHz(currentFreq)} MHz (${source}).`, 'ok');
    sendFreqToSdr(currentFreq);
  }

  // Terapkan frekuensi hasil baca-balik dari SDR++ (polling), TANPA mengirim ulang
  // (supaya tidak jadi loop tak berujung). Ini port dari _update_display().
  function applyRemoteFreq(hz){
    currentFreq = clamp(hz, Number(freqSlider.min), Number(freqSlider.max));
    freqSlider.value = currentFreq;
    setSliderFill(freqSlider);
    freqMHzEl.textContent = formatMHz(currentFreq);
    freqHzEl.textContent = formatHz(currentFreq);
    setFreqActivePreset(currentFreq);
    updateToolbarFreq(currentFreq);
  }

  /* ---- Komunikasi dengan SDR++ lewat backend (backend yang bicara rigctl) ---- */
  async function sendFreqToSdr(hz){
    if (listenerActive){
      listenerTune(hz);
      return;
    }
    try{
      const res = await fetch(`${API_BASE}/sdr/frequency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ freq_hz: Math.round(hz) })
      });
      const data = await safeJson(res);
      if (!data.ok) log(`SDR++: ${data.error}`, 'err');
    } catch(err){
      log(`Gagal mengirim frekuensi ke SDR++: ${err.message}`, 'err');
    }
  }

  async function sendModeToSdr(mode, bandwidthHz){
    if (listenerActive){
      listenerSetMode(mode, bandwidthHz);
      return;
    }
    try{
      const res = await fetch(`${API_BASE}/sdr/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, bandwidth_hz: Math.round(bandwidthHz) })
      });
      const data = await safeJson(res);
      if (!data.ok) log(`SDR++: ${data.error}`, 'err');
    } catch(err){
      log(`Gagal mengirim mode/bandwidth ke SDR++: ${err.message}`, 'err');
    }
  }

  /* ---- Offset frekuensi HT <-> WEB-888 (radio = frekuensi HT + offset) ----
     Sudah tidak ada kontrol manual di UI -- kalibrasi HT <-> WEB-888 dipakai
     otomatis dari backend (lihat WEB888_FREQ_OFFSET_HZ) sejak awal halaman
     dibuka, supaya frekuensi yang tampil di panel selalu langsung sama
     dengan frekuensi HT tanpa perlu diset manual. */
  async function loadFreqOffset(){
    try{
      const res = await fetch(`${API_BASE}/sdr/frequency-offset`);
      const data = await safeJson(res);
      // Sumber HackRF WebUSB tidak memakai offset backend (bisa datang terlambat).
      if (!data.ok || listenerActive) return;
      freqOffsetHz = Number(data.offset_hz) || 0;
    } catch(err){
      // Diamkan: backend/koneksi mungkin belum siap saat halaman baru dibuka.
    }
  }

  loadFreqOffset();

  // Beri tahu operator kalau backend jalan tanpa model AI (YALI_NO_MODEL).
  fetch(`${API_BASE}/health`).then(safeJson).then((data) => {
    if (data && data.no_model){
      log('Backend jalan TANPA MODEL AI: hasil Whisper & terjemahan hanya teks penanda "[TANPA MODEL]".', 'warn');
    }
  }).catch(() => { /* backend belum siap, abaikan */ });

  // Slider: preview live saat digeser (mouse masih ditekan)...
  freqSlider.addEventListener('input', () => {
    userEditingFreq = true;
    previewFreqDisplay(Number(freqSlider.value));
  });
  // ...baru kirim ke SDR++ saat mouse/jari dilepas (event 'change' pada <input type="range">
  // otomatis terpicu saat rilis, sama seperti on_slider_release() di GUI Tkinter).
  freqSlider.addEventListener('change', () => {
    commitFreqDisplay(Number(freqSlider.value), 'slider');
    userEditingFreq = false;
  });

  document.querySelectorAll('[data-freq-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      commitFreqDisplay(currentFreq + Number(btn.dataset.freqStep), 'tombol geser');
    });
  });

  $('freqSetBtn').addEventListener('click', () => {
    const val = parseFloat(freqManual.value.replace(',', '.'));
    if (isNaN(val) || val <= 0){
      log('Nilai frekuensi manual tidak valid.', 'err');
      freqManual.focus();
      return;
    }
    commitFreqDisplay(val * 1_000_000, 'input manual');
    freqManual.value = '';
  });

  freqManual.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('freqSetBtn').click();
  });

  freqPresets.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    commitFreqDisplay(Number(chip.dataset.freq), 'preset');
  });

  /* ============================================================
     BANDWIDTH PANEL (dikirim bersama mode lewat satu perintah
     rigctl "M <mode> <passband>", persis seperti set_bandwidth()
     di sdrpp_gui_controller.py)
     ============================================================ */
  const bwSlider = $('bwSlider');
  const bwValueEl = $('bwValue');
  const bwManual = $('bwManual');
  const bwPresets = $('bwPresets');
  const modeSelect = $('modeSelect');

  let currentBw = Number(bwSlider.value);
  let userEditingBw = false; // true selama slider bandwidth di-drag

  function setBwActivePreset(hz){
    bwPresets.querySelectorAll('.chip').forEach(chip => {
      chip.classList.toggle('active', Number(chip.dataset.bw) === hz);
    });
  }

  function previewBwDisplay(hz){
    const clamped = clamp(hz, Number(bwSlider.min), Number(bwSlider.max));
    bwSlider.value = clamped;
    setSliderFill(bwSlider);
    bwValueEl.textContent = formatKHz(clamped);
  }

  function commitBwDisplay(hz, source = 'slider'){
    currentBw = clamp(hz, Number(bwSlider.min), Number(bwSlider.max));
    bwSlider.value = currentBw;
    setSliderFill(bwSlider);
    bwValueEl.textContent = formatKHz(currentBw);
    setBwActivePreset(currentBw);
    log(`Bandwidth diatur ke ${formatKHz(currentBw)} kHz (${source}).`, 'ok');
    sendModeToSdr(modeSelect.value, currentBw);
  }

  function applyRemoteBw(hz){
    currentBw = clamp(hz, Number(bwSlider.min), Number(bwSlider.max));
    bwSlider.value = currentBw;
    setSliderFill(bwSlider);
    bwValueEl.textContent = formatKHz(currentBw);
    setBwActivePreset(currentBw);
  }

  bwSlider.addEventListener('input', () => {
    userEditingBw = true;
    previewBwDisplay(Number(bwSlider.value));
  });
  bwSlider.addEventListener('change', () => {
    commitBwDisplay(Number(bwSlider.value), 'slider');
    userEditingBw = false;
  });

  $('bwSetBtn').addEventListener('click', () => {
    const val = parseFloat(bwManual.value.replace(',', '.'));
    if (isNaN(val) || val <= 0){
      log('Nilai bandwidth manual tidak valid.', 'err');
      bwManual.focus();
      return;
    }
    commitBwDisplay(val * 1000, 'input manual');
    bwManual.value = '';
  });

  bwManual.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('bwSetBtn').click();
  });

  bwPresets.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    commitBwDisplay(Number(chip.dataset.bw), 'preset');
  });

  modeSelect.addEventListener('change', () => {
    log(`Mode demodulasi diganti ke ${modeSelect.value}.`, 'info');
    sendModeToSdr(modeSelect.value, currentBw);
  });

  /* ============================================================
     SINKRONISASI DUA ARAH DENGAN SDR++ (polling)
     Port dari _start_poll_thread() di sdrpp_gui_controller.py:
     baca frekuensi & mode/bandwidth dari SDR++ tiap 500ms, lalu
     update tampilan HANYA jika nilainya berbeda dan user sedang
     tidak menggeser slider yang bersangkutan.
     ============================================================ */
  let sdrFreqOnline = null; // null = belum dicek
  let sdrModeOnline = null;
  let sdrFreqFailStreak = 0;
  let sdrModeFailStreak = 0;
  // 502 di sini normal selama SDR++ (RigCTL) atau Web-888 belum disambungkan
  // dari halaman "Set Radio". Beri toleransi beberapa kegagalan dulu supaya
  // tidak langsung memunculkan peringatan begitu halaman baru dibuka.
  const SDR_FAIL_GRACE = 6; // ~6 x 500ms = 3 detik toleransi
  // PERBAIKAN BUG (lihat screenshot laporan): sebelumnya polling
  // /sdr/frequency & /sdr/mode jalan lewat setInterval tetap 500ms TANPA
  // guard overlap dan TANPA backoff. Saat backend mati/restart lama, 502
  // menumpuk terus tiap 500ms sampai akhirnya socket OS kehabisan buffer
  // (net::ERR_NO_BUFFER_SPACE) seperti di log console. Sekarang polling
  // dijadwalkan ulang sendiri (bukan interval tetap) + backoff bertahap
  // saat gagal beruntun, lalu kembali ke kecepatan normal begitu backend
  // online lagi.
  let sdrPollTimer = null;
  let sdrPollInFlight = false;
  const SDR_POLL_BASE_MS = 500;
  const SDR_POLL_MAX_MS = 5000;
  const SDR_POLL_BACKOFF_START = SDR_FAIL_GRACE; // baru mulai backoff setelah masa toleransi lewat

  async function pollSdrFrequency(){
    // Sumber HackRF WebUSB: frekuensi datang dari receiver:status kit, bukan backend.
    if (userEditingFreq || listenerActive) return;
    try{
      const res = await fetch(`${API_BASE}/sdr/frequency`);
      const data = await safeJson(res);
      if (!data.ok){
        sdrFreqFailStreak++;
        if (sdrFreqOnline !== false && sdrFreqFailStreak > SDR_FAIL_GRACE){
          sdrFreqOnline = false;
          log(`SDR++ (frekuensi): ${data.error}`, 'warn');
        }
        return;
      }
      sdrFreqFailStreak = 0;
      if (sdrFreqOnline !== true){
        sdrFreqOnline = true;
        log('Frekuensi radio terbaca dari backend.', 'ok');
      }
      if (Number.isFinite(Number(data.offset_hz))){
        freqOffsetHz = Number(data.offset_hz);
      }
      const freqHz = Number(data.freq_hz);
      if (Number.isFinite(freqHz) && freqHz !== currentFreq){
        applyRemoteFreq(freqHz);
      }
    } catch(err){
      if (sdrFreqOnline !== false) sdrFreqOnline = false;
    }
  }

  async function pollSdrMode(){
    if (userEditingBw || listenerActive) return;
    try{
      const res = await fetch(`${API_BASE}/sdr/mode`);
      const data = await safeJson(res);
      if (!data.ok){
        sdrModeFailStreak++;
        if (sdrModeOnline !== false) sdrModeOnline = false;
        return;
      }
      sdrModeFailStreak = 0;
      if (sdrModeOnline !== true) sdrModeOnline = true;

      const bwHz = Number(data.bandwidth_hz);
      if (Number.isFinite(bwHz) && bwHz !== currentBw){
        applyRemoteBw(bwHz);
      }

      const mode = String(data.mode || '').toUpperCase();
      if (mode && modeSelect.value !== mode){
        const hasOption = Array.from(modeSelect.options).some(opt => opt.value === mode);
        if (hasOption) modeSelect.value = mode;
      }
    } catch(err){
      sdrModeFailStreak++;
      if (sdrModeOnline !== false) sdrModeOnline = false;
    }
  }

  async function pollSdrOnce(){
    // Guard supaya request /sdr/frequency & /sdr/mode berikutnya tidak
    // ditembak sebelum yang sebelumnya selesai (mencegah request menumpuk
    // kalau backend lambat/mati) -- lihat catatan PERBAIKAN di atas.
    if (sdrPollInFlight) return;
    sdrPollInFlight = true;
    try{
      await Promise.all([pollSdrFrequency(), pollSdrMode()]);
    } finally {
      sdrPollInFlight = false;
      const failStreak = Math.max(sdrFreqFailStreak, sdrModeFailStreak);
      let delay = SDR_POLL_BASE_MS;
      if (failStreak > SDR_POLL_BACKOFF_START){
        const backoffLevel = Math.floor((failStreak - SDR_POLL_BACKOFF_START) / 4);
        delay = Math.min(SDR_POLL_MAX_MS, SDR_POLL_BASE_MS * Math.pow(2, backoffLevel));
      }
      sdrPollTimer = setTimeout(pollSdrOnce, delay);
    }
  }

  function startSdrPolling(){
    if (sdrPollTimer) clearTimeout(sdrPollTimer);
    pollSdrOnce();
  }

  /* ============================================================
     AUDIO PLAYER BERSAMA
     ============================================================ */
  const audioPlayer = $('audioPlayer');

  // Kalau playAudioUrl() dipanggil lagi sebelum play() sebelumnya selesai
  // (mis. klik cepat, atau dua sumber audio mau diputar hampir bersamaan),
  // pause() pada src baru membatalkan promise play() yang lama -> browser
  // melempar "AbortError: play() request was interrupted by a call to
  // pause()". Ini dijamin aman/normal, jadi kita: (1) antre pemanggilan
  // lewat rantai promise supaya tidak saling menimpa, dan (2) diamkan
  // AbortError-nya secara khusus alih-alih menampilkannya sebagai error.
  let audioPlayChain = Promise.resolve();

  // PERBAIKAN: status pill "Siap" sebelumnya diam saja saat audio sedang
  // diputar (radio/unggahan/TTS), jadi tidak "mengikuti" aksi playback di
  // front end. Sekarang pill menampilkan "Memutar Audio…" (tanpa kelas
  // .busy, karena ini bukan proses berat di backend) selama pemutaran,
  // lalu kembali ke "Siap" begitu audio selesai/berhenti/gagal.
  // PERBAIKAN: sebelumnya TIDAK ADA penanganan event 'error' pada elemen
  // <audio> bersama ini (dipakai oleh Play Audio Upload, Putar Audio Papua,
  // dan Play TTS). Kalau file audio dari backend gagal dimuat/diputar
  // (404, respons bukan audio, format tidak didukung, dll), tidak ada log
  // maupun perubahan status sama sekali -- pill tetap diam di "Siap" tanpa
  // keterangan apa pun. Sekarang error media ditangkap & dilaporkan jelas.
  function markPlayingStatus(){
    if (statusPill.classList.contains('busy')) return; // jangan timpa proses backend yang sedang berjalan
    statusPill.textContent = 'Memutar Audio…';
  }
  function resetPlayingStatus(){
    if (statusPill.classList.contains('busy')) return;
    statusPill.textContent = papuaSiapLabel();
  }
  audioPlayer.addEventListener('ended', resetPlayingStatus);
  audioPlayer.addEventListener('pause', resetPlayingStatus);
  audioPlayer.addEventListener('error', () => {
    if (!audioPlayer.currentSrc) return; // belum ada sumber yang dicoba, abaikan
    const codeMap = {1: 'dibatalkan', 2: 'jaringan gagal', 3: 'format/berkas rusak', 4: 'format tidak didukung browser'};
    const code = audioPlayer.error ? audioPlayer.error.code : null;
    const failedSrc = audioPlayer.currentSrc;
    log(`Audio gagal diputar (${codeMap[code] || 'tidak diketahui'}).`, 'err');
    resetPlayingStatus();
    // PERBAIKAN: kode error <audio> di atas (mis. "format tidak didukung
    // browser") cuma menjelaskan elemen <audio> gagal MEMAINKAN datanya --
    // padahal penyebab aslinya sering kali backend mengembalikan JSON error
    // (400/500, mis. /tts gagal generate suara karena server tidak ada
    // internet) alih-alih file audio asli, jadi pesan di atas jadi
    // membingungkan (seolah masalahnya format audio). Di sini kita cek
    // ulang sumber yang gagal tsb secara diam-diam: kalau isinya ternyata
    // JSON error dari backend, tampilkan pesan aslinya juga di log.
    fetch(failedSrc).then(async (res) => {
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || ct.includes('application/json')){
        try{
          const data = await res.json();
          if (data && data.error) log(`Penyebab sebenarnya (dari server): ${data.error}`, 'err');
        } catch(_e){ /* bukan JSON valid, biarkan pesan generik di atas saja */ }
      }
    }).catch(() => { /* pengecekan tambahan ini opsional, abaikan kalau gagal */ });
  });

  // PERBAIKAN TAMBAHAN: sebagai lapisan pengaman ekstra (selain perbaikan
  // race condition di atas), URL audio non-blob selalu ditambahkan penanda
  // waktu unik sebelum dipasang ke elemen <audio> -- supaya walau URL dari
  // backend kebetulan sama dengan permintaan sebelumnya, browser tetap
  // mengambil ulang berkasnya dari server, bukan memutar audio dari cache.
  function withCacheBust(url){
    if (url.startsWith('blob:') || url.startsWith('data:')) return url; // sudah unik/tidak di-cache HTTP
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_cb=${Date.now()}`;
  }

  function playAudioUrl(url, okMessage){
    // Status & log langsung tampil begini tombol ditekan (sinkron), tidak
    // menunggu promise play() selesai -- supaya selalu terlihat ada aksi
    // berjalan, walau audio ternyata gagal dimuat sesaat kemudian.
    statusPill.textContent = 'Memuat Audio…';
    statusPill.classList.remove('busy');
    log(`Memuat audio: ${url}`, 'info');

    audioPlayChain = audioPlayChain
      .catch(() => {}) // jangan biarkan kegagalan sebelumnya menghentikan antrean
      .then(() => {
        audioPlayer.pause();
        audioPlayer.src = withCacheBust(url);
        return audioPlayer.play();
      })
      .then(() => {
        markPlayingStatus();
        if (okMessage) log(okMessage, 'ok');
      })
      .catch(err => {
        if (err && err.name === 'AbortError'){
          // Race normal saat sumber audio diganti dengan cepat (mis. klik
          // ganda) -- tetap dicatat supaya tidak terlihat diam tanpa jejak.
          log('Pemutaran audio dibatalkan (sumber audio diganti).', 'warn');
          resetPlayingStatus();
          return;
        }
        log(`Tidak bisa memutar audio: ${err.message}`, 'err');
        resetPlayingStatus();
      });
  }

  /* ============================================================
     VOLUME CONTROL (di toolbar Set Radio, di samping tombol play)
     Mengatur volume elemen <audio> bersama yang dipakai untuk
     memutar rekaman radio maupun TTS.
     ============================================================ */
  const volumeSlider = $('volumeSlider');
  const volumeIcon = $('volumeIcon');

  function updateVolumeIcon(vol){
    if (!volumeIcon) return;
    volumeIcon.classList.toggle('muted', vol <= 0);
  }

  if (volumeSlider){
    audioPlayer.volume = Number(volumeSlider.value) / 100;
    setSliderFill(volumeSlider);
    updateVolumeIcon(audioPlayer.volume);

    volumeSlider.addEventListener('input', () => {
      const vol = clamp(Number(volumeSlider.value), 0, 100);
      audioPlayer.volume = vol / 100;
      setSliderFill(volumeSlider);
      updateVolumeIcon(audioPlayer.volume);
    });
  }

  if (volumeIcon){
    volumeIcon.addEventListener('click', () => {
      if (!volumeSlider) return;
      if (audioPlayer.volume > 0){
        volumeIcon.dataset.prevVol = volumeSlider.value;
        volumeSlider.value = 0;
      } else {
        volumeSlider.value = volumeIcon.dataset.prevVol || 100;
      }
      audioPlayer.volume = Number(volumeSlider.value) / 100;
      setSliderFill(volumeSlider);
      updateVolumeIcon(audioPlayer.volume);
    });
  }

  /* ============================================================
     AUDIO INPUT DEVICE — GET /devices
     ============================================================ */
  const deviceSelect = $('deviceSelect');
  const refreshBtn = $('refreshDevices');
  const statusPill = $('statusPill');
  const brandDot = $('brandDot');
  const brandLabel = $('brandLabel');

  // Titik status di header mengikuti koneksi ke backend (lihat startRmsPolling),
  // bukan nama perangkat input.
  function updateBrandDotFromDevice(){}

  async function loadDevices(){
    deviceSelect.disabled = true;
    deviceSelect.innerHTML = '<option>Memuat perangkat…</option>';
    try{
      const res = await fetch(`${API_BASE}/devices`);
      const data = await safeJson(res);
      if (!data.ok) throw new Error(data.error || 'Gagal memuat daftar perangkat.');

      deviceSelect.innerHTML = '';
      if (!data.devices.length){
        const opt = document.createElement('option');
        opt.textContent = 'Tidak ada perangkat input ditemukan';
        deviceSelect.appendChild(opt);
        log('Tidak ada perangkat input audio yang terdeteksi di server.', 'warn');
        return;
      }

      // Prioritas pemilihan otomatis perangkat CABLE: WASAPI > DirectSound > MME > WDM-KS.
      // CATATAN: 'Windows WDM-KS' sengaja ditaruh PALING BAWAH sekarang -- banyak
      // adapter USB audio melempar error PortAudio "Unanticipated host error
      // [PaErrorCode -9999]" / "usbTerminalGUID" kalau dibuka lewat WDM-KS
      // (bug driver yang dikenal luas), jadi jangan jadikan pilihan utama.
      const HOSTAPI_PRIORITY = ['WASAPI', 'Windows DirectSound', 'MME', 'Windows WDM-KS'];
      let bestCable = null; // { index, priority }

      data.devices.forEach((d) => {
        const hostapi = d.hostapi || '?';
        const isWdmKs = /wdm-ks/i.test(hostapi);
        const opt = document.createElement('option');
        opt.value = String(d.index);
        // Perangkat radio langsung (index negatif) cukup namanya; perangkat audio
        // lokal diberi nama driver-nya supaya bisa dibedakan.
        opt.textContent = d.index < 0
          ? d.name
          : `${d.name} (${hostapi})${isWdmKs ? ' — kurang stabil' : ''}`;
        deviceSelect.appendChild(opt);

        if (/cable/i.test(d.name)){
          let prio = HOSTAPI_PRIORITY.findIndex(p => hostapi.toLowerCase().includes(p.toLowerCase()));
          if (prio === -1) prio = HOSTAPI_PRIORITY.length; // tidak dikenal -> prioritas terendah
          if (!bestCable || prio < bestCable.priority) bestCable = { index: d.index, priority: prio };
        }
      });
      if (bestCable) deviceSelect.value = String(bestCable.index);

      updateBrandDotFromDevice();
      log(`Daftar perangkat audio diperbarui (${data.devices.length} perangkat).`, 'ok');
    } catch(err){
      deviceSelect.innerHTML = '<option>Gagal memuat perangkat</option>';
      log(`Gagal memuat perangkat dari server: ${err.message}`, 'err');
    } finally {
      deviceSelect.disabled = false;
      document.dispatchEvent(new Event('devices-loaded'));
    }
  }

  deviceSelect.addEventListener('change', () => {
    const opt = deviceSelect.options[deviceSelect.selectedIndex];
    log(`Perangkat input dipilih: ${opt ? opt.textContent : '-'}`, 'info');
    updateBrandDotFromDevice();
  });

  refreshBtn.addEventListener('click', () => {
    refreshBtn.style.transform = 'rotate(180deg)';
    setTimeout(() => { refreshBtn.style.transform = ''; }, 300);
    loadDevices();
  });

  /* ============================================================
     RMS METER — polling GET /rms
     ============================================================ */
  const rmsValueEl = $('rmsValue');
  const meterFill = $('meterFill');
  const thresholdToggle = $('thresholdToggle');
  const thresholdLabel = $('thresholdLabel');

  // PERBAIKAN: sebelumnya pill status HANYA punya 4 teks generik hardcode
  // ("Merekam Sinyal"/"Mendengarkan…"/"Memproses…"/"Siap") berdasarkan
  // `phase` saja -- jadi kalau backend sedang mengerjakan sesuatu yang
  // lebih spesifik (mis. "Transkripsi Whisper" vs "Menerjemahkan" vs
  // "Membuat suara TTS", semuanya cuma tampil "Memproses…"), dan endpoint
  // yang TIDAK mengubah `phase` sama sekali (translate-text/tts/preview
  // upload sebelum ini) pill-nya tidak mengikuti apa pun. Backend sekarang
  // selalu mengirim `label` (teks manusiawi, lihat pipeline.current_label
  // di app_faster_whisper_lokal.py) lewat /rms -- pill di sini SELALU
  // memakai teks itu apa adanya kalau ada, supaya keterangan yang tampil ke
  // user PERSIS mengikuti apa yang backend bilang, bukan tebakan lokal.
  // Kelas 'busy' (dot animasi) tetap ditentukan dari `phase`, bukan label.
  function applyPhaseToStatusPill(phase, label){
    switch(phase){
      case 'recording':
        statusPill.textContent = label || 'Merekam Sinyal';
        statusPill.classList.add('busy');
        break;
      case 'listening':
        statusPill.textContent = label || 'Mendengarkan…';
        statusPill.classList.remove('busy');
        break;
      case 'processing':
        statusPill.textContent = label || 'Memproses…';
        statusPill.classList.add('busy');
        break;
      default:
        statusPill.textContent = papuaSiapLabel();
        statusPill.classList.remove('busy');
    }
  }

  // PERBAIKAN: sebelumnya perubahan fase proses di backend (listening ->
  // recording -> processing -> idle) HANYA terlihat di status pill kecil,
  // tidak pernah tercatat di panel Log/Console -- jadi user tidak dapat
  // pemberitahuan yang jelas soal proses apa yang sedang berjalan di
  // belakang layar. Sekarang tiap kali fase BERUBAH (bukan tiap polling,
  // supaya log tidak banjir tiap 400ms), backend log satu baris ke console.
  // PERBAIKAN: log ini sekarang memakai `label` asli dari backend (kalau
  // ada) alih-alih teks generik per-fase, supaya konsisten dengan pill.
  // PERBAIKAN LANJUTAN: dedup SEBELUMNYA berdasarkan `phase` saja, jadi
  // selama satu siklus "Rekam & Translate Audio" (input HT sampai hasil
  // terjemahan keluar), banyak tahap berbeda (bersihkan noise -> transkripsi
  // Whisper -> menerjemahkan -> simpan berkas) semuanya berbagi `phase` yang
  // SAMA ("processing"), sehingga hanya tahap PERTAMA yang pernah tercatat
  // di log/console -- tahap-tahap berikutnya diam, padahal pill-nya sendiri
  // sudah berubah teks. Sekarang dedup dilakukan atas kombinasi
  // (phase + label), jadi SETIAP tahap yang punya keterangan berbeda dari
  // backend selalu tercatat satu baris log, dari mulai menunggu sinyal HT
  // sampai hasil akhir keluar.
  let lastLoggedKey = null;
  const PHASE_LOG_MESSAGES = {
    listening: 'Backend: menunggu sinyal PTT/VOX dari radio…',
    recording: 'Backend: sinyal terdeteksi, merekam audio…',
    processing: 'Backend: memproses audio (cleaning, Whisper, terjemahan)…',
    idle: 'Backend: proses selesai, kembali siap.',
  };
  function logBackendPhaseChange(phase, label){
    const normalizedPhase = phase || 'idle';
    const normalizedLabel = label || '';
    const key = normalizedPhase + '|' + normalizedLabel;
    if (key === lastLoggedKey) return;
    // Saat pertama kali polling jalan (belum ada fase sebelumnya), jangan
    // langsung log "idle" supaya console tidak berisik begitu halaman dibuka.
    const isFirstRead = lastLoggedKey === null;
    lastLoggedKey = key;
    if (isFirstRead && normalizedPhase === 'idle') return;
    const message = (normalizedPhase !== 'idle' && normalizedLabel)
      ? `Backend: ${normalizedLabel}`
      : PHASE_LOG_MESSAGES[normalizedPhase];
    if (message) log(message, normalizedPhase === 'idle' ? 'ok' : 'info');
  }

  let rmsPollTimer = null;
  let backendOnline = null; // null = belum dicek
  let rmsFailStreak = 0;
  // Backend butuh beberapa detik untuk load model (Whisper/torch) sebelum
  // Flask siap menerima koneksi. Beri toleransi beberapa kegagalan beruntun
  // dulu sebelum benar-benar menandai "SERVER OFFLINE", supaya tidak flapping
  // merah di log padahal cuma server masih booting.
  const RMS_FAIL_GRACE = 5; // ~5 x 400ms = 2 detik toleransi

  // BUG DITEMUKAN: elemen id="thresholdLabel" sudah tidak ada di index.html
  // (sudah dihapus dari UI), tapi baris `thresholdLabel.textContent = ...`
  // di bawah masih dipanggil TANPA pengecekan null, DI DALAM try block yang
  // SAMA dengan kode yang mengupdate status pill ("Siap") dan log console.
  // Karena thresholdLabel selalu null, baris itu SELALU melempar TypeError
  // setiap kali polling /rms jalan (tiap 400ms) -- error itu langsung
  // ditangkap oleh catch() di bawah, sehingga applyPhaseToStatusPill() dan
  // logBackendPhaseChange() TIDAK PERNAH SEMPAT DIPANGGIL. Akibatnya pill
  // status diam terus di "Siap" dan log console tidak pernah mencatat
  // proses backend (rekam/cleaning/Whisper/translate), walau backend-nya
  // sendiri sudah mengirim phase/label yang benar lewat /rms.
  //
  // PERBAIKAN: (1) elemen opsional yang mungkin tidak ada di HTML sekarang
  // dijaga dengan pengecekan null, dan (2) yang lebih penting, update
  // tampilan meter/threshold (non-kritis) dipisah ke try/catch-nya SENDIRI
  // dari update status pill + log console (kritis) -- supaya kalau ada
  // elemen UI lain yang suatu saat dihapus/berubah lagi, itu TIDAK PERNAH
  // BISA lagi diam-diam mem-block pemberitahuan proses ke user.
  function startRmsPolling(){
    if (rmsPollTimer) return;
    rmsPollTimer = setInterval(async () => {
      let data;
      try{
        const res = await fetch(`${API_BASE}/rms`);
        data = await safeJson(res);
        if (!data.ok) return;

        rmsFailStreak = 0;
        if (backendOnline !== true){
          backendOnline = true;
          brandLabel.textContent = 'TRANSLATE · ONLINE';
          brandDot.classList.remove('offline');
          log('Terhubung ke backend.', 'ok');
        }
      } catch(err){
        rmsFailStreak++;
        if (backendOnline !== false && rmsFailStreak > RMS_FAIL_GRACE){
          backendOnline = false;
          brandLabel.textContent = 'TRANSLATE · SERVER OFFLINE';
          brandDot.classList.add('offline');
          log('Tidak bisa terhubung ke backend (cek apakah server Flask sedang berjalan).', 'err');
        } else if (backendOnline === null){
          brandLabel.textContent = 'TRANSLATE · MENYAMBUNG…';
        }
        return;
      }

      // Tampilan meter/threshold: non-kritis, diisolasi supaya kalau salah
      // satu elemennya hilang dari HTML, itu tidak menjatuhkan update
      // status pill + log console di bawah.
      try{
        // Skala meter sama dengan backend (/rms): 1.2e-4 = 100%.
        const levelPct = clamp((data.rms / 1.2e-4) * 100, 0, 100);
        rmsValueEl.textContent = `${Math.round(levelPct)}%`;
        meterFill.style.width = Math.max(levelPct, 2) + '%';
        if (thresholdLabel){
          thresholdLabel.textContent = `Ambang: ${Math.round(clamp((data.threshold / 1.2e-4) * 100, 0, 100))}%`;
        }
        if (typeof data.squelch_open === 'boolean') setSquelchState(data.squelch_open);
      } catch(err){
        console.error('Gagal update tampilan meter RMS:', err);
      }

      // Status pill + log console: SELALU dijalankan selama respons /rms
      // berhasil, apa pun yang terjadi pada tampilan meter di atas -- ini
      // yang membuat user tahu proses apa yang sedang berjalan di backend.
      //
      // BUG DITEMUKAN: sebelumnya pill HANYA di-update dari sini kalau
      // `listening` sedang true ATAU phase backend bukan 'idle'. Begitu
      // sebuah proses satu-kali (mis. Upload & Translate, Translate Text,
      // Play TTS Indonesia, atau "Rekam & Simpan Audio" saat autoTtsToggle
      // dimatikan) SELESAI dan backend kembali ke phase 'idle' sementara
      // `listening` masih false, kondisi ini gagal -- pill TIDAK PERNAH
      // diberi tahu bahwa backend sudah selesai. Pill jadi tersangkut di
      // teks "Memproses…"/label proses terakhir (kelas .busy tetap ada)
      // selamanya, padahal logBackendPhaseChange() di baris berikutnya TETAP
      // berjalan tanpa syarat dan mencatat "Backend: proses selesai, kembali
      // siap." -- jadi pill & log console tidak pernah sinkron: log sudah
      // bilang selesai, pill masih menampilkan sedang berjalan.
      //
      // PERBAIKAN: pill sekarang SELALU disamakan dengan phase/label asli
      // dari backend, apa pun nilai `listening` -- backend (pipeline.
      // current_phase) adalah satu-satunya sumber kebenaran untuk SEMUA
      // proses (record-radio, upload, translate-text, tts), jadi input,
      // proses, dan output yang ditampilkan ke user selalu konsisten satu
      // sama lain, apa pun fitur yang sedang dijalankan.
      try{
        applyPhaseToStatusPill(data.phase, data.label);
        logBackendPhaseChange(data.phase, data.label);
      } catch(err){
        console.error('Gagal update status pill/log dari /rms:', err);
      }
    }, 400);
  }

  /* ============================================================
     LISTEN / RECORD RADIO — POST /record-radio, GET /last-audio.wav
     ============================================================ */
  const playRadioBtn = $('playRadioBtn');
  const playLastRecordingBtn = $('playLastRecordingBtn');
  const whisperOutput = $('whisperOutput');
  const translationOutput = $('translationOutput');
  const autoTtsToggle = $('autoTtsToggle');

  let listening = false;

  function playIcon(){
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 5v14l12-7L7 5z" fill="currentColor"/></svg>';
  }
  function pauseIcon(){
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
  }

  async function recordRadioCycle(opts = {}){
    const skipTranslate = !!opts.skipTranslate;
    const deviceIndex = deviceSelect.value;
    if (deviceIndex === '' || isNaN(Number(deviceIndex))){
      log('Pilih perangkat input audio terlebih dahulu.', 'err');
      return false;
    }
    // HackRF WebUSB: audio kit diteruskan ke backend HANYA selama siklus rekam ini.
    const viaWebusb = deviceIndex === WEBUSB_DEVICE_INDEX;
    if (viaWebusb && !(await startWebusbForwarding())) return false;
    try{
      // PERBAIKAN: log ini dipasang di sini (bukan hanya mengandalkan poll
      // /rms yang jalan tiap 400ms) supaya SETIAP siklus VOX baru pasti
      // tercatat di console begitu diminta ke backend -- tidak bergantung
      // pada waktu polling yang kadang telat menangkap fase yang berubah
      // cepat (mis. saat backend sibuk memproses Whisper/terjemahan).
      log(
        skipTranslate
          ? 'Menunggu sinyal HT untuk direkam & disimpan…'
          : 'Menunggu sinyal HT untuk direkam & diterjemahkan…',
        'info'
      );
      const res = await fetch(`${API_BASE}/record-radio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_index: Number(deviceIndex),
          // Sebelumnya: `thresholdToggle.checked ? 2.0e-5 : 2.0e-5` -- elemen
          // 'thresholdToggle' ini rupanya sudah tidak ada di HTML saat ini,
          // jadi thresholdToggle bernilai null dan `.checked` melempar error
          // "Cannot read properties of null". Lagipula kedua cabangnya
          // menghasilkan nilai yang SAMA, jadi disederhanakan jadi konstanta.
          rms_threshold: 2.0e-5,
          max_sec: 300,
          lang: selectedPapuaLang,
          // "Rekam & Simpan Audio" mengirim skipTranslate=true supaya backend
          // HANYA merekam & menyimpan file audio, tanpa Whisper/terjemahan.
          // "Rekam & Translate Audio" (default) tetap seperti semula.
          skip_translate: skipTranslate,
          // Info radio untuk database Rekaman (halaman Rekaman).
          meta: recordMetaForDevice(deviceIndex),
        })
      });
      const data = await safeJson(res);

      if (!data.ok){
        log(`Radio: ${data.error || 'gagal merekam / tidak ada sinyal di atas threshold.'}`, 'warn');
        return true; // bukan error fatal, lanjut mendengarkan siklus berikutnya
      }

      playLastRecordingBtn.hidden = false;
      logLangWarningIfAny(data);
      recordsChanged();

      if (skipTranslate){
        // Rekam & Simpan Audio: JANGAN isi kotak Whisper/Terjemahan, dan
        // jangan trigger auto-TTS -- audio hanya disimpan sebagai rekaman.
        log(`Audio radio direkam & disimpan (durasi ${Number(data.duration_sec ?? 0).toFixed(2)} dtk), tanpa translate.`, 'ok');
        return true;
      }

      whisperOutput.value = data.text_papua || '';
      translationOutput.value = data.text_indonesia || '';
      log(`Whisper (radio): "${truncateForLog(data.text_papua)}"`, 'info');
      log(`Terjemahan radio selesai (durasi ${Number(data.duration_sec ?? 0).toFixed(2)} dtk).`, 'ok');

      if ((autoTtsToggle && autoTtsToggle.checked) && data.text_indonesia){
        await playTtsText(data.text_indonesia);
      }
      return true;
    } catch(err){
      log(`Gagal menghubungi backend saat merekam radio: ${err.message}`, 'err');
      return false; // error jaringan/fatal -> hentikan loop
    } finally {
      if (viaWebusb) stopWebusbForwarding();
    }
  }

  // PERBAIKAN: backend sekarang TIDAK PERNAH lagi menghentikan rekaman
  // sendiri saat sinyal PTT/VOX dilepas -- rekaman terus berjalan sampai
  // ada yang memanggil POST /record-radio/stop (lihat cancel_event di
  // app_faster_whisper_lokal.py). Helper ini dipakai baik oleh tombol
  // "Berhenti Mendengarkan" maupun "Rekam & Simpan Audio" untuk mengirim
  // sinyal berhenti manual itu dari web.
  async function stopActiveRecording(){
    try{
      await fetch(`${API_BASE}/record-radio/stop`, { method: 'POST' });
    } catch(err){
      log(`Gagal mengirim sinyal berhenti ke backend: ${err.message}`, 'err');
    }
  }

  async function radioListenLoop(){
    while (listening){
      const shouldContinue = await recordRadioCycle();
      if (!shouldContinue) break;
    }
    if (listening) stopListening();
  }

  function startListening(){
    listening = true;
    playRadioBtn.innerHTML = pauseIcon() + 'Berhenti Mendengarkan';
    deviceSelect.disabled = true;
    statusPill.textContent = 'Menunggu sinyal PTT/VOX dari radio…';
    statusPill.classList.remove('busy');
    log(`Mulai mendengarkan audio radio (perangkat [${deviceSelect.value}])… rekaman tidak lagi berhenti sendiri saat PTT dilepas, tekan "Berhenti Mendengarkan" untuk menghentikan & memproses rekaman.`, 'ok');
    radioListenLoop();
  }

  function stopListening(){
    listening = false;
    // PERBAIKAN: sebelumnya label tombol ini di-set jadi "Putar Audio Papua"
    // saat berhenti mendengarkan, padahal label aslinya (dan seharusnya
    // tetap) adalah "Rekam & Translate Audio" -- baru berubah jadi
    // "Berhenti Mendengarkan" SAAT sedang aktif mendengarkan. "Putar Audio
    // Papua" adalah label tombol lain (playLastRecordingBtn) untuk memutar
    // ulang rekaman terakhir, bukan untuk tombol ini.
    playRadioBtn.innerHTML = playIcon() + 'Rekam &amp; Terjemahkan';
    deviceSelect.disabled = false;
    applyPhaseToStatusPill('idle');
    log('Berhenti mendengarkan audio radio.', 'warn');
    // PERBAIKAN: rekaman yang sedang berjalan (atau yang masih menunggu
    // sinyal) tidak lagi berhenti sendiri di backend -- klik tombol ini
    // HARUS memberi tahu backend secara eksplisit supaya siklus yang
    // sedang tertahan di dalam record_radio_rms()/record_radio_web888()
    // langsung selesai (lalu diproses/diterjemahkan) alih-alih menggantung.
    stopActiveRecording();
  }

  playRadioBtn.addEventListener('click', () => {
    if (!listening) startListening();
    else stopListening();
  });

  playLastRecordingBtn.addEventListener('click', () => {
    playAudioUrl(`${API_BASE}/last-audio.wav?t=${Date.now()}`, 'Memutar rekaman radio terakhir…');
  });

  /* ---- Rekam & Simpan Audio (rekam manual, berhenti lewat klik ulang) ---- */
  const recordSaveBtn = $('recordSaveBtn');
  if (recordSaveBtn){
    function saveIcon(){
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 21v-8H7v8M7 3v5h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    // PERBAIKAN: sebelumnya tombol ini menjalankan SATU siklus rekam yang
    // (dulu) berhenti sendiri begitu PTT dilepas -- klik = tunggu backend
    // auto-stop. Sekarang backend tidak pernah auto-stop lagi, jadi tombol
    // ini diubah jadi SAKLAR manual: klik pertama mulai rekam & menunggu
    // sinyal, klik kedua (selagi merekam/menunggu) mengirim sinyal berhenti
    // ke backend supaya rekaman selesai & disimpan.
    let recordSaveActive = false;
    let recordSaveCyclePromise = null;

    recordSaveBtn.addEventListener('click', async () => {
      if (listening){
        log('Sedang mendengarkan radio — hentikan dahulu sebelum merekam & menyimpan.', 'warn');
        return;
      }

      if (!recordSaveActive){
        recordSaveActive = true;
        recordSaveBtn.innerHTML = pauseIcon() + 'Berhenti &amp; Simpan';
        statusPill.textContent = 'Menunggu sinyal PTT untuk direkam & disimpan…';
        statusPill.classList.remove('busy');
        log('Merekam & menyimpan audio radio (tanpa translate)… klik "Berhenti & Simpan Audio" untuk menghentikan secara manual.', 'info');
        recordSaveCyclePromise = recordRadioCycle({ skipTranslate: true });
        return;
      }

      // Sudah aktif merekam/menunggu -> klik kedua ini berarti berhenti manual.
      recordSaveBtn.disabled = true;
      try{
        await stopActiveRecording();
        await recordSaveCyclePromise;
      } finally {
        recordSaveActive = false;
        recordSaveCyclePromise = null;
        recordSaveBtn.disabled = false;
        recordSaveBtn.innerHTML = saveIcon() + 'Rekam &amp; Simpan';
        applyPhaseToStatusPill('idle');
      }
    });
  }

  /* ---- Pilih Bahasa Papua (dikirim sebagai field "lang" ke backend) ---- */
  const papuaLangSelect = $('papuaLangSelect');
  const papuaLangSearch = $('papuaLangSearch');
  let selectedPapuaLang = papuaLangSelect ? papuaLangSelect.value : '';
  // Set label pill sesuai bahasa default saat halaman pertama kali dimuat.
  if (!statusPill.classList.contains('busy')) statusPill.textContent = papuaSiapLabel();

  async function applyPapuaLangChange(lang, label){
    log(`Mengganti translate ke Bahasa ${label}…`, 'info');
    try{
      const res = await fetch(`${API_BASE}/set-lang`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang })
      });
      const data = await safeJson(res);
      if (!data.ok){
        log(`Gagal mengganti ke Bahasa ${label}: ${data.error || 'terjadi kesalahan.'}`, 'err');
        return;
      }
      if (data.changed === false){
        log(`Bahasa ${label} sudah aktif (tidak ada perubahan).`, 'info');
      } else {
        log(`Berhasil mengganti translate ke Bahasa ${label}.`, 'ok');
      }
    } catch(err){
      log(`Gagal menghubungi backend saat mengganti bahasa: ${err.message}`, 'err');
    }
  }

  // Bersihkan input & output translate sebelumnya (Whisper, hasil terjemahan,
  // teks Papua, berkas unggahan) begitu bahasa Papua diganti -- supaya tidak
  // ada teks/hasil dari bahasa sebelumnya yang tertinggal di layar dan
  // membingungkan mana yang terjemahan bahasa baru.
  function resetTranslateWorkspace(){
    whisperOutput.value = '';
    translationOutput.value = '';
    if (papuaTextInput) papuaTextInput.value = '';
    if (audioFile) audioFile.value = '';
    if (fileNameEl) fileNameEl.textContent = 'Belum ada berkas dipilih';
    uploadPreviewUrl = null;
    uploadPreviewToken++; // buang hasil pratinjau upload yang mungkin masih berjalan (basi)
    playLastRecordingBtn.hidden = true;
    log('Input & output translate sebelumnya dibersihkan karena ganti bahasa.', 'info');
  }

  if (papuaLangSelect){
    papuaLangSelect.addEventListener('change', () => {
      selectedPapuaLang = papuaLangSelect.value;
      const opt = papuaLangSelect.options[papuaLangSelect.selectedIndex];
      const label = opt ? opt.textContent : selectedPapuaLang;
      log(`Bahasa Papua dipilih: ${label}`, 'info');
      resetTranslateWorkspace();
      if (!statusPill.classList.contains('busy')) statusPill.textContent = papuaSiapLabel();
      applyPapuaLangChange(selectedPapuaLang, label);
    });
  }
  if (papuaLangSearch && papuaLangSelect){
    papuaLangSearch.addEventListener('input', () => {
      const q = papuaLangSearch.value.trim().toLowerCase();
      Array.from(papuaLangSelect.options).forEach(opt => {
        opt.hidden = q.length > 0 && !opt.textContent.toLowerCase().includes(q);
      });
    });
  }

  /* ============================================================
     UPLOAD AUDIO — POST /preview-upload-audio, /upload-audio
     ============================================================ */
  const audioFile = $('audioFile');
  const fileNameEl = $('fileName');
  const playUploadBtn = $('playUploadBtn');
  const uploadTranslateBtn = $('uploadTranslateBtn');

  let uploadPreviewUrl = null;
  // PERBAIKAN: sebelumnya kalau berkas diganti dua kali dengan cepat, dua
  // permintaan pratinjau ke backend berjalan bersamaan (race condition) --
  // jika respons untuk berkas yang LAMA kembali belakangan, ia menimpa
  // uploadPreviewUrl milik berkas yang BARU, sehingga saat tombol Play
  // ditekan yang terdengar justru audio dari berkas lama. Token di bawah
  // memastikan hanya respons dari pemilihan berkas TERBARU yang dipakai;
  // respons yang sudah basi (berkas sudah diganti lagi) otomatis dibuang.
  let uploadPreviewToken = 0;

  async function prepareUploadPreview(file){
    uploadPreviewUrl = null;
    const myToken = ++uploadPreviewToken;
    // PERBAIKAN: sebelumnya proses ini (kirim berkas ke backend untuk
    // dibuatkan pratinjau) tidak terlihat sama sekali di status pill --
    // hanya hasil akhirnya yang tercatat di log. Sekarang pill juga
    // menunjukkan progres saat sedang mengunggah/menyiapkan pratinjau.
    statusPill.textContent = 'Menyiapkan Pratinjau…';
    statusPill.classList.add('busy');
    try{
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/preview-upload-audio`, { method: 'POST', body: fd, cache: 'no-store' });
      const data = await safeJson(res);
      if (myToken !== uploadPreviewToken) return; // berkas sudah diganti lagi, buang hasil yang basi ini
      if (!data.ok){
        log(`Gagal menyiapkan pratinjau audio: ${data.error}`, 'err');
        return;
      }
      uploadPreviewUrl = `${API_BASE}${data.audio_url}`;
      log('Pratinjau audio unggahan siap diputar.', 'ok');
    } catch(err){
      if (myToken !== uploadPreviewToken) return;
      log(`Gagal mengirim berkas untuk pratinjau: ${err.message}`, 'err');
    } finally {
      if (myToken === uploadPreviewToken){
        statusPill.textContent = papuaSiapLabel();
        statusPill.classList.remove('busy');
      }
    }
  }

  audioFile.addEventListener('change', () => {
    if (!audioFile.files.length){
      fileNameEl.textContent = 'Belum ada berkas dipilih';
      uploadPreviewUrl = null;
      return;
    }
    const file = audioFile.files[0];
    fileNameEl.textContent = file.name;
    log(`Berkas dipilih: ${file.name}`, 'info');
    prepareUploadPreview(file);
  });

  playUploadBtn.addEventListener('click', () => {
    if (!audioFile.files.length){
      log('Pilih berkas audio terlebih dahulu.', 'err');
      return;
    }
    if (!uploadPreviewUrl){
      log('Pratinjau belum siap, tunggu sebentar lalu coba lagi.', 'warn');
      return;
    }
    playAudioUrl(uploadPreviewUrl, `Memutar berkas: ${audioFile.files[0].name}`);
  });

  uploadTranslateBtn.addEventListener('click', async () => {
    if (!audioFile.files.length){
      log('Tidak ada berkas untuk diunggah.', 'err');
      return;
    }
    const file = audioFile.files[0];
    uploadTranslateBtn.disabled = true;
    statusPill.textContent = 'Memproses…';
    statusPill.classList.add('busy');
    log(`Mengunggah dan memproses: ${file.name}…`, 'info');

    try{
      const fd = new FormData();
      fd.append('file', file);
      fd.append('lang', selectedPapuaLang);
      const res = await fetch(`${API_BASE}/upload-audio`, { method: 'POST', body: fd });
      const data = await safeJson(res);

      if (!data.ok){
        log(`Gagal memproses berkas: ${data.error}`, 'err');
        return;
      }

      whisperOutput.value = data.text_papua || '';
      translationOutput.value = data.text_indonesia || '';
      logLangWarningIfAny(data);
      log('Terjemahan selesai (berkas unggahan).', 'ok');
      playLastRecordingBtn.hidden = false; // /upload-audio juga mengisi last_audio_clean di backend

      if ((autoTtsToggle && autoTtsToggle.checked) && data.text_indonesia){
        await playTtsText(data.text_indonesia);
      }
    } catch(err){
      log(`Gagal menghubungi backend: ${err.message}`, 'err');
    } finally {
      uploadTranslateBtn.disabled = false;
      statusPill.textContent = papuaSiapLabel();
      statusPill.classList.remove('busy');
    }
  });

  /* ============================================================
     TEXT TRANSLATE — POST /translate-text
     ============================================================ */
  const papuaTextInput = $('papuaTextInput');
  const translateTextBtn = $('translateTextBtn');

  translateTextBtn.addEventListener('click', async () => {
    const text = papuaTextInput.value.trim();
    if (!text){
      log('Ketik teks Papua sebelum menerjemahkan.', 'err');
      papuaTextInput.focus();
      return;
    }

    whisperOutput.value = text;
    translateTextBtn.disabled = true;
    statusPill.textContent = 'Menerjemahkan…';
    statusPill.classList.add('busy');

    try{
      const res = await fetch(`${API_BASE}/translate-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: selectedPapuaLang })
      });
      const data = await safeJson(res);

      if (!data.ok){
        log(`Gagal menerjemahkan: ${data.error}`, 'err');
        return;
      }

      translationOutput.value = data.output_indonesia || '';
      logLangWarningIfAny(data);
      log('Terjemahan selesai: Papua → Indonesia.', 'ok');

      if ((autoTtsToggle && autoTtsToggle.checked) && data.output_indonesia){
        await playTtsText(data.output_indonesia);
      }
    } catch(err){
      log(`Gagal menghubungi backend: ${err.message}`, 'err');
    } finally {
      translateTextBtn.disabled = false;
      statusPill.textContent = papuaSiapLabel();
      statusPill.classList.remove('busy');
    }
  });

  /* ============================================================
     SPEKTRUM & WATERFALL REAL-TIME (dari rtl_tcp lewat backend)
     ============================================================ */
  const spectrumCanvas = $('spectrumCanvas');
  const waterfallCanvas = $('waterfallCanvas');
  const scaleCanvas = $('scaleCanvas');
  const specCtx = spectrumCanvas.getContext('2d');
  const wfCtx = waterfallCanvas.getContext('2d');
  const scaleCtx = scaleCanvas ? scaleCanvas.getContext('2d') : null;
  const spectrumToggleBtn = $('spectrumToggleBtn');
  const spectrumStatusPill = $('spectrumStatusPill');
  const rtltcpDot = $('rtltcpDot');
  const rtltcpStatusText = $('rtltcpStatusText');
  const rtltcpHostInput = $('rtltcpHost');
  const rtltcpPortInput = $('rtltcpPort');
  const radioSourceSelect = $('radioSourceSelect');
  const networkSourceConfig = $('networkSourceConfig');
  const toolbarSourceLabel = $('toolbarSourceLabel');
  const scopeRow = document.querySelector('.scope-row');
  const scopeEmpty = $('scopeEmpty');
  const axisMinEl = $('axisMin');
  const axisCenterEl = $('axisCenter');
  const axisMaxEl = $('axisMax');
  const zoomSlider = $('zoomSlider');
  const zoomValueEl = $('zoomValue');
  const contrastSlider = $('contrastSlider');
  const contrastValueEl = $('contrastValue');

  let spectrumRunning = false;
  let spectrumPollTimer = null;
  let waterfallInitialized = false;
  let activeSpectrumSource = null; // 'web888' | 'sdrpp' | 'hackrf' | null

  /* ---- Tab Listener / Spectrum dan sumber radio ----
     Listener = mendengarkan satu frekuensi (spektrum + waterfall, atau panel
     radio kit untuk Radio V2 di browser). Spectrum = mencari sinyal di rentang
     lebar (pindai lebar kit untuk Radio V2 di browser, pencarian HT otomatis
     backend untuk sumber lain). Panel kanan menampilkan pengaturan tab aktif
     saja. Pilihan sumber & tab diingat per browser. */
  const RADIO_SOURCE_STORAGE_KEY = 'radioSource';
  const RADIO_TAB_STORAGE_KEY = 'radioTab';
  const SOURCE_SHORT_LABEL = {
    network: 'Radio V1 · Web-888 / rtl_tcp',
    webusb: 'Radio V2 · USB di browser',
    hackrf: 'Radio V2 · USB lewat server',
    'hackrf-sim': 'Radio V2 · simulasi server',
  };
  let radioTab = 'listener';

  function applyRadioLayout(){
    const source = radioSourceSelect.value;
    const webusb = source === 'webusb';
    const serverRadio = source === 'hackrf' || source === 'hackrf-sim';
    const spectrumTab = radioTab === 'spectrum';
    document.querySelectorAll('[data-radio-tab]').forEach((btn) => {
      const on = btn.dataset.radioTab === radioTab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // Tampilan kiri
    scopeRow.hidden = webusb;
    $('listenerFrameWrap').hidden = !webusb || spectrumTab;
    $('sweepView').hidden = !webusb || !spectrumTab;
    $('scanCard').hidden = webusb || !spectrumTab;
    // Panel pengaturan kanan
    $('listenerSettings').hidden = spectrumTab;
    $('spectrumSettings').hidden = !spectrumTab;
    $('sweepSettings').hidden = !webusb;
    $('autoScanSettings').hidden = webusb;
    // Bagian Listener yang relevan untuk sumber ini
    networkSourceConfig.hidden = source !== 'network';
    $('webusbSourceConfig').hidden = !webusb;
    $('gainSection').hidden = !(webusb || serverRadio);
    $('gainServerNote').hidden = !serverRadio;
    $('listenerGainsBtn').hidden = !webusb;
    $('sampleRateRow').hidden = !webusb;
    $('displaySection').hidden = webusb;
    $('listenerStatusSection').hidden = !webusb;
    $('bwWebusbNote').hidden = !webusb;
    toolbarSourceLabel.textContent = SOURCE_SHORT_LABEL[source] || '';
    if (spectrumTab && !webusb) startScanPolling(); else stopScanPolling();
    requestAnimationFrame(() => {
      fitSetRadio();
      waterfallInitialized = false;
    });
  }

  function applyRadioSourceUi(){
    setListenerSourceActive(radioSourceSelect.value === 'webusb');
    applyRadioLayout();
    refreshSquelch();
  }

  try{
    const saved = localStorage.getItem(RADIO_SOURCE_STORAGE_KEY);
    if (saved && [...radioSourceSelect.options].some(o => o.value === saved)) radioSourceSelect.value = saved;
    const savedTab = localStorage.getItem(RADIO_TAB_STORAGE_KEY);
    if (savedTab === 'listener' || savedTab === 'spectrum') radioTab = savedTab;
  } catch(err){ /* localStorage bisa diblokir; pakai default */ }
  // Ditunda sampai seluruh script ini selesai dijalankan: jalur "webusb"
  // memakai variabel yang baru dideklarasikan lebih bawah.
  queueMicrotask(applyRadioSourceUi);
  radioSourceSelect.addEventListener('change', () => {
    if (spectrumRunning) spectrumToggleBtn.click(); // putuskan sumber lama dulu
    applyRadioSourceUi();
    try{ localStorage.setItem(RADIO_SOURCE_STORAGE_KEY, radioSourceSelect.value); } catch(err){ /* abaikan */ }
    const label = radioSourceSelect.options[radioSourceSelect.selectedIndex].textContent;
    log(`Sumber radio dipilih: ${label}. Tekan "Sambungkan" untuk memakai sumber ini.`, 'info');
  });
  document.querySelectorAll('[data-radio-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showRadioTab(btn.dataset.radioTab));
  });
  function showRadioTab(tab){
    radioTab = tab;
    try{ localStorage.setItem(RADIO_TAB_STORAGE_KEY, tab); } catch(err){ /* abaikan */ }
    applyRadioLayout();
  }

  /* ---- Tombol Sambungkan/Putuskan (satu-satunya untuk semua sumber) ---- */
  function setConnectButton(running){
    spectrumToggleBtn.textContent = running ? 'Putuskan' : 'Sambungkan';
    spectrumToggleBtn.classList.toggle('is-running', running);
  }

  function isDirectRadioSource(src){
    return src === 'web888' || src === 'hackrf';
  }
  // PERBAIKAN BUG (lihat screenshot laporan): sebelumnya polling /spectrum
  // jalan lewat setInterval tetap 50ms TANPA guard overlap dan TANPA
  // backoff. Saat backend mati/restart lama, 502 menumpuk terus tiap 50ms
  // sampai akhirnya socket OS kehabisan buffer (net::ERR_NO_BUFFER_SPACE)
  // seperti di log console. Sekarang polling dijadwalkan ulang sendiri
  // (bukan interval tetap) + backoff bertahap saat gagal beruntun, lalu
  // kembali ke ~20fps normal begitu backend online lagi.
  let spectrumPollInFlight = false;
  let spectrumFailStreak = 0;
  const SPECTRUM_POLL_BASE_MS = 50; // ~20fps, selaras SPECTRUM_TARGET_FPS backend
  const SPECTRUM_POLL_MAX_MS = 2000;
  const SPECTRUM_POLL_BACKOFF_START = 6; // toleransi ~6 kegagalan dulu sebelum backoff

  /* ------------------------------------------------------------
     AUDIO LIVE HT (khusus sumber Web-888) — supaya kedengaran
     suaranya sendiri saat speech di HT, selagi melihat
     frekuensi/waterfall di Set Radio. Untuk sumber SDR++, audio
     sudah keluar lewat speaker PC via SDR++ sendiri, jadi tidak
     perlu diputar ulang di browser.

     Teknik: polling GET /web888/audio-chunk (bukan WebSocket, biar
     konsisten dengan pola /rms & /spectrum yang sudah ada), lalu
     jadwalkan tiap potongan PCM secara berurutan lewat Web Audio
     API (AudioBufferSourceNode) supaya sambung-menyambung tanpa
     jeda/klik, mirip pemutaran streaming radio internet.
     ------------------------------------------------------------ */
  let web888AudioCtx = null;
  let web888AudioNextStart = 0;
  let web888AudioPollTimer = null;
  let web888AudioActive = false;
  // Semua potongan audio monitor masuk ke sini, lalu lewat filter suara
  // (radio-audio-filter.js) sebelum ke speaker. 48 kHz: syarat peredam noise AI.
  let web888MonitorInput = null;

  function ensureWeb888AudioCtx(){
    if (!web888AudioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      try{ web888AudioCtx = new Ctx({ sampleRate: 48000, latencyHint: 'interactive' }); }
      catch(err){ web888AudioCtx = new Ctx(); }
      web888MonitorInput = web888AudioCtx.createGain();
      attachRadioFilter(web888AudioCtx, web888MonitorInput);
    }
    if (web888AudioCtx.state === 'suspended'){
      web888AudioCtx.resume().catch(() => {});
    }
    return web888AudioCtx;
  }

  function base64ToInt16Array(b64){
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  }

  async function pollWeb888Audio(){
    // PERBAIKAN: sebelumnya di sini ada `if (listening) return;` yang
    // menghentikan monitor audio live setiap kali loop "Rekam & Translate"
    // (atau "Rekam & Simpan Audio") aktif -- akibatnya suara HT SAMA SEKALI
    // tidak terdengar di browser selama proses rekam/translate berjalan,
    // padahal justru saat itulah operator paling butuh dengar suaranya
    // sendiri (untuk tahu PTT sudah "masuk" atau belum). Guard itu dulunya
    // untuk mencegah rebutan buffer dengan /record-radio, tapi backend
    // sekarang SUDAH memakai dua buffer terpisah: pop_audio() untuk
    // /record-radio (Whisper) dan pop_monitor_audio() khusus endpoint ini
    // (lihat komentar /web888/audio-chunk di app_faster_whisper_lokal.py),
    // jadi keduanya tidak lagi berebut. Monitor ini sekarang dibiarkan
    // tetap jalan terus -- baik saat idle, saat "Rekam & Translate Audio",
    // maupun saat "Rekam & Simpan Audio" -- selama koneksi Web-888 aktif,
    // persis seperti radio HT sungguhan yang suaranya selalu terdengar
    // dari speaker selama PTT ditekan.
    try{
      const res = await fetch(`${API_BASE}/web888/audio-chunk`);
      const data = await safeJson(res);
      if (!data.ok || !data.has_audio) return;

      const int16 = base64ToInt16Array(data.pcm16_base64);
      if (int16.length === 0) return;

      const ctx = ensureWeb888AudioCtx();
      const buffer = ctx.createBuffer(1, int16.length, data.sample_rate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768.0;

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(web888MonitorInput);

      // Jadwalkan sambung-menyambung: kalau jadwal sebelumnya sudah lewat
      // (mis. jeda jaringan), mulai lagi dari "sekarang" supaya tidak makin
      // ketinggalan (drift) dari waktu nyata.
      const now = ctx.currentTime;
      let startAt = Math.max(web888AudioNextStart, now);

      // PERBAIKAN DELAY/GEMA YANG MAKIN LAMA MAKIN PANJANG:
      // Sebelum ini, kalau antrian sempat menumpuk di DEPAN waktu nyata
      // (mis. sesaat setelah jeda jaringan/tab browser sibuk, server
      // sempat mem-buffer sisa audio HT beberapa ratus ms), kode ini
      // hanya menambah terus `web888AudioNextStart` tanpa pernah
      // memangkasnya kembali -- backlog itu tidak pernah "dibuang", jadi
      // jeda antara suara asli HT dan yang kedengaran di browser terus
      // menumpuk dan tidak pernah pulih sendiri, makin lama dipakai makin
      // parah. Sekarang: kalau antrian sudah menumpuk lebih dari
      // MAX_LOOKAHEAD_SECONDS di depan waktu nyata, buang backlog itu dan
      // mulai lagi dari "sekarang" -- persis seperti penanganan saat
      // ketinggalan di atas, tapi untuk arah sebaliknya.
      //
      // Nilai ini SENGAJA dibuat sekecil mungkin (namun tetap aman dari
      // klik/putus-putus) supaya delay selalu mendekati minimum praktis --
      // TIDAK bisa dibuat 0 mutlak karena Web Audio API tetap butuh sedikit
      // "napas" ke depan supaya penjadwalan antar-potongan audio tidak
      // bercelah/berbunyi klik.
      const MAX_LOOKAHEAD_SECONDS = 0.15;
      if (startAt - now > MAX_LOOKAHEAD_SECONDS) {
        startAt = now;
      }

      src.start(startAt);
      web888AudioNextStart = startAt + buffer.duration;
    } catch(err){
      // Diamkan -- ini polling latar belakang, tidak perlu bikin log berisik.
    }
  }

  function startWeb888AudioMonitor(){
    if (web888AudioActive) return;
    web888AudioActive = true;
    const ctx = ensureWeb888AudioCtx();
    web888AudioNextStart = ctx.currentTime;
    if (web888AudioPollTimer) clearInterval(web888AudioPollTimer);
    // Interval polling diperkecil (dari 150ms) supaya potongan audio yang
    // diambil tiap kali lebih kecil & lebih sering -- delay dari sisi ini
    // jadi lebih dekat ke minimum praktis. Turunkan lagi kalau perangkat
    // masih kuat (CPU/koneksi lokal), tapi terlalu kecil (<30ms) berisiko
    // membebani server dengan request yang berlebihan tanpa manfaat nyata.
    web888AudioPollTimer = setInterval(pollWeb888Audio, 60);
  }

  function stopWeb888AudioMonitor(){
    web888AudioActive = false;
    if (web888AudioPollTimer) clearInterval(web888AudioPollTimer);
    web888AudioPollTimer = null;
  }

  /* ------------------------------------------------------------
     FILTER SUARA — rantai Web Audio di static/radio-audio-filter.js
     (bandpass pita suara HT, peredam noise AI, perjelas suara, gerbang
     noise, AGC). Hanya untuk monitor yang didengar; rekaman & Whisper
     tetap memakai audio asli dari backend. Setelan diingat per browser.
     ------------------------------------------------------------ */
  const FILTER_STORAGE_KEY = 'radioAudioFilter';
  const filterModule = import(`${API_BASE}/static/radio-audio-filter.js`);
  const filterPresets = $('filterPresets');
  const filterBandpass = $('filterBandpass');
  const filterBandLabel = $('filterBandLabel');
  const filterDenoise = $('filterDenoise');
  const filterClarity = $('filterClarity');
  const filterAgc = $('filterAgc');
  const filterBoost = $('filterBoost');
  const filterBoostValue = $('filterBoostValue');
  const filterGate = $('filterGate');
  const audioFilterStatus = $('audioFilterStatus');
  const audioFilterNote = $('audioFilterNote');
  let radioFilter = null;
  let radioFilterSettings = null;   // { preset: 'off'|'light'|'standard'|'strong'|'custom', ...nilai }
  let monitorFallbackGain = null;   // dipakai selama modul filter belum termuat

  function monitorVolume(){
    return volumeSlider ? clamp(Number(volumeSlider.value), 0, 100) / 100 : 1;
  }
  function updateMonitorVolume(){
    if (radioFilter) radioFilter.setVolume(monitorVolume());
    if (monitorFallbackGain) monitorFallbackGain.gain.value = monitorVolume();
  }
  if (volumeSlider) volumeSlider.addEventListener('input', updateMonitorVolume);
  if (volumeIcon) volumeIcon.addEventListener('click', updateMonitorVolume);

  function attachRadioFilter(ctx, input){
    monitorFallbackGain = ctx.createGain();
    monitorFallbackGain.gain.value = monitorVolume();
    input.connect(monitorFallbackGain).connect(ctx.destination);
    filterModule.then(({ RadioAudioFilter }) => {
      radioFilter = new RadioAudioFilter(ctx, radioFilterSettings || {});
      radioFilter.onStatus = renderFilterStatus;
      radioFilter.output.connect(ctx.destination);
      radioFilter.setVolume(monitorVolume());
      input.disconnect();
      input.connect(radioFilter.input);
      monitorFallbackGain.disconnect();
      monitorFallbackGain = null;
      renderFilterStatus(radioFilter.status);
    }).catch((err) => log(`Filter suara tidak bisa dimuat: ${err.message}`, 'warn'));
  }

  function saveFilterSettings(){
    try{ localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(radioFilterSettings)); } catch(err){ /* abaikan */ }
  }

  function renderFilterControls(){
    const s = radioFilterSettings;
    filterPresets.querySelectorAll('[data-filter-preset]').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.filterPreset === s.preset);
    });
    filterBandpass.checked = s.bandpass;
    filterBandLabel.textContent = `${s.lowHz}–${s.highHz} Hz`;
    filterDenoise.value = s.denoise;
    filterClarity.checked = s.clarity;
    filterAgc.checked = s.agc;
    filterBoost.value = s.boostDb;
    filterBoost.disabled = !s.agc;
    filterBoostValue.textContent = `+${s.boostDb} dB`;
    setSliderFill(filterBoost);
    filterGate.checked = s.gate;
  }

  function renderFilterStatus(status){
    const s = radioFilterSettings;
    let text = '';
    if (s && s.preset === 'off') text = 'mati';
    else if (status && status.denoise === 'loading') text = 'memuat AI…';
    else if (status && status.denoise === 'on') text = 'AI aktif';
    else if (status && status.denoise === 'error') text = 'AI gagal';
    else if (s) text = 'aktif';
    audioFilterStatus.textContent = text;
    audioFilterStatus.title = (status && status.error) || '';
    audioFilterStatus.classList.toggle('is-error', !!(status && status.error));
    if (status && status.error) log(`Filter suara: ${status.error}`, 'warn');
  }

  function renderFilterNote(){
    const source = radioSourceSelect.value;
    audioFilterNote.textContent = source === 'webusb'
      ? 'Radio V2 di browser memutar suaranya sendiri di panel radio, jadi filter ini belum berlaku untuk sumber itu.'
      : 'Hanya mengubah suara yang didengar. Rekaman dan Whisper tetap memakai suara asli.';
  }

  function applyFilterSettings(next){
    radioFilterSettings = next;
    saveFilterSettings();
    renderFilterControls();
    if (radioFilter) radioFilter.apply(next);
    renderFilterStatus(radioFilter ? radioFilter.status : null);
  }
  function changeFilter(patch){
    applyFilterSettings({ ...radioFilterSettings, ...patch, preset: 'custom' });
  }

  filterModule.then(({ FILTER_PRESETS }) => {
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || 'null'); } catch(err){ /* abaikan */ }
    radioFilterSettings = saved && typeof saved === 'object'
      ? { ...FILTER_PRESETS.standard, ...saved }
      : { ...FILTER_PRESETS.standard, preset: 'standard' };
    renderFilterControls();
    renderFilterStatus(null);
    if (radioFilter) radioFilter.apply(radioFilterSettings);

    filterPresets.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter-preset]');
      if (!chip) return;
      const preset = chip.dataset.filterPreset;
      applyFilterSettings({ ...FILTER_PRESETS[preset], preset });
      log(`Filter suara: ${chip.textContent}.`, 'info');
    });
    filterBandpass.addEventListener('change', () => changeFilter({ bandpass: filterBandpass.checked }));
    filterDenoise.addEventListener('change', () => changeFilter({ denoise: filterDenoise.value }));
    filterClarity.addEventListener('change', () => changeFilter({ clarity: filterClarity.checked }));
    filterAgc.addEventListener('change', () => changeFilter({ agc: filterAgc.checked }));
    filterBoost.addEventListener('input', () => changeFilter({ boostDb: Number(filterBoost.value) }));
    filterGate.addEventListener('change', () => changeFilter({ gate: filterGate.checked }));
  }).catch(() => { audioFilterStatus.textContent = 'tidak tersedia'; });
  radioSourceSelect.addEventListener('change', renderFilterNote);
  renderFilterNote();
  // Untuk pengujian/diagnosis: rantai filter yang sedang aktif.
  window.radioAudioFilterInfo = () => (radioFilter
    ? { settings: radioFilterSettings, status: radioFilter.status, chain: radioFilter.chainNames, sampleRate: radioFilter.ctx.sampleRate }
    : { settings: radioFilterSettings, status: null });
  let scopeZoom = zoomSlider ? Number(zoomSlider.value) : 1;
  let scopeContrast = contrastSlider ? Number(contrastSlider.value) : 1;

  // --- Zoom ASLI di sisi server (Web-888/KiwiSDR) ---
  // baseWfSpanHz: lebar rentang (Hz) saat zoom masih 1x, direkam sekali waktu
  // spektrum baru dimulai. Dipakai sebagai acuan supaya span yang diminta ke
  // server selalu dihitung dari titik awal yang sama, terlepas dari span
  // saat ini (yang mungkin sudah berubah akibat zoom sebelumnya).
  let baseWfSpanHz = null;
  // true kalau permintaan zoom terakhir berhasil ditangani server (span
  // benar-benar diperkecil di sumbernya) -- kalau true, potongan array di
  // browser (lihat drawSpectrumFrame) TIDAK perlu dipotong lagi, supaya
  // tidak dobel-zoom (server sudah zoom, browser jangan zoom lagi).
  let serverZoomActive = false;
  let zoomApplyTimer = null;

  async function applyServerZoom(zoomFactor){
    if (activeSpectrumSource !== 'web888' || !baseWfSpanHz) return;
    const wfSpanHz = Math.max(1000, Math.round(baseWfSpanHz / zoomFactor));
    try{
      const res = await fetch(`${API_BASE}/spectrum/zoom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wf_span_hz: wfSpanHz }),
      });
      const data = await safeJson(res);
      serverZoomActive = !!(data && data.ok && data.supported);
    } catch(err){
      serverZoomActive = false;
    }
  }

  // Kurva kontras sederhana yang berputar di sekitar titik tengah (0.5),
  // dipakai untuk mempertajam/melunakkan gradasi warna waterfall.
  function applyContrast(norm, contrast){
    return clamp(0.5 + (norm - 0.5) * contrast, 0, 1);
  }

  if (zoomSlider){
    zoomSlider.addEventListener('input', () => {
      scopeZoom = Number(zoomSlider.value);
      zoomValueEl.textContent = scopeZoom.toFixed(1) + 'x';
      setSliderFill(zoomSlider);
      waterfallInitialized = false; // lebar tampilan berubah, mulai ulang waterfall
      if (zoomApplyTimer) clearTimeout(zoomApplyTimer);
      zoomApplyTimer = setTimeout(() => applyServerZoom(scopeZoom), 180);
    });
  }
  if (contrastSlider){
    contrastSlider.addEventListener('input', () => {
      scopeContrast = Number(contrastSlider.value);
      contrastValueEl.textContent = scopeContrast.toFixed(1) + 'x';
      setSliderFill(contrastSlider);
    });
  }

  function resizeScopeCanvases(){
    const dpr = window.devicePixelRatio || 1;
    [scaleCanvas, spectrumCanvas, waterfallCanvas].forEach(cv => {
      if (!cv) return;
      const cssWidth = cv.clientWidth;
      const cssHeight = cv.clientHeight;
      // PERBAIKAN BUG: sebelumnya kalau cssWidth/cssHeight bernilai 0 (kanvas
      // sedang tersembunyi -- mis. halaman Set Radio belum aktif saat event
      // 'resize' window terpicu), kode ini jatuh ke fallback sembarang
      // (600 / 180), lalu MENIMPA atribut width/height kanvas dengan angka
      // yang tidak proporsional terhadap ukuran aslinya. Sekarang, dengan
      // .scope-canvas sudah punya height CSS tetap (lihat style.css), ukuran
      // TAMPILAN kanvas tidak lagi bisa rusak -- tapi resolusi gambar
      // internal tetap sebaiknya tidak diubah sama sekali selagi kanvas
      // tersembunyi, jadi di sini kita cukup lewati (skip) kanvas itu untuk
      // siklus resize kali ini; ia akan diukur ulang dengan benar begitu
      // terlihat lagi (dipanggil lagi dari showPage()).
      if (!cssWidth || !cssHeight) return;
      const minH = cv === scaleCanvas ? 24 : 60;
      const targetW = Math.max(200, Math.round(cssWidth * dpr));
      const targetH = Math.max(minH, Math.round(cssHeight * dpr));
      if (cv.width !== targetW || cv.height !== targetH){
        cv.width = targetW;
        cv.height = targetH;
        waterfallInitialized = false;
      }
    });
    if (scaleCtx) drawFreqRuler(0, 0, false);
  }
  window.addEventListener('resize', () => { resizeScopeCanvases(); waterfallInitialized = false; });

  // Bilah skala/ruler frekuensi di atas grafik spektrum & waterfall, meniru
  // gaya pada gambar referensi: latar abu-abu metalik, garis takik (tick)
  // mayor (berlabel MHz) & minor (tanpa label), plus penanda hijau berbentuk
  // trapesium yang menunjukkan frekuensi + bandwidth yang sedang di-tune.
  function drawFreqRuler(centerHtHz, halfHz, hasAxisFlag){
    if (!scaleCtx) return;
    const w = scaleCanvas.width;
    const h = scaleCanvas.height;
    if (!w || !h) return;
    scaleCtx.clearRect(0, 0, w, h);

    const bg = scaleCtx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#6e7378');
    bg.addColorStop(0.45, '#4b4f53');
    bg.addColorStop(1, '#2a2d30');
    scaleCtx.fillStyle = bg;
    scaleCtx.fillRect(0, 0, w, h);
    scaleCtx.fillStyle = 'rgba(255,255,255,0.10)';
    scaleCtx.fillRect(0, 0, w, Math.max(1, Math.round(h * 0.06)));

    if (!hasAxisFlag || !halfHz) return;

    const lowHz = centerHtHz - halfHz;
    const highHz = centerHtHz + halfHz;
    const spanHz = 2 * halfHz;
    const hzToX = (hz) => ((hz - lowHz) / spanHz) * w;

    // Target ~10 label utama melintasi lebar bilah -> step "rapi" (1/2/5 x 10^n)
    const majorStep = niceStep(spanHz / 10);
    const minorStep = majorStep / 5;
    const dpr = window.devicePixelRatio || 1;

    const minorTickH = Math.max(3, Math.round(h * 0.16));
    const majorTickH = Math.max(6, Math.round(h * 0.32));

    // tick minor (tanpa label)
    scaleCtx.lineWidth = Math.max(1, Math.round(dpr));
    scaleCtx.strokeStyle = 'rgba(220,230,230,0.45)';
    let f0 = Math.ceil(lowHz / minorStep) * minorStep;
    for (let f = f0; f <= highHz; f += minorStep){
      if (Math.abs(Math.round(f / majorStep) * majorStep - f) < minorStep * 0.01) continue; // sudah jadi major
      const x = hzToX(f);
      scaleCtx.beginPath();
      scaleCtx.moveTo(x, h);
      scaleCtx.lineTo(x, h - minorTickH);
      scaleCtx.stroke();
    }

    // tick major + label MHz
    const fontPx = Math.max(9, Math.round(10 * dpr));
    scaleCtx.font = `600 ${fontPx}px sans-serif`;
    scaleCtx.textBaseline = 'top';
    scaleCtx.lineWidth = Math.max(1, Math.round(1.2 * dpr));
    scaleCtx.strokeStyle = 'rgba(235,245,245,0.85)';
    let f1 = Math.ceil(lowHz / majorStep) * majorStep;
    for (let f = f1; f <= highHz + 1e-6; f += majorStep){
      const x = hzToX(f);
      scaleCtx.beginPath();
      scaleCtx.moveTo(x, h);
      scaleCtx.lineTo(x, h - majorTickH);
      scaleCtx.stroke();

      const label = formatMHzForStep(f, majorStep) + ' MHz';
      scaleCtx.textAlign = x < 24 ? 'left' : (x > w - 24 ? 'right' : 'center');
      scaleCtx.fillStyle = 'rgba(235,245,245,0.92)';
      scaleCtx.fillText(label, x, Math.round(h * 0.06));
    }

    // penanda hijau (trapesium) = frekuensi + bandwidth yang sedang di-tune
    if (typeof currentFreq === 'number' && currentFreq >= lowHz && currentFreq <= highHz){
      const bw = (typeof currentBw === 'number' && currentBw > 0) ? currentBw : (spanHz * 0.01);
      const xLow = clamp(hzToX(currentFreq - bw / 2), 0, w);
      const xHigh = clamp(hzToX(currentFreq + bw / 2), 0, w);
      if (xHigh > xLow){
        const topY = 1;
        const flatY = topY + Math.max(3, Math.round(h * 0.24));
        const slant = Math.min((xHigh - xLow) * 0.4, 6);
        scaleCtx.save();
        scaleCtx.beginPath();
        scaleCtx.moveTo(xLow, flatY);
        scaleCtx.lineTo(xLow + slant, topY);
        scaleCtx.lineTo(xHigh - slant, topY);
        scaleCtx.lineTo(xHigh, flatY);
        scaleCtx.strokeStyle = '#3ee85a';
        scaleCtx.lineWidth = Math.max(1.5, 1.5 * dpr);
        scaleCtx.shadowColor = 'rgba(62,232,90,0.7)';
        scaleCtx.shadowBlur = 4;
        scaleCtx.stroke();
        scaleCtx.shadowBlur = 0;
        scaleCtx.restore();
      }
    }
  }

  // Skala dB stabil: lantai noise (persentil 20) dan puncak diperhalus antar-frame,
  // rentang minimal SPEC_MIN_RANGE_DB. Dulu skala mengikuti min/max tiap frame,
  // sehingga noise selalu memenuhi tinggi grafik dan sinyal sulit dibedakan.
  const SPEC_MIN_RANGE_DB = 30;
  let specScale = null; // { floor, peak } dalam dB; di-reset saat radio disambung

  function updateSpecScale(dbArray){
    const finite = Float32Array.from(dbArray).filter(Number.isFinite).sort();
    if (!finite.length) return { minDb: -100, maxDb: 0 };
    const floorNow = finite[Math.floor(finite.length * 0.2)];
    const peakNow = finite[finite.length - 1];
    if (!specScale){
      specScale = { floor: floorNow, peak: peakNow };
    } else {
      specScale.floor += (floorNow - specScale.floor) * 0.08;
      // Puncak naik cepat (sinyal baru langsung terlihat), turun pelan.
      specScale.peak += (peakNow - specScale.peak) * (peakNow > specScale.peak ? 0.5 : 0.02);
    }
    const minDb = specScale.floor - 6;
    const maxDb = Math.max(specScale.peak + 3, specScale.floor + SPEC_MIN_RANGE_DB);
    return { minDb, maxDb };
  }

  function drawSpectrumFrame(dbArrayFull, centerFreqHz, sampleRateHzFull){
    const w = spectrumCanvas.width;
    const h = spectrumCanvas.height;

    // --- ZOOM: ambil potongan array di sekitar titik tengah sesuai faktor zoom,
    // supaya makin besar zoom-nya, makin sempit rentang frekuensi yang tampil
    // (skala frekuensi terlihat lebih "dalam"/detail).
    const fullLen = dbArrayFull.length;
    let dbArray = dbArrayFull;
    let sampleRateHz = sampleRateHzFull;
    let cropZoom = scopeZoom;
    if (activeSpectrumSource === 'web888' && serverZoomActive && baseWfSpanHz && sampleRateHzFull){
      // Server Web-888 sudah mempersempit span SUNGGUHAN (resolusi Hz/bin
      // beneran naik, bukan cuma direntang di layar). KiwiSDR cuma punya
      // level zoom kelipatan pangkat 2, jadi span aktual kadang tidak
      // persis sama dengan target -- di sini cuma memangkas SISANYA saja,
      // supaya nilai slider tetap presisi tanpa dobel-zoom di atas zoom
      // yang server sudah lakukan.
      const desiredSpanHz = baseWfSpanHz / scopeZoom;
      cropZoom = clamp(sampleRateHzFull / desiredSpanHz, 1, scopeZoom);
    }
    if (cropZoom > 1.02 && fullLen > 8){
      const sliceLen = Math.max(8, Math.round(fullLen / cropZoom));
      const start = Math.floor((fullLen - sliceLen) / 2);
      dbArray = dbArrayFull.slice(start, start + sliceLen);
      if (sampleRateHzFull) sampleRateHz = sampleRateHzFull / cropZoom;
    }

    // --- Metadata sumbu frekuensi, dihitung SEKALI di awal supaya bisa dipakai
    // baik untuk overlay bandwidth (digambar sebelum garis spektrum, jadi
    // "di belakang" garisnya) maupun untuk label sumbu (di bawah nanti).
    // "centerFreqHz" dari backend adalah frekuensi RADIO aktual (yang benar-benar
    // di-tune di dongle/Web-888); dikurangi offset supaya sumbu yang tampil ke
    // user selalu dalam skala frekuensi HT, konsisten dengan panel Frekuensi.
    //
    // PERBAIKAN: sebelumnya sumbu tampilan DIPAKSA tetap 50 MHz total (lihat
    // riwayat komentar lama), padahal data ASLI yang benar-benar ditangkap dari
    // rtl_tcp/Web-888 jauh lebih sempit (cuma selebar sample rate-nya, mis. ~2-3
    // MHz) -- akibatnya grafik & waterfall cuma tampil sebagai jalur sempit di
    // tengah kotak, sementara sisi kiri-kanannya kosong/noise tanpa data
    // sungguhan. Sekarang sumbu tampilan (axisHalfHz) disamakan dengan bentang
    // data asli (dataHalfHz) supaya data SELALU digambar memenuhi lebar kotak
    // dari ujung kiri sampai ujung kanan. Efek baiknya juga membetulkan slider
    // Zoom: saat di-slider ke atas (fullLen dipotong makin sempit di sekitar
    // titik tengah, lihat blok ZOOM di atas), potongan yang makin sempit itu
    // ikut memenuhi lebar kotak yang SAMA -- inilah definisi "zoom in" yang
    // benar (detail makin besar/dekat), bukan makin mengecil seperti sebelumnya.
    // Sumbu selalu mengikuti bentang data asli yang benar-benar ditangkap
    // dari sumber (rtl_tcp/Web-888) -- lihat "PERBAIKAN" di atas.
    const hasAxis = !!(centerFreqHz && sampleRateHz);
    const dataHalfHz = hasAxis ? sampleRateHz / 2 : 0;
    const axisHalfHz = dataHalfHz;
    const axisCenterHtHz = hasAxis ? (centerFreqHz - freqOffsetHz) : 0;
    const htFreqToX = (hz) => ((hz - (axisCenterHtHz - axisHalfHz)) / (2 * axisHalfHz)) * w;

    drawFreqRuler(axisCenterHtHz, axisHalfHz, hasAxis);

    // --- garis spektrum ---
    specCtx.clearRect(0, 0, w, h);
    specCtx.fillStyle = '#030b0c';
    specCtx.fillRect(0, 0, w, h);

    // --- overlay bandwidth: bayangan putih transparan menandai rentang frekuensi
    // yang benar-benar diambil untuk demodulasi suara (sesuai panel Bandwidth),
    // digambar SEBELUM garis spektrum supaya garis & grid tetap terlihat di atasnya.
    if (hasAxis && typeof currentFreq === 'number' && typeof currentBw === 'number' && currentBw > 0){
      const bwLowHz = currentFreq - currentBw / 2;
      const bwHighHz = currentFreq + currentBw / 2;
      const xLow = clamp(htFreqToX(bwLowHz), 0, w);
      const xHigh = clamp(htFreqToX(bwHighHz), 0, w);
      if (xHigh > xLow){
        specCtx.save();
        specCtx.fillStyle = 'rgba(255,255,255,0.14)';
        specCtx.fillRect(xLow, 0, xHigh - xLow, h);
        specCtx.strokeStyle = 'rgba(255,255,255,0.32)';
        specCtx.lineWidth = 1;
        specCtx.strokeRect(xLow + 0.5, 0.5, Math.max(xHigh - xLow - 1, 0), h - 1);
        specCtx.restore();
      }
    }

    // grid horizontal tipis
    specCtx.strokeStyle = 'rgba(88,214,214,0.12)';
    specCtx.lineWidth = 1;
    for (let i = 1; i < 4; i++){
      const y = (h / 4) * i;
      specCtx.beginPath();
      specCtx.moveTo(0, y);
      specCtx.lineTo(w, y);
      specCtx.stroke();
    }

    const n = dbArray.length;
    // Satu skala dB (diperhalus antar-frame) untuk spektrum dan waterfall.
    const scopeRange = n > 1 ? updateSpecScale(dbArray) : { minDb: -100, maxDb: 0 };
    if (n > 1){
      const { minDb, maxDb } = scopeRange;

      specCtx.beginPath();
      specCtx.strokeStyle = '#3fe0e0';
      specCtx.lineWidth = 1.5;
      specCtx.shadowColor = 'rgba(63,224,224,0.55)';
      specCtx.shadowBlur = 6;
      let started = false;
      let firstX = 0, lastX = w;
      for (let i = 0; i < n; i++){
        let x;
        if (hasAxis && dataHalfHz > 0){
          const freqHere = axisCenterHtHz - dataHalfHz + (i / (n - 1)) * (2 * dataHalfHz);
          x = htFreqToX(freqHere);
        } else {
          x = (i / (n - 1)) * w;
        }
        const norm = clamp((dbArray[i] - minDb) / (maxDb - minDb), 0, 1);
        const y = h - norm * h;
        if (!started) { specCtx.moveTo(x, y); started = true; firstX = x; } else { specCtx.lineTo(x, y); }
        lastX = x;
      }
      specCtx.stroke();
      specCtx.shadowBlur = 0;

      // isi bawah garis (fill halus) — cuma di rentang x tempat data asli
      // benar-benar tergambar, bukan seluruh lebar kanvas 50 MHz.
      specCtx.lineTo(lastX, h);
      specCtx.lineTo(firstX, h);
      specCtx.closePath();
      const grad = specCtx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(63,224,224,0.25)');
      grad.addColorStop(1, 'rgba(63,224,224,0.0)');
      specCtx.fillStyle = grad;
      specCtx.fill();

      // simpan untuk keperluan klik-untuk-tuning
      spectrumCanvas.dataset.minDb = String(minDb);
      spectrumCanvas.dataset.maxDb = String(maxDb);
    }

    // --- geser waterfall ke bawah 1 baris, gambar baris baru di atas ---
    const wfW = waterfallCanvas.width;
    const wfH = waterfallCanvas.height;
    if (!waterfallInitialized){
      wfCtx.fillStyle = '#030b0c';
      wfCtx.fillRect(0, 0, wfW, wfH);
      waterfallInitialized = true;
    }
    // Tiap frame menggeser waterfall beberapa piksel (bukan 1 px) supaya terisi
    // penuh dalam ±7 detik, bukan puluhan detik layar hitam.
    const rowPx = Math.max(1, Math.round(wfH / 150));
    wfCtx.drawImage(waterfallCanvas, 0, 0, wfW, wfH - rowPx, 0, rowPx, wfW, wfH - rowPx);

    const rowImg = wfCtx.createImageData(wfW, 1);
    const minDb2 = scopeRange.minDb;
    const maxDb2 = scopeRange.maxDb;

    for (let x = 0; x < wfW; x++){
      const off = x * 4;
      if (hasAxis && dataHalfHz > 0){
        // frekuensi yang diwakili pixel x ini pada sumbu 50 MHz tetap (tampilan)
        const freqHere = (axisCenterHtHz - axisHalfHz) + (x / wfW) * (2 * axisHalfHz);
        const dataLow = axisCenterHtHz - dataHalfHz;
        const dataHigh = axisCenterHtHz + dataHalfHz;
        if (freqHere < dataLow || freqHere > dataHigh){
          // Di luar rentang data asli yang benar-benar ditangkap dari sumber.
          // BUKAN data sungguhan -- cuma tekstur "noise floor" acak tipis biar
          // waterfall terlihat menyambung penuh secara visual, tidak ada celah
          // hitam kosong. Nilainya sengaja dibuat rendah & acak kecil supaya
          // tetap kelihatan beda dari sinyal asli di tengah.
          const fakeNoiseNorm = Math.random() * 0.12;
          const [nr, ng, nb] = waterfallColor(fakeNoiseNorm);
          rowImg.data[off] = nr;
          rowImg.data[off + 1] = ng;
          rowImg.data[off + 2] = nb;
          rowImg.data[off + 3] = 255;
          continue;
        }
        const posNorm = (freqHere - dataLow) / (dataHigh - dataLow);
        const srcIdx = Math.min(n - 1, Math.max(0, Math.floor(posNorm * n)));
        let norm = clamp((dbArray[srcIdx] - minDb2) / (maxDb2 - minDb2), 0, 1);
        norm = applyContrast(norm, scopeContrast);
        const [r, g, b] = waterfallColor(norm);
        rowImg.data[off] = r;
        rowImg.data[off + 1] = g;
        rowImg.data[off + 2] = b;
        rowImg.data[off + 3] = 255;
      } else {
        const srcIdx = Math.min(n - 1, Math.floor((x / wfW) * n));
        let norm = clamp((dbArray[srcIdx] - minDb2) / (maxDb2 - minDb2), 0, 1);
        norm = applyContrast(norm, scopeContrast);
        const [r, g, b] = waterfallColor(norm);
        rowImg.data[off] = r;
        rowImg.data[off + 1] = g;
        rowImg.data[off + 2] = b;
        rowImg.data[off + 3] = 255;
      }
    }
    for (let row = 0; row < rowPx; row++) wfCtx.putImageData(rowImg, 0, row);

    // --- label sumbu frekuensi (dalam skala HT) ---
    if (hasAxis){
      const half = axisHalfHz;
      const centerHtHz = axisCenterHtHz;
      const freqAtX = (x) => centerHtHz - half + (x / w) * (2 * half);

      axisMinEl.textContent = formatMHz(centerHtHz - half) + ' MHz';
      axisCenterEl.textContent = formatMHz(centerHtHz) + ' MHz';
      axisMaxEl.textContent = formatMHz(centerHtHz + half) + ' MHz';
      // Disimpan dalam skala HT juga, supaya klik-untuk-tuning (di bawah)
      // otomatis konsisten: nilai yang dihitung dari klik langsung terpakai
      // sebagai freq_hz (HT) saat dikirim ke backend.
      spectrumCanvas.dataset.centerFreq = String(centerHtHz);
      spectrumCanvas.dataset.sampleRate = String(2 * axisHalfHz);

      // Sebelumnya cuma ada 3 label (kiri/tengah/kanan) di LUAR canvas, tanpa
      // garis bantu yang menunjukkan posisinya persis di mana pada grafik —
      // jadi sulit menebak "titik ini di frekuensi berapa". Sekarang tambah
      // 4 garis kisi vertikal + label MHz langsung di atas canvas, sejajar
      // posisi aslinya.
      specCtx.save();
      specCtx.font = `${Math.max(10, Math.round(11 * (window.devicePixelRatio || 1)))}px sans-serif`;
      specCtx.fillStyle = 'rgba(170,230,230,0.85)';
      specCtx.strokeStyle = 'rgba(88,214,214,0.20)';
      specCtx.lineWidth = 1;
      specCtx.textBaseline = 'top';
      for (let i = 1; i < 4; i++){
        const x = (w / 4) * i;
        specCtx.beginPath();
        specCtx.moveTo(x, 0);
        specCtx.lineTo(x, h);
        specCtx.stroke();
        const label = formatMHzShort(freqAtX(x));
        specCtx.textAlign = i === 2 ? 'center' : (i < 2 ? 'left' : 'right');
        specCtx.fillText(label, x, 2);
      }
      specCtx.restore();

      // Garis penanda: frekuensi yang SEDANG di-tune (currentFreq), supaya
      // langsung kelihatan jelas posisinya relatif terhadap sinyal di
      // spektrum/waterfall, bukan cuma angka di panel sebelah.
      if (typeof currentFreq === 'number' && currentFreq >= (centerHtHz - half) && currentFreq <= (centerHtHz + half)){
        const tunedX = ((currentFreq - (centerHtHz - half)) / (2 * half)) * w;
        specCtx.save();
        specCtx.strokeStyle = '#ffd23f';
        specCtx.lineWidth = 2;
        specCtx.shadowColor = 'rgba(255,210,63,0.65)';
        specCtx.shadowBlur = 5;
        specCtx.beginPath();
        specCtx.moveTo(tunedX, 0);
        specCtx.lineTo(tunedX, h);
        specCtx.stroke();
        specCtx.shadowBlur = 0;

        specCtx.font = `${Math.max(11, Math.round(12 * (window.devicePixelRatio || 1)))}px sans-serif`;
        specCtx.fillStyle = '#ffd23f';
        specCtx.textBaseline = 'bottom';
        specCtx.textAlign = tunedX > w - 90 ? 'right' : (tunedX < 90 ? 'left' : 'center');
        specCtx.fillText(`▼ ${formatMHz(currentFreq)} MHz`, tunedX, h - 4);
        specCtx.restore();
      }
    }
  }

  // Skema warna waterfall biru->cyan->kuning->merah (mirip SDR software pada umumnya)
  function waterfallColor(norm){
    const stops = [
      [0.00, 5, 10, 28],
      [0.30, 12, 35, 95],
      [0.50, 30, 100, 190],
      [0.68, 110, 200, 235],
      [0.82, 225, 245, 255],
      [0.92, 255, 205, 70],
      [1.00, 235, 60, 45],
    ];
    for (let i = 1; i < stops.length; i++){
      const [p0, r0, g0, b0] = stops[i - 1];
      const [p1, r1, g1, b1] = stops[i];
      if (norm <= p1 || i === stops.length - 1){
        const t = (norm - p0) / Math.max(1e-6, (p1 - p0));
        const tt = clamp(t, 0, 1);
        return [
          Math.round(r0 + (r1 - r0) * tt),
          Math.round(g0 + (g1 - g0) * tt),
          Math.round(b0 + (b1 - b0) * tt),
        ];
      }
    }
    return [0, 0, 0];
  }

  // Klik pada grafik spektrum -> tuning langsung ke frekuensi tsb
  spectrumCanvas.addEventListener('click', (e) => {
    const centerFreq = Number(spectrumCanvas.dataset.centerFreq);
    const sampleRate = Number(spectrumCanvas.dataset.sampleRate);
    if (!centerFreq || !sampleRate) return;
    const rect = spectrumCanvas.getBoundingClientRect();
    const xNorm = (e.clientX - rect.left) / rect.width;
    const freqHz = centerFreq - sampleRate / 2 + xNorm * sampleRate;
    commitFreqDisplay(freqHz, 'klik spektrum');
  });

  async function pollSpectrum(){
    // Guard supaya request /spectrum berikutnya tidak ditembak sebelum
    // yang sebelumnya selesai (mencegah request menumpuk kalau backend
    // lambat/mati) -- lihat catatan PERBAIKAN di deklarasi variabel di atas.
    if (spectrumPollInFlight) return;
    spectrumPollInFlight = true;
    try{
      const res = await fetch(`${API_BASE}/spectrum`);
      const data = await safeJson(res);
      if (!data.ok){
        spectrumFailStreak++;
        setRtltcpStatus(false, data.error || 'Belum ada data.');
        return;
      }
      spectrumFailStreak = 0;
      setRtltcpStatus(true, 'Tersambung, menerima data spektrum.');
      drawSpectrumFrame(data.db, data.center_freq_hz, data.sample_rate_hz);
    } catch(err){
      spectrumFailStreak++;
      setRtltcpStatus(false, `Gagal mengambil data spektrum: ${err.message}`);
    } finally {
      spectrumPollInFlight = false;
      if (spectrumRunning){
        let delay = SPECTRUM_POLL_BASE_MS;
        if (spectrumFailStreak > SPECTRUM_POLL_BACKOFF_START){
          const backoffLevel = spectrumFailStreak - SPECTRUM_POLL_BACKOFF_START;
          delay = Math.min(SPECTRUM_POLL_MAX_MS, SPECTRUM_POLL_BASE_MS * Math.pow(2, backoffLevel));
        }
        spectrumPollTimer = setTimeout(pollSpectrum, delay);
      }
    }
  }

  function setRtltcpStatus(online, text){
    rtltcpDot.classList.toggle('online', online);
    rtltcpStatusText.textContent = text;
  }

  function startSpectrum(){
    resizeScopeCanvases();
    waterfallInitialized = false;
    specScale = null;
    spectrumRunning = true;
    setConnectButton(true);
    scopeEmpty.hidden = true;
    spectrumStatusPill.textContent = 'Tersambung';
    spectrumStatusPill.classList.add('busy');
    if (spectrumPollTimer) clearTimeout(spectrumPollTimer);
    spectrumFailStreak = 0;
    spectrumPollInFlight = false;
    pollSpectrum(); // polling berikutnya dijadwalkan otomatis di dalam pollSpectrum()
    if (isDirectRadioSource(activeSpectrumSource)) startWeb888AudioMonitor();
    refreshSquelch();
  }

  function stopSpectrumUi(){
    spectrumRunning = false;
    setConnectButton(false);
    scopeEmpty.hidden = false;
    spectrumStatusPill.textContent = 'Belum tersambung';
    spectrumStatusPill.classList.remove('busy');
    if (spectrumPollTimer) clearTimeout(spectrumPollTimer);
    spectrumPollTimer = null;
    stopWeb888AudioMonitor();
    baseWfSpanHz = null;
    serverZoomActive = false;
    refreshSquelch();
  }

  spectrumToggleBtn.addEventListener('click', async () => {
    if (listenerActive){
      if (listenerClient?.status?.running) listenerStop(); else listenerStart();
      return;
    }
    if (spectrumRunning){
      stopSpectrumUi();
      try{
        await fetch(`${API_BASE}/spectrum/stop`, { method: 'POST' });
      } catch(err){ /* abaikan */ }
      log('Radio diputuskan.', 'warn');
      return;
    }
    try{
      const res = await fetch(`${API_BASE}/spectrum/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(radioSourceSelect.value === 'network' ? {
          source: 'network',
          host: rtltcpHostInput.value.trim() || undefined,
          port: Number(rtltcpPortInput.value) || undefined,
        } : {
          source: radioSourceSelect.value,
          lna_gain: listenerNumber('listenerLna'),
          vga_gain: listenerNumber('listenerVga'),
          amp: $('listenerAmp').checked,
        }),
      });
      const data = await safeJson(res);
      if (!data.ok){
        log(`Gagal menyambungkan radio: ${data.error}`, 'err');
        return;
      }
      activeSpectrumSource = data.source || null;
      baseWfSpanHz = Number(data.wf_span_hz || data.sample_rate_hz) || null;
      serverZoomActive = false;
      if (activeSpectrumSource === 'web888'){
        log(`Tersambung ke Radio V1 · Web-888 ${data.host}:${data.port}; suara HT ikut diputar di browser.`, 'ok');
      } else if (activeSpectrumSource === 'hackrf'){
        log(`Tersambung ke Radio V2 · ${data.simulate ? 'simulasi server' : 'USB lewat server'} (LNA ${data.lna_gain} dB, VGA ${data.vga_gain} dB); suara HT ikut diputar di browser.`, 'ok');
      } else {
        log(`Tersambung ke rtl_tcp ${data.host}:${data.port}.`, 'ok');
      }
      // PERBAIKAN: begitu baru tersambung, radio/Web-888 masih di frekuensi
      // terakhir yang kebetulan tersimpan di perangkat (bisa beda jauh dari
      // frekuensi HT yang tampil di panel, mis. jadi 228.8 MHz padahal
      // panel menampilkan 155.700000). Paksa kirim ulang frekuensi HT yang
      // sedang tampil di panel supaya radio langsung di-tune & terkalibrasi
      // ke frekuensi HT yang benar sejak awal tersambung, bukan ikut
      // frekuensi lama yang tidak sesuai.
      sendFreqToSdr(currentFreq);
      startSpectrum();
    } catch(err){
      log(`Gagal menghubungi backend: ${err.message}`, 'err');
    }
  });

  /* ============================================================
     LISTENER: squelch & Rekam VFO
     ============================================================ */
  const squelchSlider = $('squelchSlider');
  const squelchValueEl = $('squelchValue');
  const squelchUnitEl = $('squelchUnit');
  const squelchStateEl = $('squelchState');
  const squelchNoteEl = $('squelchNote');

  function setSquelchState(open){
    squelchStateEl.textContent = open ? 'terbuka' : 'tertutup';
    squelchStateEl.classList.toggle('is-open', open);
  }

  function disableSquelch(note){
    squelchSlider.disabled = true;
    squelchValueEl.textContent = '—';
    squelchUnitEl.textContent = '';
    squelchNoteEl.textContent = note;
  }

  // GET/POST /sdr/squelch: Web-888 dalam dBm (S-meter), Radio V2 lewat server
  // dalam dB di atas noise. Radio V2 di browser & SDR++ mengatur squelch sendiri.
  async function refreshSquelch(){
    if (listenerActive){
      disableSquelch('Squelch Radio V2 di browser diatur di panel radio (bagian VFO).');
      return;
    }
    if (!spectrumRunning){
      disableSquelch('Sambungkan radio untuk mengatur squelch.');
      return;
    }
    try{
      const data = await safeJson(await fetch(`${API_BASE}/sdr/squelch`));
      if (!data.ok || !data.supported){
        disableSquelch('Sumber ini tidak mendukung squelch dari aplikasi (atur di SDR++).');
        return;
      }
      squelchSlider.min = data.min;
      squelchSlider.max = data.max;
      squelchSlider.step = data.step;
      squelchSlider.value = data.value;
      squelchSlider.disabled = false;
      setSliderFill(squelchSlider);
      squelchValueEl.textContent = Number(data.value).toFixed(0);
      squelchUnitEl.textContent = data.unit;
      squelchNoteEl.textContent = data.unit === 'dBm'
        ? 'Suara diteruskan bila kuat sinyal di atas ambang ini.'
        : 'Suara diteruskan bila sinyal sekian dB di atas noise.';
      setSquelchState(Boolean(data.open));
    } catch(err){
      disableSquelch('Gagal membaca squelch dari backend.');
    }
  }

  squelchSlider.addEventListener('input', () => {
    squelchValueEl.textContent = Number(squelchSlider.value).toFixed(0);
    setSliderFill(squelchSlider);
  });
  squelchSlider.addEventListener('change', async () => {
    try{
      const res = await fetch(`${API_BASE}/sdr/squelch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: Number(squelchSlider.value) }),
      });
      const data = await safeJson(res);
      if (data.ok) log(`Squelch diatur ke ${Number(data.value).toFixed(0)} ${data.unit}.`, 'ok');
      else log(`Gagal mengatur squelch: ${data.error}`, 'warn');
    } catch(err){
      log(`Gagal mengatur squelch: ${err.message}`, 'err');
    }
  });

  /* ---- Rekam VFO: rekam suara radio yang sedang didengar ke database Rekaman ---- */
  const vfoRecordBtn = $('vfoRecordBtn');
  const vfoRecordStatus = $('vfoRecordStatus');
  let vfoRecording = false;

  // Perangkat untuk /record-radio sesuai sumber radio yang sedang tersambung.
  function vfoRecordDevice(){
    if (listenerActive) return listenerClient?.status?.running ? WEBUSB_DEVICE_INDEX : null;
    if (!spectrumRunning) return null;
    if (activeSpectrumSource === 'web888') return '-888';
    if (activeSpectrumSource === 'hackrf') return '-1';
    // SDR++ / rtl_tcp: suaranya masuk lewat perangkat audio lokal yang dipilih di Auto Translate.
    const local = deviceSelect.value;
    return local !== '' && Number(local) >= 0 ? local : null;
  }

  // Perangkat audio lokal (SDR++/VB-Cable): sumbernya nama perangkat itu sendiri.
  function recordMetaForDevice(deviceIndex){
    const meta = recordMeta();
    if (Number(deviceIndex) >= 0){
      const option = deviceSelect.options[deviceSelect.selectedIndex];
      meta.source_label = option ? option.textContent : meta.source_label;
    }
    return meta;
  }

  function recordMeta(){
    const option = radioSourceSelect.options[radioSourceSelect.selectedIndex];
    return {
      source_label: option ? option.textContent : '',
      freq_hz: Math.round(currentFreq),
      mode: listenerActive ? (listenerClient?.status?.vfo?.mode || listenerModeFromUi()).toUpperCase() : modeSelect.value,
      bandwidth_hz: listenerActive ? (listenerClient?.status?.vfo?.bandwidthHz ?? null) : Math.round(currentBw),
    };
  }

  function setVfoRecordUi(active, text){
    vfoRecording = active;
    vfoRecordBtn.textContent = active ? 'Berhenti & simpan' : 'Rekam VFO';
    vfoRecordBtn.classList.toggle('is-running', active);
    vfoRecordStatus.textContent = text || '';
  }

  vfoRecordBtn.addEventListener('click', async () => {
    if (vfoRecording){
      vfoRecordBtn.disabled = true;
      vfoRecordStatus.textContent = 'Menyimpan…';
      await stopActiveRecording();
      vfoRecordBtn.disabled = false;
      return;
    }
    const device = vfoRecordDevice();
    if (device === null){
      log(listenerActive || spectrumRunning
        ? 'Rekam VFO: untuk rtl_tcp/SDR++, pilih dulu perangkat input audio di halaman Auto Translate.'
        : 'Rekam VFO: sambungkan radio dulu.', 'warn');
      return;
    }
    const viaWebusb = device === WEBUSB_DEVICE_INDEX;
    if (viaWebusb && !(await startWebusbForwarding())) return;
    const translate = $('vfoRecordTranslate').checked;
    setVfoRecordUi(true, 'Merekam… tekan lagi untuk berhenti & menyimpan.');
    log(`Rekam VFO dimulai (${formatMHz(currentFreq)} MHz${translate ? ', sekalian diterjemahkan' : ''}).`, 'info');
    try{
      const res = await fetch(`${API_BASE}/record-radio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_index: Number(device),
          rms_threshold: 2.0e-5,
          max_sec: 300,
          lang: selectedPapuaLang,
          skip_translate: !translate,
          meta: recordMeta(),
        }),
      });
      const data = await safeJson(res);
      if (!data.ok){
        setVfoRecordUi(false, '');
        log(`Rekam VFO: ${data.error || 'tidak ada suara yang terekam.'}`, 'warn');
        return;
      }
      setVfoRecordUi(false, `Tersimpan (${Number(data.duration_sec ?? 0).toFixed(1)} dtk). Lihat di halaman Rekaman.`);
      log(`Rekam VFO tersimpan sebagai rekaman #${data.record_id ?? '?'} (${Number(data.duration_sec ?? 0).toFixed(1)} dtk).`, 'ok');
      if (translate && data.text_indonesia){
        whisperOutput.value = data.text_papua || '';
        translationOutput.value = data.text_indonesia || '';
      }
      recordsChanged();
    } catch(err){
      setVfoRecordUi(false, '');
      log(`Rekam VFO gagal: ${err.message}`, 'err');
    } finally {
      if (viaWebusb) stopWebusbForwarding();
    }
  });

  /* ============================================================
     SPECTRUM (Radio V1 / V2 lewat server): cari frekuensi HT otomatis
     lewat backend /scan/*. Hanya dipolling selama tab Spectrum tampil.
     ============================================================ */
  const scanStatusEl = $('scanStatus');
  const scanCardLabel = $('scanCardLabel');
  const scanCardFreq = $('scanCardFreq');
  let scanPollTimer = null;

  function startScanPolling(){
    if (scanPollTimer) return;
    pollScan();
    scanPollTimer = setInterval(pollScan, 1000);
  }

  function stopScanPolling(){
    if (scanPollTimer) clearInterval(scanPollTimer);
    scanPollTimer = null;
  }

  async function pollScan(){
    try{
      const s = await safeJson(await fetch(`${API_BASE}/scan/status`));
      if (!s.ok) return;
      const state = !s.enabled ? 'idle' : s.state;
      const label = { idle: 'Pencarian berhenti', scanning: 'Mencari sinyal…', locked: 'Sinyal ditemukan' }[state] || state;
      scanCardLabel.textContent = label;
      scanCardFreq.textContent = state === 'locked' ? listenerMhz(s.locked_hz) : state === 'scanning' ? listenerMhz(s.current_hz) : '—';
      $('scanCard').classList.toggle('is-locked', state === 'locked');
      const rows = [
        ['Status', label],
        ['Rentang', `${listenerMhz(s.min_hz)} – ${listenerMhz(s.max_hz)}`],
        ['Langkah', `${(s.step_hz / 1000).toFixed(1)} kHz · jeda ${Math.round(s.dwell_sec * 1000)} ms`],
        ['Posisi', listenerMhz(s.current_hz)],
        ['Terkunci', s.locked_hz ? listenerMhz(s.locked_hz) : '—'],
        ['Error', s.error || '—'],
      ];
      scanStatusEl.replaceChildren(...rows.flatMap(([key, value]) => {
        const dt = document.createElement('dt'); dt.textContent = key;
        const dd = document.createElement('dd'); dd.textContent = String(value);
        return [dt, dd];
      }));
    } catch(err){ /* backend sibuk/mati: coba lagi di tick berikutnya */ }
  }

  $('scanStartBtn').addEventListener('click', async () => {
    if (!spectrumRunning){
      log('Cari HT otomatis: sambungkan radio dulu.', 'warn');
      return;
    }
    const mhz = (id) => Number(String($(id).value).replace(',', '.'));
    const config = {
      min_hz: Math.round(mhz('scanMin') * 1e6),
      max_hz: Math.round(mhz('scanMax') * 1e6),
      step_hz: Math.round(mhz('scanStep') * 1e3),
      dwell_sec: mhz('scanDwell') / 1000,
    };
    if (!(config.min_hz > 0 && config.max_hz > config.min_hz && config.step_hz > 0 && config.dwell_sec > 0)){
      log('Cari HT otomatis: isi rentang, langkah dan jeda dengan angka yang benar.', 'warn');
      return;
    }
    try{
      await fetch(`${API_BASE}/scan/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const data = await safeJson(await fetch(`${API_BASE}/scan/start`, { method: 'POST' }));
      if (data.ok) log(`Cari HT otomatis dimulai (${formatMHz(config.min_hz)}–${formatMHz(config.max_hz)} MHz).`, 'ok');
      else log(`Gagal memulai pencarian: ${data.error}`, 'warn');
      pollScan();
    } catch(err){
      log(`Gagal memulai pencarian: ${err.message}`, 'err');
    }
  });
  $('scanStopBtn').addEventListener('click', async () => {
    try{
      await fetch(`${API_BASE}/scan/stop`, { method: 'POST' });
      log('Cari HT otomatis dihentikan.', 'warn');
      pollScan();
    } catch(err){ /* abaikan */ }
  });

  /* ============================================================
     HACKRF WEBUSB — HackRF Listener Kit (listener_kit/, /listener/)
     Kit-nya sendiri yang memegang USB HackRF di browser; halaman ini
     cuma host yang mengendalikannya lewat postMessage
     (static/hackrf-listener-client.js, docs/EMBED_API.md di repo kit).
     Selama Sumber Radio = "webusb":
       - tab Listener menampilkan panel radio kit (spektrum, waterfall, VFO),
       - tab Spectrum menampilkan hasil pindai lebar (receiver:sweep),
       - panel Frekuensi, Mode dan Volume mengendalikan VFO kit,
       - polling /sdr/frequency & /sdr/mode ke backend dijeda.
     Iframe dimuat saat sumber ini pertama kali dipilih dan TIDAK
     pernah dilepas lagi (cukup disembunyikan): reload/unmount iframe
     menghentikan radio.
     ============================================================ */
  const listenerFrame = $('listenerFrame');
  const listenerStatusEl = $('listenerStatus');
  const listenerMockInput = $('listenerMock');
  const listenerMarkersEl = $('listenerMarkers');
  const listenerSweepCanvas = $('listenerSweepCanvas');
  const listenerSweepInfo = $('listenerSweepInfo');

  // Target VFO digeser sejauh ini dari pusat RX supaya tidak jatuh di DC spike HackRF.
  const LISTENER_DC_OFFSET_HZ = 250000;
  // Mode di dropdown halaman ini -> mode demodulasi kit. "FM" di aplikasi ini
  // dipakai untuk HT suara (narrow), sama seperti di jalur Web-888.
  const LISTENER_MODE_FROM_UI = { FM: 'nfm', NFM: 'nfm', AM: 'am', USB: 'usb', LSB: 'lsb' };
  const LISTENER_MODE_TO_UI = { am: 'AM', usb: 'USB', lsb: 'LSB' };
  const LISTENER_CODE_TEXT = {
    NOT_READY: 'Panel radio belum siap. Tunggu sebentar lalu coba lagi.',
    INVALID_COMMAND: 'Perintah ke panel radio tidak valid.',
    NO_WEBUSB: 'Browser ini tidak mendukung WebUSB. Buka aplikasi di Chrome atau Edge (lewat localhost atau HTTPS).',
    NEEDS_PAIRING: 'Hubungkan perangkat radio sekali lewat tombol Connect Device di panel radio, lalu tekan Mulai RX lagi.',
    NEEDS_DEVICE_CHOICE: 'Ada lebih dari satu perangkat radio yang diizinkan. Pilih salah satu lewat Connect Device di panel radio.',
    MOCK_UNAVAILABLE: 'Mock SDR hanya tersedia saat aplikasi dibuka dari localhost.',
    CONNECT_FAILED: 'Gagal menyambung ke radio. Cek kabel USB dan pastikan radio tidak dipakai program lain (mis. sumber Radio V2 · USB lewat server).',
    SWEEP_BUSY: 'Radio sedang dipakai wide scan. Hentikan pindai dulu.',
    RX_NOT_RUNNING: 'RX belum berjalan. Tekan Mulai RX dulu.',
    OUT_OF_RANGE: 'Nilai di luar jangkauan (frekuensi 1 MHz–6 GHz, scan 1–7250 MHz, LNA 0–40 step 8, VGA 0–62 step 2).',
    AUDIO_BLOCKED: 'Browser menahan audio. Klik sekali di dalam panel radio, lalu tekan Dengarkan lagi.',
    RECORDING_ACTIVE: 'Rekaman audio di panel radio sedang berjalan.',
    SWEEP_UNSUPPORTED: 'Firmware radio ini tidak mendukung wide scan native. Pilih sumber sweep manual di tab Spectrum panel radio.',
    SWEEP_FAILED: 'Wide scan gagal dijalankan.',
    MARKER_LIMIT: 'Jumlah marker sudah mencapai batas (10.000).',
    MARKER_NOT_FOUND: 'Marker tidak ditemukan (mungkin sudah dihapus).',
    MARKER_SAVE_FAILED: 'Marker gagal disimpan di browser.',
    TIMEOUT: 'Panel radio tidak menjawab tepat waktu. Muat ulang halaman bila terus terjadi.',
  };
  const LISTENER_STATUS_ERROR_TEXT = {
    USB_LOST: 'Koneksi USB radio terputus.',
    RX_ERROR: 'Terjadi kesalahan saat menerima sinyal.',
    NO_WEBUSB: 'Browser tidak mendukung WebUSB (pakai Chrome atau Edge).',
  };

  let listenerClient = null;
  let listenerClientPromise = null;
  let listenerActive = false;      // Sumber Radio = webusb
  let listenerBwNoticeShown = false;
  let listenerLastBw = null;
  let listenerReceiverRev = null;  // tune.receiverRev terakhir dari receiver:status kit
  let listenerSweepActive = false; // wide scan sedang berjalan (fase selain idle)
  let listenerKitSweepRange = null; // rentang pindai terakhir yang dilaporkan kit

  // Perangkat "HackRF WebUSB" di dropdown Radio Input Device (WEBUSB_VIRTUAL_DEVICE_INDEX backend).
  const WEBUSB_DEVICE_INDEX = '-2';
  const WEBUSB_FLUSH_SAMPLES = 12000;       // kirim tiap ~250 ms @48 kHz
  const WEBUSB_MAX_BACKLOG_SAMPLES = 96000; // maks ~2 dtk tertahan bila backend lambat
  let webusbForwarding = false;
  let webusbPending = [];
  let webusbPendingSamples = 0;
  let webusbSampleRate = 48000;
  let webusbGap = false;
  let webusbPostInFlight = false;
  let webusbPostedOk = 0;

  function listenerResultText(result){
    const text = LISTENER_CODE_TEXT[result.code] || `Kode ${result.code}.`;
    return result.message ? `${text} (${result.message})` : text;
  }

  function reportListener(label, result){
    if (result.ok) log(`Radio V2 · ${label}: berhasil.`, 'ok');
    else log(`Radio V2 · ${label}: ${listenerResultText(result)}`, result.code === 'TIMEOUT' ? 'err' : 'warn');
    return result;
  }

  function ensureListener(){
    if (listenerClientPromise) return listenerClientPromise;
    listenerClientPromise = import('/static/hackrf-listener-client.js').then(({ createListenerClient }) => {
      const kitUrl = new URL('/listener/', location.href);
      kitUrl.searchParams.set('theme', 'dark');
      kitUrl.searchParams.set('lang', 'id');
      // Kit hanya menawarkan Mock SDR di localhost/127.0.0.1; ?mock=1 di host lain tidak berefek.
      kitUrl.searchParams.set('mock', '1');
      listenerFrame.src = kitUrl.href;
      listenerClient = createListenerClient(listenerFrame);
      listenerClient.on('status', onListenerStatus);
      listenerClient.on('sweep', onListenerSweep);
      listenerClient.on('markers', onListenerMarkers);
      listenerClient.on('audio', onListenerAudio);
      // Kit yang dimuat ulang mulai menghitung receiverRev dari awal lagi.
      listenerClient.on('hello', () => { listenerReceiverRev = null; });
      spectrumStatusPill.textContent = 'Memuat panel radio…';
      listenerClient.ready.then((hello) => {
        if (listenerActive) spectrumStatusPill.textContent = 'Belum tersambung';
        listenerMockInput.disabled = !hello.mockAvailable;
        if (!hello.mockAvailable) listenerMockInput.checked = false;
        log(`Radio V2: panel radio siap (WebUSB ${hello.webusb ? 'tersedia' : 'TIDAK tersedia'}${hello.mockAvailable ? ', mode simulasi tersedia' : ''}).`, hello.webusb ? 'ok' : 'warn');
        if (!hello.webusb) log(`Radio V2: ${LISTENER_CODE_TEXT.NO_WEBUSB}`, 'warn');
        listenerClient.appearance({ theme: 'dark', lang: 'id' }).then((r) => { if (!r.ok) reportListener('tampilan', r); });
        if (webusbForwarding || listenerSweepActive) listenerUpdateSubscription();
      });
      return listenerClient;
    });
    return listenerClientPromise;
  }

  // Spektrum & waterfall Radio V2 tampil di panel radio kit sendiri, jadi halaman
  // ini tidak berlangganan spektrum RX. Langganan dibuka hanya untuk:
  //   - grafik pindai lebar di tab Spectrum (receiver:sweep butuh spectrum: true),
  //     selama scan berjalan;
  //   - audio, selama rekaman Auto Translate memakai Radio V2 di browser.
  function listenerUpdateSubscription(){
    if (!listenerClient) return Promise.resolve(null);
    const subscription = { spectrum: listenerSweepActive, audio: webusbForwarding, bins: 512, fps: 5 };
    return listenerClient.subscribe(subscription).then((r) => {
      if (!r.ok) reportListener('langganan audio', r);
      return r;
    });
  }

  /* ---- Masuk/keluar sumber "webusb" (dipanggil dari applyRadioSourceUi) ---- */
  function setListenerSourceActive(active){
    if (active === listenerActive) return;
    listenerActive = active;
    if (active){
      // Sumber backend (Web-888 / rtl_tcp / HackRF USB) dimatikan: satu HackRF
      // tidak bisa dipegang backend dan browser sekaligus.
      if (spectrumRunning) stopSpectrumUi();
      fetch(`${API_BASE}/spectrum/stop`, { method: 'POST' }).catch(() => {});
      activeSpectrumSource = null;
      freqOffsetHz = 0; // frekuensi kit sudah frekuensi tampil (termasuk Freq Shift-nya sendiri)
      ensureListener();
    } else {
      if (listenerClient?.status?.running) listenerClient.stop().then((r) => reportListener('hentikan RX', r));
      setListenerScopeUi(false, false);
      loadFreqOffset();
      waterfallInitialized = false;
      requestAnimationFrame(resizeScopeCanvases);
    }
  }

  function setListenerScopeUi(running, mock){
    setConnectButton(running);
    spectrumStatusPill.textContent = running ? (mock ? 'Simulasi · bukan RF' : 'Tersambung') : 'Belum tersambung';
    spectrumStatusPill.classList.toggle('busy', running);
  }

  /* ---- Perintah ---- */
  function listenerModeFromUi(){
    return LISTENER_MODE_FROM_UI[modeSelect.value] || 'nfm';
  }

  async function listenerStart(){
    const client = await ensureListener();
    listenerSendGains(true);
    const hz = Math.round(currentFreq);
    const result = await client.start({
      mock: listenerMockInput.checked,
      listen: true,
      mode: listenerModeFromUi(),
      centerHz: hz + LISTENER_DC_OFFSET_HZ,
      vfoHz: hz,
    });
    reportListener(listenerMockInput.checked ? 'mulai RX (Mock SDR)' : 'mulai RX', result);
  }

  async function listenerStop(){
    if (!listenerClient) return;
    reportListener('hentikan RX', await listenerClient.stop());
  }

  async function listenerTune(hz){
    if (!listenerClient) return;
    hz = Math.round(hz);
    const status = listenerClient.status;
    const offset = status?.centerHz ? Math.abs(hz - status.centerHz) : Infinity;
    const span = status?.sampleRateHz || 0;
    // Masih di dalam bentang RX (dan jauh dari DC): cukup geser VFO, tanpa retune.
    const result = status?.running && offset < span * 0.4 && offset > 20000
      ? await listenerClient.vfo({ frequencyHz: hz })
      : await listenerClient.tune(hz + LISTENER_DC_OFFSET_HZ, hz);
    if (!result.ok) reportListener('tala frekuensi', result);
  }

  async function listenerSetMode(mode, bandwidthHz){
    if (!listenerClient) return;
    const result = await listenerClient.vfo({ mode: LISTENER_MODE_FROM_UI[mode] || 'nfm' });
    if (!result.ok) reportListener('mode', result);
    // Panel Bandwidth ikut terkirim di setiap ganti mode; beri tahu sekali saja
    // begitu nilainya benar-benar diubah.
    if (listenerLastBw !== null && bandwidthHz !== listenerLastBw && !listenerBwNoticeShown){
      listenerBwNoticeShown = true;
      log('Radio V2: bandwidth VFO diatur di dalam panel radio (API kit belum punya perintah bandwidth).', 'info');
    }
    listenerLastBw = bandwidthHz;
  }

  function listenerNumber(id){
    const value = Number(String($(id).value).replace(',', '.'));
    return Number.isFinite(value) ? value : NaN;
  }

  async function listenerSendGains(quiet){
    const client = await ensureListener();
    const result = await client.gains({
      lnaDb: listenerNumber('listenerLna'),
      vgaDb: listenerNumber('listenerVga'),
      amp: $('listenerAmp').checked,
    });
    if (!quiet || !result.ok) reportListener('gain', result);
  }

  // Bila rekaman audio di dalam kit sedang berjalan, operator ditanya di halaman
  // ini (kit tidak pernah membuka confirm() atas perintah host), lalu dikirim ulang.
  async function listenerWithRecordingConfirm(label, question, send){
    let result = await send(false);
    if (result.code === 'RECORDING_ACTIVE' && window.confirm(question)) result = await send(true);
    return reportListener(label, result);
  }

  function listenerSweepRange(){
    return {
      startHz: Math.round(listenerNumber('listenerSweepStart') * 1e6),
      stopHz: Math.round(listenerNumber('listenerSweepStop') * 1e6),
      fftSize: Number($('listenerSweepFft').value),
    };
  }

  $('listenerListenBtn').addEventListener('click', async () => {
    const client = await ensureListener();
    reportListener('dengarkan', await client.listen(true));
  });
  $('listenerMuteBtn').addEventListener('click', async () => {
    const client = await ensureListener();
    reportListener('bisukan', await client.listen(false));
  });
  $('listenerGainsBtn').addEventListener('click', () => listenerSendGains(false));
  $('listenerRadioBtn').addEventListener('click', async () => {
    const client = await ensureListener();
    const sampleRateHz = Number($('listenerSampleRate').value);
    listenerWithRecordingConfirm('sample rate',
      'Rekaman audio di panel radio sedang berjalan. Ganti sample rate dan lanjutkan rekaman di segmen baru?',
      (confirmRecording) => client.radio(confirmRecording ? { sampleRateHz, confirmRecording } : { sampleRateHz }));
  });
  $('listenerSweepConfigBtn').addEventListener('click', async () => {
    const client = await ensureListener();
    reportListener('atur rentang scan', await client.sweepConfig(listenerSweepRange()));
  });
  $('listenerSweepStartBtn').addEventListener('click', async () => {
    const client = await ensureListener();
    const mock = listenerMockInput.checked;
    listenerWithRecordingConfirm(mock ? 'mulai pindai (simulasi)' : 'mulai pindai',
      'Rekaman audio di panel radio sedang berjalan. Wide scan akan mengakhiri rekaman itu. Lanjutkan?',
      (confirmRecording) => client.sweepStart(confirmRecording ? { mock, confirmRecording } : { mock }));
  });
  $('listenerSweepStopBtn').addEventListener('click', async () => {
    const client = await ensureListener();
    reportListener('hentikan pindai', await client.sweepStop({ resumeRx: $('listenerSweepResume').checked }));
  });
  $('listenerMarkerAddBtn').addEventListener('click', async () => {
    const client = await ensureListener();
    const hz = client.status?.vfo?.frequencyHz ?? Math.round(currentFreq);
    reportListener(`marker ${formatMHz(hz)} MHz`, await client.addMarker(hz));
  });
  listenerMarkersEl.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-marker-id]');
    if (!button || !listenerClient) return;
    reportListener('hapus marker', await listenerClient.removeMarker(button.dataset.markerId));
  });

  if (volumeSlider){
    const sendVolume = () => {
      if (listenerActive && listenerClient) listenerClient.vfo({ volume: clamp(Number(volumeSlider.value), 0, 100) });
    };
    volumeSlider.addEventListener('input', sendVolume);
    if (volumeIcon) volumeIcon.addEventListener('click', sendVolume);
  }

  /* ---- Pesan dari kit ---- */
  function listenerMhz(hz){
    return hz == null ? '—' : `${formatMHz(hz)} MHz`;
  }

  function onListenerStatus(status){
    const mock = status.mock;
    // Kolom rentang pindai mengikuti rentang di kit bila rentang kit berubah
    // (mis. diatur operator di dalam panel radio); ketikan sendiri tidak ditimpa.
    const kitRange = `${status.sweep.startHz}-${status.sweep.stopHz}`;
    if (kitRange !== listenerKitSweepRange){
      listenerKitSweepRange = kitRange;
      $('listenerSweepStart').value = String(Math.round(status.sweep.startHz / 1e3) / 1e3);
      $('listenerSweepStop').value = String(Math.round(status.sweep.stopHz / 1e3) / 1e3);
    }
    const sweepActive = status.sweep.phase !== 'idle';
    if (sweepActive !== listenerSweepActive){
      listenerSweepActive = sweepActive;
      listenerUpdateSubscription();
    }

    const vfo = status.vfo;
    const rows = [
      ['Perangkat', status.connected ? (mock ? 'Simulasi (bukan RF nyata)' : 'Radio V2 (USB)') : 'Belum tersambung'],
      ['Listener', status.running ? 'Berjalan' : 'Berhenti'],
      ['Pusat RX', listenerMhz(status.centerHz)],
      ['Sample rate', status.sampleRateHz ? `${status.sampleRateHz / 1e6} MSPS` : '—'],
      ['VFO', vfo ? `${listenerMhz(vfo.frequencyHz)} · ${vfo.mode.toUpperCase()} · ${vfo.enabled ? 'terdengar' : 'bisu'}` : '—'],
      ['Audio', { none: 'mati', suspended: 'ditahan browser', running: 'aktif' }[status.audio] || status.audio],
      ['Squelch', status.squelchOpen ? 'terbuka' : 'tertutup'],
      ['Pindai lebar', `${{ idle: 'berhenti', starting: 'memulai', active: 'berjalan', stopping: 'menghentikan' }[status.sweep.phase] || status.sweep.phase} · ${listenerMhz(status.sweep.startHz)} – ${listenerMhz(status.sweep.stopHz)}`],
      ['Error', status.error ? (LISTENER_STATUS_ERROR_TEXT[status.error.code] || status.error.code) : '—'],
    ];
    listenerStatusEl.replaceChildren(...rows.flatMap(([key, value]) => {
      const dt = document.createElement('dt'); dt.textContent = key;
      const dd = document.createElement('dd'); dd.textContent = String(value);
      return [dt, dd];
    }));

    if (!listenerActive) return;
    setListenerScopeUi(status.running, mock);
    if (status.busy === 'sweep'){
      setConnectButton(false);
      spectrumStatusPill.textContent = mock ? 'Pindai lebar · simulasi' : 'Pindai lebar';
      spectrumStatusPill.classList.add('busy');
    }
    setRtltcpStatus(status.connected, status.connected
      ? (mock ? 'Simulasi tersambung (bukan RF nyata).' : 'Radio V2 tersambung.')
      : 'Radio V2 belum tersambung.');
    // Hanya ikut frekuensi/mode kit bila OPERATOR menala di dalam kit
    // (tune.receiverRev naik); status awal kit tidak boleh menimpa panel ini.
    const receiverRev = status.tune ? status.tune.receiverRev : 0;
    const tunedInKit = listenerReceiverRev !== null && receiverRev > listenerReceiverRev;
    listenerReceiverRev = receiverRev;
    if (!tunedInKit || !vfo) return;
    if (Number.isFinite(vfo.frequencyHz) && !userEditingFreq && Math.round(currentFreq) !== vfo.frequencyHz){
      applyRemoteFreq(vfo.frequencyHz);
    }
    const uiMode = LISTENER_MODE_TO_UI[vfo.mode];
    if (uiMode && modeSelect.value !== uiMode) modeSelect.value = uiMode;
    else if (vfo.mode === 'nfm' && !['FM', 'NFM'].includes(modeSelect.value)) modeSelect.value = 'NFM';
  }

  // Frame pindai terakhir (untuk sumbu, hover dan klik-untuk-mendengarkan).
  let lastSweepFrame = null;

  function onListenerSweep(frame){
    lastSweepFrame = frame;
    const canvas = listenerSweepCanvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    const bins = frame.bins;
    let min = Infinity, max = -Infinity;
    for (const v of bins){ if (v > -199){ if (v < min) min = v; if (v > max) max = v; } }
    if (!Number.isFinite(min)) return;
    min -= 5; max = Math.max(max + 5, min + 30);
    ctx.fillStyle = '#030b0c';
    ctx.fillRect(0, 0, w, h);
    // Garis bantu horizontal tiap 10 dB.
    ctx.strokeStyle = 'rgba(88,214,214,0.12)';
    ctx.lineWidth = 1;
    ctx.font = `${Math.round(11 * dpr)}px sans-serif`;
    ctx.fillStyle = 'rgba(170,230,230,0.7)';
    ctx.textBaseline = 'middle';
    for (let db = Math.ceil(min / 10) * 10; db <= max; db += 10){
      const y = h - ((db - min) / (max - min)) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(`${db} dB`, 6 * dpr, y);
    }
    ctx.strokeStyle = '#f2b544';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    for (let i = 0; i < bins.length; i++){
      const x = (i / Math.max(1, bins.length - 1)) * w;
      const y = h - ((Math.max(bins[i], min) - min) / (max - min)) * h;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    const simulated = listenerClient?.status?.sweep?.source === 'simulated' || listenerClient?.status?.mock;
    if (simulated){
      ctx.font = `${Math.round(12 * dpr)}px sans-serif`;
      ctx.fillStyle = '#f2b544';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('SIMULASI · BUKAN RF NYATA', w - 8, 6);
      ctx.textAlign = 'left';
    }
    $('sweepAxisMin').textContent = listenerMhz(frame.startHz);
    $('sweepAxisCenter').textContent = listenerMhz((frame.startHz + frame.stopHz) / 2);
    $('sweepAxisMax').textContent = listenerMhz(frame.stopHz);
    listenerSweepInfo.textContent = `${simulated ? 'SIMULASI · ' : ''}${listenerMhz(frame.startHz)} – ${listenerMhz(frame.stopHz)} · ${bins.length} titik`;
  }

  function sweepFreqAt(event){
    if (!lastSweepFrame) return null;
    const rect = listenerSweepCanvas.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return Math.round(lastSweepFrame.startHz + ratio * (lastSweepFrame.stopHz - lastSweepFrame.startHz));
  }

  listenerSweepCanvas.addEventListener('mousemove', (e) => {
    const hz = sweepFreqAt(e);
    const hover = $('sweepHover');
    if (hz == null){ hover.hidden = true; return; }
    const rect = listenerSweepCanvas.getBoundingClientRect();
    hover.hidden = false;
    hover.textContent = `${formatMHz(hz)} MHz`;
    hover.style.left = `${clamp(e.clientX - rect.left, 40, rect.width - 40)}px`;
  });
  listenerSweepCanvas.addEventListener('mouseleave', () => { $('sweepHover').hidden = true; });
  // Klik puncak sinyal -> hentikan pindai, lalu dengarkan frekuensi itu di tab Listener.
  listenerSweepCanvas.addEventListener('click', async (e) => {
    const hz = sweepFreqAt(e);
    if (hz == null || !listenerClient) return;
    if (listenerClient.status?.busy === 'sweep'){
      reportListener('hentikan pindai', await listenerClient.sweepStop({ resumeRx: true }));
    }
    commitFreqDisplay(hz, 'klik hasil pindai');
    showRadioTab('listener');
  });

  function onListenerMarkers(list){
    if (!list.markers.length){
      const li = document.createElement('li');
      li.className = 'listener-empty';
      li.textContent = list.setName ? `Belum ada marker di ${list.setName}.` : 'Belum ada marker.';
      listenerMarkersEl.replaceChildren(li);
      return;
    }
    listenerMarkersEl.replaceChildren(...list.markers.map((marker) => {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = `${marker.label} · ${listenerMhz(marker.frequencyHz)}${marker.powerDb != null ? ` · ${marker.powerDb.toFixed(1)} dB` : ''}`;
      li.appendChild(text);
      if (marker.id){
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-ghost btn-sm';
        remove.dataset.markerId = marker.id;
        remove.textContent = 'Hapus';
        li.appendChild(remove);
      }
      return li;
    }));
  }

  /* ---- Audio kit -> backend (POST /webusb/audio) untuk Rekam & Translate ---- */
  function onListenerAudio(chunk){
    if (!webusbForwarding) return;
    const samples = chunk.samples;
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++){
      const v = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = v < 0 ? v * 32768 : v * 32767;
    }
    webusbSampleRate = chunk.sampleRateHz || webusbSampleRate;
    if (chunk.gap) webusbGap = true;
    webusbPending.push(pcm);
    webusbPendingSamples += pcm.length;
    // Backend tertinggal: buang yang paling lama, jangan menumpuk delay.
    while (webusbPendingSamples > WEBUSB_MAX_BACKLOG_SAMPLES && webusbPending.length > 1){
      webusbPendingSamples -= webusbPending.shift().length;
      webusbGap = true;
    }
    if (webusbPendingSamples >= WEBUSB_FLUSH_SAMPLES) flushWebusbAudio();
  }

  async function flushWebusbAudio(){
    if (webusbPostInFlight || !webusbPendingSamples) return;
    webusbPostInFlight = true;
    const body = new Int16Array(webusbPendingSamples);
    let offset = 0;
    for (const part of webusbPending){ body.set(part, offset); offset += part.length; }
    webusbPending = [];
    webusbPendingSamples = 0;
    const squelch = listenerClient?.status?.squelchOpen ? 1 : 0;
    const gap = webusbGap ? 1 : 0;
    webusbGap = false;
    try{
      const res = await fetch(`${API_BASE}/webusb/audio?sr=${webusbSampleRate}&sq=${squelch}&gap=${gap}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: body.buffer,
      });
      if (res.ok) webusbPostedOk++;
    } catch(err){
      // Diamkan: backend yang terputus terlihat di hasil /record-radio.
    } finally {
      webusbPostInFlight = false;
      if (webusbForwarding && webusbPendingSamples >= WEBUSB_FLUSH_SAMPLES) flushWebusbAudio();
    }
  }

  // Dipanggil recordRadioCycle() sebelum POST /record-radio. false = jangan mulai rekam.
  async function startWebusbForwarding(){
    const status = listenerClient?.status;
    if (!status || !status.running){
      log('Radio V2: RX belum berjalan. Buka Set Radio, pilih sumber "Radio V2 · USB di browser", tekan Mulai RX, lalu rekam lagi.', 'err');
      return false;
    }
    if (status.busy !== 'none'){
      log(`Radio V2: ${LISTENER_CODE_TEXT.SWEEP_BUSY}`, 'err');
      return false;
    }
    // Audio kit hanya berisi VFO yang tidak dibisukan. Klik tombol rekam ini
    // memberi user activation, jadi listen(true) di sini tidak ditahan browser.
    if (status.vfo && !status.vfo.enabled){
      const result = await listenerClient.listen(true);
      if (!result.ok){
        reportListener('dengarkan', result);
        return false;
      }
    }
    if (status.vfo && !status.vfo.squelchEnabled){
      log('Radio V2: squelch VFO mati, jadi noise ikut terekam terus. Aktifkan squelch di panel radio supaya rekaman hanya berisi ucapan.', 'warn');
    }
    webusbForwarding = true;
    webusbPending = [];
    webusbPendingSamples = 0;
    const subscribed = await listenerUpdateSubscription();
    if (!subscribed || !subscribed.ok){
      stopWebusbForwarding();
      return false;
    }
    // Tunggu sampai backend benar-benar menerima audio pertama (~250 ms).
    const before = webusbPostedOk;
    for (let i = 0; i < 30 && webusbPostedOk === before; i++) await new Promise((r) => setTimeout(r, 100));
    if (webusbPostedOk === before){
      log('Radio V2: audio dari panel radio tidak sampai ke backend. Pastikan RX berjalan dan VFO tidak dibisukan.', 'err');
      stopWebusbForwarding();
      return false;
    }
    log('Radio V2: audio VFO diteruskan ke backend selama rekaman.', 'info');
    return true;
  }

  function stopWebusbForwarding(){
    if (!webusbForwarding) return;
    webusbForwarding = false;
    flushWebusbAudio();
    listenerUpdateSubscription();
  }

  /* ============================================================
     TTS PLAYBACK — GET /tts?text=...
     ============================================================ */
  const playTtsBtn = $('playTtsBtn');

  async function playTtsText(text){
    if (!text) return;
    // PERBAIKAN: sebelumnya status pill "Siap" tidak berubah sama sekali
    // selama proses TTS berjalan (request ke backend + generate audio),
    // jadi user tidak tahu aplikasi sedang bekerja. Sekarang pill mengikuti
    // proses ini juga, sama seperti proses translate/upload lainnya.
    statusPill.textContent = 'Membuat Suara TTS…';
    statusPill.classList.add('busy');
    try{
      log('Meminta audio TTS Indonesia dari server…', 'info');
      const url = `${API_BASE}/tts?text=${encodeURIComponent(text)}`;
      // PERBAIKAN (kecepatan pemutaran): sebelumnya di sini kita fetch()
      // lalu menunggu SELURUH berkas audio selesai diunduh dan diubah jadi
      // Blob dulu (await res.blob()) sebelum <audio> bisa mulai memutar --
      // ini menambah jeda ekstra DI ATAS waktu generate TTS di server.
      // Sekarang URL diserahkan langsung ke elemen <audio> lewat
      // playAudioUrl(), supaya browser bisa mulai membuffer & memutar
      // begitu data pertama datang, tanpa menunggu unduhan selesai 100%.
      // Kalau backend gagal (mis. 400/500), event 'error' pada <audio>
      // (sudah dipasang di atas) yang akan melaporkannya ke log.
      playAudioUrl(url, 'Memutar TTS Indonesia…');
    } catch(err){
      log(`Gagal memutar TTS: ${err.message}`, 'err');
    } finally {
      statusPill.textContent = papuaSiapLabel();
      statusPill.classList.remove('busy');
    }
  }

  playTtsBtn.addEventListener('click', () => {
    const text = translationOutput.value.trim();
    if (!text){
      log('Belum ada teks output untuk diucapkan.', 'err');
      return;
    }
    playTtsText(text);
  });

  /* ============================================================
     VIDEO PENGANTAR — tombol play (sebelumnya tidak ada handler-nya
     sama sekali, sehingga klik tidak melakukan apa pun)
     ============================================================ */
  const introVideoEl = $('myCustomVideo');
  const videoPlayBtn = $('videoPlayBtn');
  const videoCaption = $('videoCaption');

  // Panel video (paling besar di Home) disembunyikan selama file videonya belum
  // ada (404), supaya Home tidak dibuka dengan kotak kosong yang tidak bisa diputar.
  if (INTRO_VIDEO_URL){
    const intro = resolveVideoSource(INTRO_VIDEO_URL);
    if (intro.type === 'direct'){
      fetch(intro.directUrl, { method: 'HEAD' }).then((res) => {
        if (!res.ok) document.querySelector('.video-panel').hidden = true;
      }).catch(() => {});
    }
  } else {
    document.querySelector('.video-panel').hidden = true;
  }

  if (introVideoEl && videoPlayBtn){
    // PERBAIKAN: sebelumnya hanya tag <video> yang dipakai, jadi kalau
    // INTRO_VIDEO_URL diisi link YouTube (atau format lain yang tidak bisa
    // didekode langsung oleh browser) video tidak akan pernah start --
    // tanpa pesan error yang jelas. Sekarang sumbernya dideteksi otomatis:
    // link YouTube/Vimeo dipakaikan iframe embed resmi, sedangkan file
    // video langsung (format apa pun yang didukung browser) tetap lewat
    // tag <video> seperti semula. Container & tombol play (UI) tidak diubah.
    let introIframeEl = null;

    function showIntroIframe(embedUrl){
      if (!introIframeEl){
        introIframeEl = document.createElement('iframe');
        introIframeEl.id = 'myCustomVideoEmbed';
        introIframeEl.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
        introIframeEl.setAttribute('allowfullscreen', '');
        introIframeEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;';
        // Ditaruh tepat setelah elemen <video> di container yang sama,
        // supaya tata letak/UI panel video tidak berubah sama sekali.
        introVideoEl.insertAdjacentElement('afterend', introIframeEl);
      }
      introIframeEl.src = embedUrl;
      introIframeEl.style.display = 'block';
      introVideoEl.pause();
      introVideoEl.style.display = 'none';
    }
    function hideIntroIframe(){
      if (introIframeEl){
        introIframeEl.src = ''; // hentikan playback/unduhan saat ditutup
        introIframeEl.style.display = 'none';
      }
    }

    videoPlayBtn.addEventListener('click', () => {
      if (!INTRO_VIDEO_URL){
        log('Video pengantar belum diatur. Isi INTRO_VIDEO_URL di script.js.', 'warn');
        if (videoCaption) videoCaption.textContent = 'Video pengantar belum tersedia.';
        return;
      }

      const source = resolveVideoSource(INTRO_VIDEO_URL);
      videoPlayBtn.style.display = 'none';

      if (source.type === 'embed'){
        showIntroIframe(source.embedUrl);
        log('Memutar video pengantar (embed YouTube/Vimeo).', 'ok');
        return;
      }

      hideIntroIframe();
      introVideoEl.style.display = 'block';
      if (introVideoEl.getAttribute('src') !== source.directUrl){
        introVideoEl.src = source.directUrl;
      }
      introVideoEl.play().catch(err => {
        log(`Gagal memutar video pengantar: ${err.message}`, 'err');
        introVideoEl.style.display = 'none';
        videoPlayBtn.style.display = 'flex';
      });
    });

    introVideoEl.addEventListener('error', () => {
      // PERBAIKAN: sebelumnya kegagalan MEMUAT video (format/codec tidak
      // didukung, path salah, dll) tidak pernah ditangkap sama sekali --
      // video hanya diam, tombol play tidak muncul lagi, tanpa keterangan
      // apa pun. Sekarang error load ditangani eksplisit dan jelas.
      if (!introVideoEl.currentSrc) return; // belum ada src yang dicoba, abaikan
      log('Video pengantar gagal dimuat -- format/sumber mungkin tidak didukung browser.', 'err');
      if (videoCaption) videoCaption.textContent = 'Video pengantar gagal dimuat. Coba format lain (mp4/webm) atau tautan YouTube/Vimeo.';
      introVideoEl.style.display = 'none';
      videoPlayBtn.style.display = 'flex';
    });

    introVideoEl.addEventListener('pause', () => {
      if (introVideoEl.ended) return;
      videoPlayBtn.style.display = 'flex';
    });
    introVideoEl.addEventListener('ended', () => {
      videoPlayBtn.style.display = 'flex';
      introVideoEl.style.display = 'none';
    });
  }

  /* ============================================================
     MODE LIVE — POST /live/start, /live/stop, /live/meta; GET /live/status
     Radio didengar terus; setiap ucapan (satu PTT) langsung ditranskrip &
     diterjemahkan di backend, lalu muncul sebagai kartu di #liveFeed.
     ============================================================ */
  const translateLive = $('translateLive');
  const translateManual = $('translateManual');
  const translateModeHint = $('translateModeHint');
  const liveDeviceSelect = $('liveDeviceSelect');
  const liveLangSelect = $('liveLangSelect');
  const liveToggleBtn = $('liveToggleBtn');
  const liveDot = $('liveDot');
  const liveStateText = $('liveStateText');
  const liveMeterFill = $('liveMeterFill');
  const liveAutoTts = $('liveAutoTts');
  const liveStats = $('liveStats');
  const liveModelPill = $('liveModelPill');
  const liveFeed = $('liveFeed');
  const liveEmpty = $('liveEmpty');
  const TRANSLATE_MODE_KEY = 'translateMode';
  const LIVE_TTS_KEY = 'liveAutoTts';
  const LIVE_POLL_MS = 600;

  let liveRunning = false;
  let liveStopping = false;
  let liveLastId = 0;
  let livePollTimer = null;
  let liveViaWebusb = false;
  let liveMetaSent = '';
  let liveTtsChain = Promise.resolve();

  function showTranslateMode(mode){
    const live = mode !== 'manual';
    document.querySelectorAll('[data-translate-mode]').forEach((btn) => {
      const on = (btn.dataset.translateMode === 'live') === live;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    translateLive.hidden = !live;
    translateManual.hidden = live;
    translateModeHint.textContent = live
      ? 'Radio didengar terus; setiap kali PTT dilepas, ucapan langsung diterjemahkan.'
      : 'Cara lama: rekam satu sesi, unggah berkas, atau ketik teks Papua.';
    try{ localStorage.setItem(TRANSLATE_MODE_KEY, live ? 'live' : 'manual'); } catch(err){ /* abaikan */ }
    fitTranslateLive();
  }
  document.querySelectorAll('[data-translate-mode]').forEach((btn) => {
    btn.addEventListener('click', () => showTranslateMode(btn.dataset.translateMode));
  });

  // Tampilan Live pas satu layar; daftar hasil bergulir di dalam kotaknya.
  function fitTranslateLive(){
    if (pages.pageTranslate.hidden || translateLive.hidden) return;
    fitHeightToWindow(translateLive);
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitTranslateLive));
  $('navTranslateBtn').addEventListener('click', () => requestAnimationFrame(fitTranslateLive));

  // Sumber radio: daftar sama dengan Radio Input Device. Selama belum dipilih
  // sendiri, otomatis mengikuti radio yang sedang tersambung di Set Radio.
  let liveDeviceTouched = false;
  function syncLiveDevices(){
    if (liveRunning) return;
    const keep = liveDeviceSelect.value;
    liveDeviceSelect.innerHTML = deviceSelect.innerHTML;
    const connected = vfoRecordDevice();
    const options = Array.from(liveDeviceSelect.options).map((o) => o.value);
    if (!liveDeviceTouched && connected !== null && options.includes(String(connected))) liveDeviceSelect.value = String(connected);
    else if (keep && options.includes(keep)) liveDeviceSelect.value = keep;
    else liveDeviceSelect.value = deviceSelect.value;
  }
  document.addEventListener('devices-loaded', syncLiveDevices);
  $('navTranslateBtn').addEventListener('click', syncLiveDevices);
  liveDeviceSelect.addEventListener('change', () => { liveDeviceTouched = true; });

  // Bahasa Live = bahasa Auto Translate (satu pilihan, dua tempat).
  liveLangSelect.value = papuaLangSelect.value;
  liveLangSelect.addEventListener('change', () => {
    papuaLangSelect.value = liveLangSelect.value;
    papuaLangSelect.dispatchEvent(new Event('change'));
  });
  papuaLangSelect.addEventListener('change', () => { liveLangSelect.value = papuaLangSelect.value; });

  try{ liveAutoTts.checked = localStorage.getItem(LIVE_TTS_KEY) === '1'; } catch(err){ /* abaikan */ }
  liveAutoTts.addEventListener('change', () => {
    try{ localStorage.setItem(LIVE_TTS_KEY, liveAutoTts.checked ? '1' : '0'); } catch(err){ /* abaikan */ }
  });

  // Terjemahan dibacakan bergantian: berikutnya menunggu yang sebelumnya selesai.
  function liveSpeak(text){
    liveTtsChain = liveTtsChain.then(() => new Promise((resolve) => {
      const done = () => {
        audioPlayer.removeEventListener('ended', done);
        audioPlayer.removeEventListener('error', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 30000);
      audioPlayer.addEventListener('ended', done);
      audioPlayer.addEventListener('error', done);
      playTtsText(text);
    }));
  }

  function liveTime(seconds){
    return new Date(seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function liveNumber(value, digits = 1){
    return Number(value).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function renderLiveItem(item){
    const card = document.createElement('article');
    card.className = 'live-card' + (item.error ? ' is-error' : '');
    const head = document.createElement('div');
    head.className = 'live-card-head';
    const parts = [liveTime(item.at)];
    if (item.freq_hz) parts.push(`${formatMHzShort(item.freq_hz)} MHz`);
    if (item.mode) parts.push(item.mode);
    if (item.duration_sec) parts.push(`${liveNumber(item.duration_sec)} dtk`);
    if (item.latency_sec != null) parts.push(`selesai ${liveNumber(item.latency_sec)} dtk setelah PTT`);
    const meta = document.createElement('span');
    meta.className = 'live-card-meta';
    meta.textContent = parts.join(' · ');
    head.appendChild(meta);

    if (!item.error){
      const actions = document.createElement('span');
      actions.className = 'live-card-actions';
      if (item.record_id){
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'btn btn-ghost btn-sm';
        playBtn.textContent = 'Putar suara';
        playBtn.addEventListener('click', () => playAudioUrl(`${API_BASE}/records/${item.record_id}/audio`, 'Memutar ucapan radio…'));
        actions.appendChild(playBtn);
      }
      if (item.text_indonesia){
        const ttsBtn = document.createElement('button');
        ttsBtn.type = 'button';
        ttsBtn.className = 'btn btn-ghost btn-sm';
        ttsBtn.textContent = 'Bacakan';
        ttsBtn.addEventListener('click', () => playTtsText(item.text_indonesia));
        actions.appendChild(ttsBtn);
      }
      head.appendChild(actions);
    }
    card.appendChild(head);

    if (item.error){
      const err = document.createElement('p');
      err.className = 'live-card-error';
      err.textContent = item.error;
      card.appendChild(err);
    } else {
      const indo = document.createElement('p');
      indo.className = 'live-card-id';
      indo.textContent = item.text_indonesia || (item.text_papua ? '(terjemahan kosong)' : '(tidak ada ucapan yang dikenali)');
      const papua = document.createElement('p');
      papua.className = 'live-card-papua';
      papua.textContent = item.text_papua || '';
      card.append(indo, papua);
    }
    liveEmpty.hidden = true;
    liveFeed.insertBefore(card, liveEmpty.nextSibling);  // terbaru paling atas
    while (liveFeed.querySelectorAll('.live-card').length > 200) liveFeed.lastElementChild.remove();
  }

  function setLiveButton(){
    liveToggleBtn.disabled = liveStopping;
    liveToggleBtn.classList.toggle('is-running', liveRunning);
    liveToggleBtn.innerHTML = liveRunning
      ? `${pauseIcon()}${liveStopping ? 'Menghentikan…' : 'Hentikan Live'}`
      : `${playIcon()}Mulai Live`;
    liveDeviceSelect.disabled = liveRunning;
  }

  function renderLiveStatus(data){
    const models = data.models || {};
    const modelText = models.no_model ? 'Tanpa model AI (teks penanda)'
      : models.state === 'ready' ? `Model siap · ${String(models.device || '').toUpperCase() || 'CPU'}`
      : models.state === 'loading' ? 'Memuat model…'
      : models.state === 'error' ? 'Model gagal dimuat'
      : 'Model dimuat saat dibutuhkan';
    liveModelPill.textContent = modelText;
    liveModelPill.title = models.error || '';
    liveModelPill.classList.toggle('busy', models.state === 'loading');

    let state = 'idle';
    let text = data.error ? `Berhenti: ${data.error}` : 'Belum berjalan';
    if (data.running){
      if (data.stopping){ state = 'busy'; text = `Menyelesaikan ${data.queue + (data.processing ? 1 : 0)} ucapan terakhir…`; }
      else if (data.phase === 'recording'){ state = 'recording'; text = 'Merekam ucapan…'; }
      else if (data.processing){ state = 'busy'; text = data.queue ? `Menerjemahkan (${data.queue} menunggu)…` : 'Menerjemahkan…'; }
      else { state = 'listening'; text = 'Mendengarkan · menunggu PTT'; }
    }
    liveDot.dataset.state = state;
    liveStateText.textContent = text;
    const level = data.running ? clamp((Number(data.rms) / 1.2e-4) * 100, 0, 100) : 0;
    liveMeterFill.style.width = Math.max(level, 2) + '%';

    const st = data.stats || {};
    liveStats.textContent = data.started_at
      ? `${st.done || 0} diterjemahkan dari ${st.heard || 0} ucapan` +
        (st.last_latency_sec != null ? ` · terakhir ${liveNumber(st.last_latency_sec)} dtk` : '')
      : '';
  }

  async function pollLive(){
    try{
      const res = await fetch(`${API_BASE}/live/status?after=${liveLastId}`);
      const data = await safeJson(res);
      if (!data.ok) return;
      for (const item of data.items){
        liveLastId = Math.max(liveLastId, item.id);
        renderLiveItem(item);
        if (!item.error && item.record_id) recordsChanged();
        if (!item.error && item.text_indonesia && liveAutoTts.checked) liveSpeak(item.text_indonesia);
      }
      const wasRunning = liveRunning;
      liveRunning = !!data.running;
      liveStopping = !!data.stopping;
      renderLiveStatus(data);
      setLiveButton();
      if (liveRunning){
        // Frekuensi/mode terbaru dari Set Radio untuk ucapan berikutnya.
        const meta = JSON.stringify(recordMetaForDevice(liveDeviceSelect.value));
        if (meta !== liveMetaSent){
          liveMetaSent = meta;
          fetch(`${API_BASE}/live/meta`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: JSON.parse(meta) }),
          }).catch(() => {});
        }
      }
      if (wasRunning && !liveRunning){
        if (liveViaWebusb){ stopWebusbForwarding(); liveViaWebusb = false; }
        log(data.error ? `Live berhenti: ${data.error}` : 'Live dihentikan.', data.error ? 'err' : 'warn');
      }
    } catch(err){
      /* backend sibuk/terputus: coba lagi di putaran berikutnya */
    } finally {
      clearTimeout(livePollTimer);
      livePollTimer = setTimeout(pollLive, liveRunning ? LIVE_POLL_MS : 3000);
    }
  }

  async function startLive(){
    const deviceIndex = liveDeviceSelect.value;
    if (deviceIndex === '' || isNaN(Number(deviceIndex))){
      log('Pilih sumber radio untuk Mode Live.', 'err');
      return;
    }
    liveToggleBtn.disabled = true;
    // Radio V2 di browser: audio kit diteruskan ke backend selama Live berjalan.
    liveViaWebusb = deviceIndex === WEBUSB_DEVICE_INDEX;
    if (liveViaWebusb && !(await startWebusbForwarding())){
      liveViaWebusb = false;
      liveToggleBtn.disabled = false;
      return;
    }
    const meta = recordMetaForDevice(deviceIndex);
    liveMetaSent = JSON.stringify(meta);
    try{
      const res = await fetch(`${API_BASE}/live/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_index: Number(deviceIndex), lang: selectedPapuaLang, rms_threshold: 2.0e-5, meta }),
      });
      const data = await safeJson(res);
      if (!data.ok){
        log(`Live: ${data.error || 'gagal memulai.'}`, 'err');
        liveStateText.textContent = data.error || 'Gagal memulai';
        if (liveViaWebusb){ stopWebusbForwarding(); liveViaWebusb = false; }
        return;
      }
      logLangWarningIfAny(data);
      liveRunning = true;
      liveStopping = false;
      log(`Live dimulai: ${data.info?.source || 'radio'} (bahasa ${liveLangSelect.options[liveLangSelect.selectedIndex].textContent}).`, 'ok');
    } catch(err){
      log(`Gagal menghubungi backend untuk Live: ${err.message}`, 'err');
      if (liveViaWebusb){ stopWebusbForwarding(); liveViaWebusb = false; }
    } finally {
      setLiveButton();
      pollLive();
    }
  }

  async function stopLive(){
    liveStopping = true;
    setLiveButton();
    try{ await fetch(`${API_BASE}/live/stop`, { method: 'POST' }); }
    catch(err){ log(`Gagal menghentikan Live: ${err.message}`, 'err'); }
    pollLive();
  }

  liveToggleBtn.addEventListener('click', () => (liveRunning ? stopLive() : startLive()));
  $('liveClearBtn').addEventListener('click', () => {
    liveFeed.querySelectorAll('.live-card').forEach((card) => card.remove());
    liveEmpty.hidden = false;
  });

  try{ showTranslateMode(localStorage.getItem(TRANSLATE_MODE_KEY) === 'manual' ? 'manual' : 'live'); }
  catch(err){ showTranslateMode('live'); }
  setLiveButton();
  pollLive();  // juga menyambung lagi ke sesi Live yang masih berjalan setelah halaman dimuat ulang

  /* ============================================================
     INIT
     ============================================================ */
  drawFreqRuler(0, 0, false);
  setSliderFill(freqSlider);
  setSliderFill(bwSlider);
  if (zoomSlider) setSliderFill(zoomSlider);
  if (contrastSlider) setSliderFill(contrastSlider);
  if (volumeSlider) setSliderFill(volumeSlider);
  applyRemoteFreq(currentFreq);
  applyRemoteBw(currentBw);
  showPage('pageHome');
  setRtltcpStatus(false, 'Belum tersambung');

  log('Menghubungkan ke backend…', 'info');

  /* ============================================================
     REKAMAN — database rekaman VFO (records_db.py, /records)
     Setiap Rekam VFO / Rekam & Simpan / Rekam & Translate tersimpan
     otomatis dengan info radio, teks Papua & terjemahan.
     ============================================================ */
  const RECORDS_PAGE_SIZE = 50;
  const recordsBody = $('recordsBody');
  const recordsSearch = $('recordsSearch');
  const recordsLang = $('recordsLang');
  const recordsKind = $('recordsKind');
  const recordsCount = $('recordsCount');
  const recordsEmpty = $('recordsEmpty');
  const recordsPrevBtn = $('recordsPrevBtn');
  const recordsNextBtn = $('recordsNextBtn');
  const recDetailAudio = $('recDetailAudio');
  const recDetailNote = $('recDetailNote');
  const LANG_LABEL = { ambai: 'Ambai', biak: 'Biak' };
  let recordsOffset = 0;
  let recordsTotal = 0;
  let recordsSelected = null;
  let recordsSearchTimer = null;

  function recordTime(iso){
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || '—';
    const pad = (v) => String(v).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function recordDuration(sec){
    const total = Math.round(Number(sec) || 0);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function recordSummary(item){
    if (item.text_indonesia) return item.text_indonesia;
    if (item.text_papua) return item.text_papua;
    return item.kind === 'simpan' ? '(rekaman saja, belum diterjemahkan)' : '(tidak ada teks)';
  }

  // Dipanggil setelah rekaman baru tersimpan: muat ulang bila halaman Rekaman terbuka.
  function recordsChanged(){
    if (!pages.pageRecords.hidden) loadRecords();
  }

  async function loadRecords(){
    const params = new URLSearchParams({
      q: recordsSearch.value.trim(),
      lang: recordsLang.value,
      kind: recordsKind.value,
      limit: String(RECORDS_PAGE_SIZE),
      offset: String(recordsOffset),
    });
    try{
      const data = await safeJson(await fetch(`${API_BASE}/records?${params}`));
      if (!data.ok) throw new Error(data.error || 'gagal');
      recordsTotal = data.total;
      recordsBody.replaceChildren(...data.items.map((item) => {
        const tr = document.createElement('tr');
        tr.dataset.recordId = String(item.id);
        tr.tabIndex = 0;
        tr.classList.toggle('is-selected', recordsSelected === item.id);
        const cells = [
          recordTime(item.created_at),
          item.source || '—',
          item.freq_hz ? `${formatMHz(item.freq_hz)}` : '—',
          item.mode || '—',
          recordDuration(item.duration_sec),
          LANG_LABEL[item.lang] || item.lang || '—',
          recordSummary(item),
        ];
        cells.forEach((text, i) => {
          const td = document.createElement('td');
          td.textContent = text;
          if (i === 6) td.className = 'records-summary';
          tr.appendChild(td);
        });
        return tr;
      }));
      recordsEmpty.hidden = data.items.length > 0;
      const from = data.total ? recordsOffset + 1 : 0;
      const to = recordsOffset + data.items.length;
      recordsCount.textContent = `${from}–${to} dari ${data.total} rekaman`;
      recordsPrevBtn.disabled = recordsOffset === 0;
      recordsNextBtn.disabled = to >= data.total;
    } catch(err){
      log(`Gagal memuat daftar rekaman: ${err.message}`, 'err');
    }
  }

  async function showRecord(id){
    try{
      const data = await safeJson(await fetch(`${API_BASE}/records/${id}`));
      if (!data.ok) throw new Error(data.error || 'tidak ditemukan');
      const item = data.item;
      recordsSelected = item.id;
      recordsBody.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('is-selected', Number(tr.dataset.recordId) === item.id));
      $('recordsDetailEmpty').hidden = true;
      $('recordsDetailBody').hidden = false;
      $('recDetailId').textContent = `#${item.id}`;
      const rows = [
        ['Waktu', recordTime(item.created_at)],
        ['Sumber', item.source || '—'],
        ['Frekuensi', item.freq_hz ? `${formatMHz(item.freq_hz)} MHz` : '—'],
        ['Mode', `${item.mode || '—'}${item.bandwidth_hz ? ` · ${(item.bandwidth_hz / 1000).toFixed(1)} kHz` : ''}`],
        ['Durasi', `${recordDuration(item.duration_sec)} (${item.segments || 1} ucapan)`],
        ['Bahasa', LANG_LABEL[item.lang] || item.lang || '—'],
      ];
      $('recDetailMeta').replaceChildren(...rows.flatMap(([key, value]) => {
        const dt = document.createElement('dt'); dt.textContent = key;
        const dd = document.createElement('dd'); dd.textContent = value;
        return [dt, dd];
      }));
      $('recDetailPapua').textContent = item.text_papua || '—';
      $('recDetailIndonesia').textContent = item.text_indonesia || '—';
      recDetailNote.value = item.note || '';
      recDetailAudio.hidden = !item.has_audio;
      if (item.has_audio){
        recDetailAudio.src = `${API_BASE}/records/${item.id}/audio`;
        $('recDetailDownload').href = `${API_BASE}/records/${item.id}/audio?download=1`;
      } else {
        recDetailAudio.removeAttribute('src');
      }
      $('recDetailDownload').hidden = !item.has_audio;
    } catch(err){
      log(`Gagal membuka rekaman: ${err.message}`, 'err');
    }
  }

  recordsBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-record-id]');
    if (tr) showRecord(Number(tr.dataset.recordId));
  });
  recordsBody.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-record-id]');
    if (tr && (e.key === 'Enter' || e.key === ' ')){
      e.preventDefault();
      showRecord(Number(tr.dataset.recordId));
    }
  });
  recordsSearch.addEventListener('input', () => {
    clearTimeout(recordsSearchTimer);
    recordsSearchTimer = setTimeout(() => { recordsOffset = 0; loadRecords(); }, 300);
  });
  [recordsLang, recordsKind].forEach((el) => el.addEventListener('change', () => { recordsOffset = 0; loadRecords(); }));
  $('recordsRefreshBtn').addEventListener('click', loadRecords);
  recordsPrevBtn.addEventListener('click', () => { recordsOffset = Math.max(0, recordsOffset - RECORDS_PAGE_SIZE); loadRecords(); });
  recordsNextBtn.addEventListener('click', () => { recordsOffset += RECORDS_PAGE_SIZE; loadRecords(); });

  $('recDetailSaveNote').addEventListener('click', async () => {
    if (recordsSelected == null) return;
    try{
      const res = await fetch(`${API_BASE}/records/${recordsSelected}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: recDetailNote.value }),
      });
      const data = await safeJson(res);
      if (!data.ok) throw new Error(data.error || 'gagal');
      log(`Catatan rekaman #${recordsSelected} disimpan.`, 'ok');
      loadRecords();
    } catch(err){
      log(`Gagal menyimpan catatan: ${err.message}`, 'err');
    }
  });

  $('recDetailDelete').addEventListener('click', async () => {
    if (recordsSelected == null) return;
    if (!window.confirm(`Hapus rekaman #${recordsSelected} beserta file audionya? Tindakan ini tidak bisa dibatalkan.`)) return;
    try{
      const data = await safeJson(await fetch(`${API_BASE}/records/${recordsSelected}`, { method: 'DELETE' }));
      if (!data.ok) throw new Error(data.error || 'gagal');
      log(`Rekaman #${recordsSelected} dihapus.`, 'warn');
      recordsSelected = null;
      recDetailAudio.pause();
      $('recordsDetailBody').hidden = true;
      $('recordsDetailEmpty').hidden = false;
      loadRecords();
    } catch(err){
      log(`Gagal menghapus rekaman: ${err.message}`, 'err');
    }
  });

  /* ============================================================
     APLIKASI (launcher/installer): tombol "Tutup Aplikasi" dan wizard
     "Model AI". Keduanya hanya tampil bila GET /app/info menjawab
     (dijalankan lewat radio_launcher.py); dijalankan langsung lewat
     python app_faster_whisper_lokal.py, semua ini diam.
     ============================================================ */
  const appQuitBtn = $('appQuitBtn');
  const appSetupBtn = $('appSetupBtn');

  async function quitApp(){
    try{
      const res = await fetch(`${API_BASE}/app/shutdown`, { method: 'POST' });
      const data = await safeJson(res);
      if (!data.ok){
        log(`Gagal menutup aplikasi: ${data.error}`, 'err');
        return;
      }
      document.body.innerHTML = '<p style="font:16px sans-serif;color:#eafcfc;padding:40px">Radio Translate Papua sudah ditutup. Jendela ini boleh ditutup.</p>';
    } catch(err){
      log(`Gagal menutup aplikasi: ${err.message}`, 'err');
    }
  }

  fetch(`${API_BASE}/app/info`).then(safeJson).then((info) => {
    if (!info || !info.managed) return;
    appQuitBtn.hidden = false;
    appSetupBtn.hidden = false;
    appVersion = info.version;
    setUpdateButton('idle');
    log(`Radio Translate Papua v${info.version}. Folder data: ${info.data_dir} (model AI di ${info.model_dir}).`, 'info');
    openSetupIfNeeded();
    checkForUpdate(false);
  }).catch(() => { /* dijalankan langsung tanpa launcher */ });

  /* ---- Update dari GitHub Releases (updater.py) ----
     Tombol di header selalu ada: "Cek update" mengecek rilis terbaru saat
     diklik (juga dicek sekali otomatis saat halaman dibuka). Bila ada versi
     baru, tombol menjadi "Update ke vX" dan klik berikutnya memasangnya.
     Tanpa git pun bisa: rilis diunduh sebagai ZIP dari GitHub. Update dipakai
     setelah aplikasi dibuka ulang lewat script Jalankan-*. */
  const appUpdateBtn = $('appUpdateBtn');
  let appVersion = '';
  let pendingUpdate = null;
  let installedUpdate = null;
  let updateFeedbackTimer = null;

  function setUpdateButton(state, text){
    clearTimeout(updateFeedbackTimer);
    appUpdateBtn.hidden = false;
    appUpdateBtn.disabled = state === 'busy';
    appUpdateBtn.classList.toggle('is-available', state === 'available' || state === 'installed');
    const labels = {
      idle: 'Cek update',
      available: pendingUpdate ? `Update ke v${pendingUpdate.latest.version}` : 'Update',
      installed: installedUpdate ? `v${installedUpdate} siap — buka ulang` : 'Buka ulang',
      busy: text || 'Memeriksa…',
    };
    appUpdateBtn.textContent = text || labels[state];
    appUpdateBtn.title = appVersion ? `Versi terpasang: v${appVersion}` : '';
  }

  // Pesan singkat di tombol, lalu kembali ke "Cek update".
  function flashUpdateButton(text){
    setUpdateButton('idle', text);
    updateFeedbackTimer = setTimeout(() => setUpdateButton('idle'), 4000);
  }

  async function checkForUpdate(manual){
    if (manual) setUpdateButton('busy', 'Memeriksa…');
    try{
      const status = await safeJson(await fetch(`${API_BASE}/app/update/status${manual ? '?force=1' : ''}`));
      if (status.installed){
        installedUpdate = status.installed;
        setUpdateButton('installed');
        return null;
      }
      if (status.update_available){
        pendingUpdate = status;
        setUpdateButton('available');
        log(`Update tersedia: v${status.current} → v${status.latest.version} (${status.latest.html_url}).`, 'info');
        return status;
      }
      if (!manual){
        setUpdateButton('idle');
      } else if (status.error){
        flashUpdateButton('Gagal cek update');
        log(`Cek update gagal: ${status.error}`, 'err');
        window.alert(`Gagal mengecek update.\n${status.error}`);
      } else {
        flashUpdateButton(`Sudah versi terbaru (v${status.current})`);
        log(`Cek update: sudah versi terbaru (v${status.current}).`, 'ok');
      }
    } catch(err){
      if (manual){
        flashUpdateButton('Gagal cek update');
        window.alert(`Gagal mengecek update: ${err.message}`);
      }
    }
    return null;
  }

  async function installUpdate(){
    const latest = pendingUpdate.latest;
    const notes = latest.notes ? `\n\n${latest.notes.slice(0, 600)}` : '';
    const how = pendingUpdate.mode === 'installer'
      ? 'Versi installer: halaman unduhan rilis akan dibuka.'
      : 'File kode diganti (model AI, rekaman & setelan tidak disentuh; file lama di-backup).';
    if (!window.confirm(`Pasang update v${pendingUpdate.current} → v${latest.version}?\n${how}${notes}`)) return;
    if (pendingUpdate.mode === 'installer'){
      window.open(latest.html_url, '_blank', 'noopener');
      return;
    }
    setUpdateButton('busy', 'Memasang update…');
    try{
      const data = await safeJson(await fetch(`${API_BASE}/app/update/apply`, { method: 'POST' }));
      if (!data.ok) throw new Error(data.error || 'gagal');
      pendingUpdate = null;
      installedUpdate = data.version;
      setUpdateButton('installed');
      log(`Update v${data.version} terpasang${data.written ? ` (${data.written.length} file diganti, backup di ${data.backup})` : ''}. Tutup aplikasi lalu buka lagi.`, 'ok');
      if (window.confirm(`Update v${data.version} terpasang. Tutup aplikasi sekarang? Lalu buka lagi lewat Jalankan-Windows.bat / Jalankan-macOS.command.`)) quitApp();
    } catch(err){
      setUpdateButton('available');
      log(`Update gagal: ${err.message}`, 'err');
      window.alert(`Update gagal: ${err.message}`);
    }
  }

  appUpdateBtn.addEventListener('click', async () => {
    if (installedUpdate){
      if (window.confirm('Update sudah terpasang. Tutup aplikasi sekarang? Lalu buka lagi lewat Jalankan-Windows.bat / Jalankan-macOS.command.')) quitApp();
      return;
    }
    if (pendingUpdate || await checkForUpdate(true)) installUpdate();
  });
  appQuitBtn.addEventListener('click', () => {
    if (window.confirm('Tutup Radio Translate Papua? Radio dan rekaman yang sedang berjalan akan dihentikan.')) quitApp();
  });

  /* ---- Wizard Model AI ----
     Muncul saat aplikasi dibuka bila belum pernah diatur, atau bila AI dipilih
     tapi ada file/paket yang kurang. "Lewati sementara" berlaku untuk sesi ini.
     Pilihan disimpan backend di radio-translate.env dan dipakai saat aplikasi
     dibuka ulang (paket AI dipasang oleh script Jalankan-*). */
  const setupWizard = $('setupWizard');
  const setupStepChoose = $('setupStepChoose');
  const setupStepModels = $('setupStepModels');
  const setupModelsIntro = $('setupModelsIntro');
  const setupModelDir = $('setupModelDir');
  const setupPickBtn = $('setupPickBtn');
  const setupCheckBtn = $('setupCheckBtn');
  const setupReport = $('setupReport');
  const setupPackagesNote = $('setupPackagesNote');
  const setupResult = $('setupResult');
  const setupBackBtn = $('setupBackBtn');
  const setupSkipBtn = $('setupSkipBtn');
  const setupSaveBtn = $('setupSaveBtn');
  const setupQuitBtn = $('setupQuitBtn');
  const SETUP_SKIP_KEY = 'setupSkipped';
  const SETUP_DEFAULT_INTRO = setupModelsIntro.textContent.trim();
  const SETUP_NEXT_TEXT = {
    none: 'Tersimpan. Setelan sudah dipakai.',
    reopen: 'Tersimpan. Tutup aplikasi lalu buka lagi supaya setelan baru dipakai.',
    'rerun-script': 'Tersimpan. Tutup aplikasi, lalu jalankan lagi Jalankan-Windows.bat (Windows) atau Jalankan-macOS.command (Mac). Paket AI (±3 GB) dipasang otomatis sekali; butuh internet dan beberapa menit.',
    'installer-ai': 'Tersimpan, tapi versi aplikasi ini belum membawa paket AI. Pasang versi aplikasi dengan AI, lalu buka lagi.',
  };
  let setupStatus = null;

  function setupShow(step){
    setupWizard.hidden = false;
    setupStepChoose.hidden = step !== 'choose';
    setupStepModels.hidden = step !== 'models';
    setupResult.hidden = step !== 'result';
    setupBackBtn.hidden = step !== 'models';
    setupSaveBtn.hidden = step !== 'models';
    setupQuitBtn.hidden = true;
    setupSkipBtn.hidden = false;
    setupSkipBtn.textContent = step === 'result' ? 'Nanti saja' : 'Lewati sementara';
  }

  function setupClose(){
    setupWizard.hidden = true;
  }

  function setupItemRow(item){
    const row = document.createElement('div');
    row.className = `setup-item ${item.ok ? 'is-ok' : 'is-missing'}`;
    const head = document.createElement('div');
    head.className = 'setup-item-head';
    const mark = document.createElement('span');
    mark.className = 'setup-mark';
    mark.textContent = item.ok ? '✓' : '✗';
    const label = document.createElement('span');
    label.textContent = item.label;
    const folder = document.createElement('code');
    folder.textContent = item.folder;
    head.append(mark, label, folder);
    row.appendChild(head);
    const notes = [];
    if (item.missing.length) notes.push(['setup-missing', `Kurang: ${item.missing.join(', ')}`]);
    if (item.missing_optional.length) notes.push(['setup-optional', `Tidak ada (opsional): ${item.missing_optional.join(', ')}`]);
    if (item.hint) notes.push(['setup-hint', item.hint]);
    for (const [cls, text] of notes){
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = text;
      row.appendChild(p);
    }
    return row;
  }

  function renderSetupCheck(check){
    const cards = Object.entries(check.languages).map(([lang, info]) => {
      const card = document.createElement('div');
      card.className = `setup-lang ${info.ok ? 'is-ok' : 'is-missing'}`;
      const title = document.createElement('div');
      title.className = 'setup-lang-title';
      const name = document.createElement('b');
      name.textContent = info.title;
      const badge = document.createElement('span');
      badge.className = 'setup-badge';
      badge.textContent = lang === 'ambai' ? 'wajib' : 'opsional';
      const state = document.createElement('span');
      state.className = 'setup-lang-state';
      state.textContent = info.ok ? 'Lengkap' : 'Belum lengkap';
      title.append(name, badge, state);
      card.appendChild(title);
      info.items.forEach((item) => card.appendChild(setupItemRow(item)));
      return card;
    });
    if (!check.exists){
      const p = document.createElement('p');
      p.className = 'setup-missing';
      p.textContent = `Folder ${check.model_dir} tidak ditemukan.`;
      cards.unshift(p);
    }
    setupReport.replaceChildren(...cards);
    setupModelDir.value = check.model_dir;
    setupSaveBtn.disabled = !check.ready;
    setupSaveBtn.textContent = check.ready ? 'Simpan' : 'Lengkapi model Ambai dulu';
  }

  async function loadSetupStatus(){
    const res = await fetch(`${API_BASE}/app/setup/status`);
    setupStatus = await safeJson(res);
    return setupStatus;
  }

  async function openSetup(step, intro){
    const status = setupStatus || await loadSetupStatus();
    setupModelsIntro.textContent = intro || SETUP_DEFAULT_INTRO;
    setupPickBtn.hidden = !status.picker;
    setupPackagesNote.hidden = status.ai_packages;
    setupPackagesNote.textContent = status.frozen
      ? 'Versi aplikasi ini belum membawa paket AI; model bisa diatur sekarang dan dipakai di versi dengan AI.'
      : 'Paket AI (±3 GB) belum terpasang. Setelah disimpan, tutup aplikasi lalu jalankan lagi script Jalankan-…; paket AI dipasang otomatis sekali (butuh internet).';
    renderSetupCheck(status.check);
    setupShow(step);
  }

  async function openSetupIfNeeded(){
    let skipped = false;
    try{ skipped = sessionStorage.getItem(SETUP_SKIP_KEY) === '1'; } catch(err){ /* diblokir: anggap belum */ }
    try{
      const status = await loadSetupStatus();
      if (!status.setup_done){
        openSetup('choose');
      } else if (status.mode === 'ai' && !skipped && (!status.check.ready || !status.ai_packages)){
        openSetup('models', !status.check.ready
          ? 'Ada file model yang kurang. Lengkapi foldernya (lihat daftar di bawah), atau lewati dulu untuk memakai radio saja.'
          : SETUP_DEFAULT_INTRO);
      }
    } catch(err){
      log(`Gagal membaca setelan Model AI: ${err.message}`, 'warn');
    }
  }

  function setupFinish(next){
    setupResult.textContent = SETUP_NEXT_TEXT[next] || 'Tersimpan.';
    setupShow('result');
    setupStatus = null; // baca ulang saat wizard dibuka lagi
    if (next === 'none'){
      setTimeout(setupClose, 1500);
    } else {
      setupQuitBtn.hidden = false;
    }
  }

  async function setupSave(payload){
    setupSaveBtn.disabled = true;
    try{
      const res = await fetch(`${API_BASE}/app/setup/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!data.ok){
        log(`Model AI: ${data.error}`, 'warn');
        if (data.check){
          renderSetupCheck(data.check); // mengatur ulang tombol Simpan sesuai hasil cek
          return;
        }
      } else {
        log(payload.mode === 'ai' ? `Model AI disimpan (folder ${data.check.model_dir}).` : 'Mode "hanya radio" disimpan.', 'ok');
        setupFinish(data.next);
      }
    } catch(err){
      log(`Gagal menyimpan setelan Model AI: ${err.message}`, 'err');
    }
    setupSaveBtn.disabled = false;
  }

  async function setupCheckPath(){
    const path = setupModelDir.value.trim();
    if (!path){ setupModelDir.focus(); return; }
    try{
      const res = await fetch(`${API_BASE}/app/setup/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await safeJson(res);
      if (data.ok) renderSetupCheck(data.check);
      else log(`Model AI: ${data.error}`, 'warn');
    } catch(err){
      log(`Gagal memeriksa folder model: ${err.message}`, 'err');
    }
  }

  appSetupBtn.addEventListener('click', async () => {
    setupStatus = null;
    const status = await loadSetupStatus().catch(() => null);
    if (status) openSetup(status.mode === 'ai' ? 'models' : 'choose');
  });
  $('setupChooseAi').addEventListener('click', () => openSetup('models'));
  $('setupChooseRadio').addEventListener('click', () => setupSave({ mode: 'radio' }));
  setupBackBtn.addEventListener('click', () => setupShow('choose'));
  setupCheckBtn.addEventListener('click', setupCheckPath);
  setupModelDir.addEventListener('keydown', (e) => { if (e.key === 'Enter') setupCheckPath(); });
  setupSaveBtn.addEventListener('click', () => setupSave({ mode: 'ai', path: setupModelDir.value.trim() }));
  setupQuitBtn.addEventListener('click', quitApp);
  setupPickBtn.addEventListener('click', async () => {
    const label = setupPickBtn.textContent;
    setupPickBtn.disabled = true;
    setupPickBtn.textContent = 'Menunggu dialog…';
    log('Model AI: dialog pilih folder dibuka di komputer ini (bisa muncul di belakang jendela aplikasi).', 'info');
    try{
      const res = await fetch(`${API_BASE}/app/setup/pick-folder`, { method: 'POST' });
      const data = await safeJson(res);
      if (!data.ok) log(`Model AI: ${data.error}`, 'warn');
      else if (data.check) renderSetupCheck(data.check);
    } catch(err){
      log(`Gagal membuka dialog pilih folder: ${err.message}`, 'err');
    } finally {
      setupPickBtn.disabled = false;
      setupPickBtn.textContent = label;
    }
  });
  function setupSkip(){
    try{ sessionStorage.setItem(SETUP_SKIP_KEY, '1'); } catch(err){ /* abaikan */ }
    setupClose();
    log('Wizard Model AI dilewati untuk sesi ini; buka lagi lewat tombol "Model AI".', 'info');
  }
  setupSkipBtn.addEventListener('click', setupSkip);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !setupWizard.hidden) setupSkip();
  });

  loadDevices();
  startRmsPolling();
  startSdrPolling();

})();