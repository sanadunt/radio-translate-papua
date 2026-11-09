// Filter suara radio untuk monitor di browser (Radio V1 Web-888 dan Radio V2 lewat server).
//
// Rantai Web Audio, urut:
//   input -> high-pass x2 -> low-pass x2 -> peredam noise AI -> perjelas suara
//         -> gerbang noise -> AGC (compressor) -> penguat -> limiter -> volume -> output
//
// - Bandpass 300–3000 Hz: pita suara radio HT/NFM. High-pass ganda (24 dB/oktaf)
//   juga membuang dengung dan nada CTCSS (67–254 Hz); low-pass membuang desis di atas suara.
// - Peredam noise AI (AudioWorklet + WASM, static/vendor/web-noise-suppressor):
//   GTCRN (bawaan) atau Speex (paling ringan). Butuh AudioContext 48 kHz. Diukur
//   pada narasi + desis radio: GTCRN menurunkan noise ~31 dB dengan suara utuh,
//   Speex ~6 dB, RNNoise hampir tidak berefek (karena itu tidak disertakan).
// - Perjelas suara: +5 dB di sekitar 2 kHz (pita "presence" yang paling menentukan
//   kejelasan kata).
// - Gerbang noise: membisukan sela antar-ucapan supaya desis tidak ikut dikuatkan.
// - AGC + penguat: menaikkan suara yang pelan, limiter mencegah pecah.
//
// Hanya untuk yang DIDENGAR. Audio untuk Whisper/rekaman tidak melewati rantai ini:
// beberapa studi 2025–2026 menemukan denoise sebelum Whisper justru menaikkan error.

const VENDOR = '/static/vendor/web-noise-suppressor';

export const FILTER_PRESETS = {
  off:      { bandpass: false, lowHz: 300, highHz: 3000, denoise: 'off',   clarity: false, agc: false, gate: false, boostDb: 0 },
  light:    { bandpass: true,  lowHz: 300, highHz: 3400, denoise: 'off',   clarity: true,  agc: true,  gate: false, boostDb: 6 },
  standard: { bandpass: true,  lowHz: 300, highHz: 3000, denoise: 'gtcrn', clarity: true,  agc: true,  gate: false, boostDb: 6 },
  strong:   { bandpass: true,  lowHz: 350, highHz: 2800, denoise: 'gtcrn', clarity: true,  agc: true,  gate: true,  boostDb: 9 },
};

const DENOISERS = {
  gtcrn:   { module: 'gtcrn',   load: (lib) => lib.loadGtcrn({ url: `${VENDOR}/gtcrn.wasm` }),   Node: (lib) => lib.GtcrnWorkletNode },
  speex:   { module: 'speex',   load: (lib) => lib.loadSpeex({ url: `${VENDOR}/speex.wasm` }),   Node: (lib) => lib.SpeexWorkletNode },
};

let libPromise = null;
function loadLib(){
  if (!libPromise) libPromise = import(`${VENDOR}/index.js`);
  return libPromise;
}

const dbToGain = (db) => Math.pow(10, db / 20);

export class RadioAudioFilter {
  constructor(ctx, settings = {}){
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    const biquad = (type) => {
      const node = ctx.createBiquadFilter();
      node.type = type;
      node.Q.value = 0.707;
      return node;
    };
    this.highpass = [biquad('highpass'), biquad('highpass')];
    this.lowpass = [biquad('lowpass'), biquad('lowpass')];
    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = 2000;
    this.presence.Q.value = 0.9;
    this.presence.gain.value = 5;
    this.compressor = ctx.createDynamicsCompressor();
    Object.entries({ threshold: -40, knee: 12, ratio: 6, attack: 0.005, release: 0.3 })
      .forEach(([key, value]) => { this.compressor[key].value = value; });
    this.boost = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    Object.entries({ threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 })
      .forEach(([key, value]) => { this.limiter[key].value = value; });

    this.denoisers = {};      // kind -> AudioWorkletNode yang sudah dimuat
    this.gate = null;
    this.settings = { ...FILTER_PRESETS.standard, ...settings };
    this.status = { denoise: 'off', error: null };
    this.onStatus = null;
    this.apply({});
  }

  setVolume(volume){
    this.output.gain.setTargetAtTime(Math.max(0, volume), this.ctx.currentTime, 0.02);
  }

  /** Terapkan setelan (sebagian atau penuh). Peredam noise dimuat di background bila perlu. */
  apply(settings){
    this.settings = { ...this.settings, ...settings };
    const s = this.settings;
    this.highpass.forEach((node) => node.frequency.setValueAtTime(s.lowHz, this.ctx.currentTime));
    this.lowpass.forEach((node) => node.frequency.setValueAtTime(Math.min(s.highHz, this.ctx.sampleRate / 2 - 100), this.ctx.currentTime));
    this.boost.gain.setTargetAtTime(dbToGain(s.agc ? s.boostDb : 0), this.ctx.currentTime, 0.05);
    this._rebuild();
    if (s.denoise !== 'off' && !this.denoisers[s.denoise]) this._loadDenoiser(s.denoise);
    if (s.gate && !this.gate) this._loadGate();
  }

  _setStatus(patch){
    this.status = { ...this.status, ...patch };
    if (this.onStatus) this.onStatus(this.status);
  }

  async _loadDenoiser(kind){
    const spec = DENOISERS[kind];
    if (!spec || this.denoisers[kind] === 'loading') return;
    if (this.ctx.sampleRate !== 48000){
      this._setStatus({ denoise: 'error', error: `Peredam noise AI butuh audio 48 kHz (browser memakai ${this.ctx.sampleRate} Hz).` });
      return;
    }
    this.denoisers[kind] = 'loading';
    this._setStatus({ denoise: 'loading', error: null });
    try{
      const lib = await loadLib();
      const [wasmBinary] = await Promise.all([
        spec.load(lib),
        this.ctx.audioWorklet.addModule(`${VENDOR}/${spec.module}/workletProcessor.js`),
      ]);
      const NodeClass = spec.Node(lib);
      this.denoisers[kind] = new NodeClass(this.ctx, { maxChannels: 1, wasmBinary });
      this._rebuild();
    } catch(err){
      delete this.denoisers[kind];
      this._setStatus({ denoise: 'error', error: `Gagal memuat peredam noise: ${err.message || err}` });
    }
  }

  async _loadGate(){
    if (this.gate) return;
    this.gate = 'loading';
    try{
      const lib = await loadLib();
      await this.ctx.audioWorklet.addModule(`${VENDOR}/noiseGate/workletProcessor.js`);
      this.gate = new lib.NoiseGateWorkletNode(this.ctx, { openThreshold: -50, closeThreshold: -58, holdMs: 300, maxChannels: 1 });
      this._rebuild();
    } catch(err){
      this.gate = null;
      this._setStatus({ error: `Gagal memuat gerbang noise: ${err.message || err}` });
    }
  }

  /** Sambung ulang rantai sesuai setelan; node yang belum siap dilewati dulu. */
  _rebuild(){
    const s = this.settings;
    const ready = (node) => node && node !== 'loading';
    const denoiser = s.denoise !== 'off' ? this.denoisers[s.denoise] : null;
    const chain = [this.input];
    if (s.bandpass) chain.push(...this.highpass, ...this.lowpass);
    if (ready(denoiser)) chain.push(denoiser);
    if (s.clarity) chain.push(this.presence);
    if (s.gate && ready(this.gate)) chain.push(this.gate);
    if (s.agc) chain.push(this.compressor, this.boost);
    chain.push(this.limiter, this.output);

    const all = [this.input, ...this.highpass, ...this.lowpass, this.presence, this.compressor, this.boost, this.limiter,
      ...Object.values(this.denoisers).filter(ready), ...(ready(this.gate) ? [this.gate] : [])];
    all.forEach((node) => { try{ node.disconnect(); } catch(err){ /* belum tersambung */ } });
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    this.chainNames = chain.map((node) => node.constructor.name);

    const denoise = s.denoise === 'off' ? 'off' : ready(denoiser) ? 'on' : (this.status.denoise === 'error' ? 'error' : 'loading');
    this._setStatus({ denoise, error: denoise === 'error' ? this.status.error : null });
  }
}
