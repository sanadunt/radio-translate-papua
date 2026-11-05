var T = Object.defineProperty;
var C = (t, e, a) => e in t ? T(t, e, { enumerable: !0, configurable: !0, writable: !0, value: a }) : t[e] = a;
var p = (t, e, a) => C(t, typeof e != "symbol" ? e + "" : e, a);
import W, { DspProcessor as $, set_panic_hook as L, alloc_iq_buffer as Q } from "../hackrf-web/pkg/hackrf_web.js";
const U = (t) => t === 0 ? 1 : Math.sin(t) / t, V = (t, e, a) => {
  let h = 0, c = 1;
  for (let r = 0; r < a.length; r++)
    h += c * a[r] * Math.cos(r * 2 * Math.PI * t / e), c = -c;
  return h;
}, x = (t, e) => V(t, e, [0.355768, 0.487396, 0.144232, 0.012604]), z = (t, e) => 2 * Math.PI * (t / e), N = (t, e) => Math.floor(3.8 * e / t), X = (t, e, a, h = 1) => {
  const c = new Float32Array(t), r = t / 2, o = h * e / Math.PI;
  for (let i = 0; i < t; i++) {
    const u = i - r + 0.5;
    c[i] = U(u * e) * a(u - r, t) * o;
  }
  return c;
}, j = (t, e, a, h = !1) => {
  let c = N(e, a);
  h && c % 2 === 0 && c++;
  const r = z(t, a);
  return X(c, r, (o, i) => x(o, i));
};
function H(t, e) {
  if (t = Math.round(Math.abs(t)), e = Math.round(Math.abs(e)), !Number.isFinite(t) || !Number.isFinite(e))
    return console.error(`[gcd] non-finite input: a=${t}, b=${e} — returning 1`), 1;
  if (t === 0 && e === 0)
    return console.error("[gcd] both inputs are 0 — returning 1"), 1;
  for (; e !== 0; ) {
    const a = e;
    e = t % e, t = a;
  }
  return t;
}
class J {
  constructor(e, a, h) {
    p(this, "interp");
    p(this, "decim");
    p(this, "taps");
    p(this, "phaseCount");
    p(this, "tapsPerPhase");
    p(this, "phases");
    p(this, "bufStartOffset");
    p(this, "buffer");
    p(this, "phase");
    p(this, "offset");
    p(this, "_outBuf");
    this.interp = e, this.decim = a, this.taps = h, this.phaseCount = e, this.tapsPerPhase = Math.floor((h.length + this.phaseCount - 1) / this.phaseCount), this.phases = new Array(this.phaseCount);
    for (let o = 0; o < this.phaseCount; o++)
      this.phases[o] = new Float32Array(this.tapsPerPhase);
    const c = this.phaseCount * this.tapsPerPhase;
    for (let o = 0; o < c; o++) {
      const i = this.phaseCount - 1 - o % this.phaseCount, u = Math.floor(o / this.phaseCount);
      this.phases[i][u] = o < h.length ? h[o] : 0;
    }
    const r = 4096;
    this.bufStartOffset = this.tapsPerPhase - 1, this.buffer = new Float32Array(this.bufStartOffset + r), this.phase = 0, this.offset = 0, this._outBuf = new Float32Array(Math.ceil(r * e / a) + 4);
  }
  process(e, a) {
    const h = this.bufStartOffset + a;
    if (h > this.buffer.length) {
      const o = new Float32Array(h + 1024);
      o.set(this.buffer.subarray(0, this.bufStartOffset)), this.buffer = o;
    }
    this.buffer.set(e.subarray(0, a), this.bufStartOffset);
    const c = Math.ceil(a * this.interp / this.decim) + 4;
    c > this._outBuf.length && (this._outBuf = new Float32Array(c + 64));
    let r = 0;
    for (; this.offset < a; ) {
      let o = 0;
      const i = this.phases[this.phase], u = this.offset;
      for (let l = 0; l < this.tapsPerPhase; l++)
        o += this.buffer[u + l] * i[l];
      this._outBuf[r++] = o, this.phase += this.decim, this.offset += Math.floor(this.phase / this.interp), this.phase = this.phase % this.interp;
    }
    return this.offset -= a, this.buffer.copyWithin(0, a, a + this.bufStartOffset), this._outBuf.subarray(0, r);
  }
}
class K {
  constructor(e, a) {
    p(this, "interp");
    p(this, "decim");
    p(this, "resamp");
    const h = Math.round(e), c = Math.round(a);
    (h <= 0 || c <= 0) && console.error(`[RationalResampler] Invalid sample rates: in=${e} (→${h}), out=${a} (→${c})`);
    const r = H(h, c);
    this.interp = c / r, this.decim = h / r;
    const o = e * this.interp, i = Math.min(e, a) / 2, u = i * 0.1;
    let l = j(i, u, o);
    for (let d = 0; d < l.length; d++) l[d] *= this.interp;
    this.resamp = new J(this.interp, this.decim, l);
  }
  process(e) {
    return this.resamp.process(e, e.length);
  }
}
let F = null, R, f, s, A = 0, k = null;
const Y = {
  nfm: 5e4,
  wfm: 25e4,
  am: 15e3,
  usb: 24e3,
  lsb: 24e3,
  dsb: 24e3,
  cw: 3e3,
  raw: 48e3
}, B = 48e3;
async function Z() {
  F || (F = W().then((t) => {
    R = t, L(), A = Q(131072 * 2), console.log("DSP Worker: Wasm Initialized. IQ Buffer Ptr:", A);
  }).catch((t) => {
    console.error("DSP Worker: Wasm Init Failed:", t);
  })), await F;
}
let E = 2e6;
self.onmessage = async (t) => {
  const e = t.data;
  if (await Z(), e.type === "init")
    E = e.sampleRate, f && f.free(), f = new $(e.sampleRate, 0, e.params.bandwidth || 15e4), s = {
      dcAvg: 0,
      carrierAgcGain: 1,
      deemphPrev: 0,
      agcGain: 1,
      ssbPhase: 0,
      audioResampler: null,
      currentIfRate: 0,
      scratchBuf: new Float32Array(512),
      audioTarget: new Float32Array(2048),
      squelchOpen: !1
    }, k = e.sabs ? e.sabs.map((a) => new Int8Array(a)) : null, v(e.params, e.centerFreq), self.postMessage({ type: "init_done" });
  else if (e.type === "configure")
    v(e.params, e.centerFreq), self.postMessage({ type: "config_done" });
  else if (e.type === "process") {
    if (!f || !s) {
      console.log("DSP Worker: ddc/vfoState unavailable");
      return;
    }
    const a = new Int8Array(R.memory.buffer);
    if (e.useSab && k && e.sabIndex !== void 0)
      a.set(k[e.sabIndex].subarray(0, e.chunkLen), A);
    else if (e.chunk)
      a.set(new Int8Array(e.chunk), A);
    else
      return;
    try {
      const h = performance.now(), c = ee(e.chunkLen, e.params), o = performance.now() - h;
      if (c) {
        const i = c.slice();
        self.postMessage({
          type: "audio",
          samples: i.buffer,
          chunkId: e.chunkId,
          squelchOpen: s.squelchOpen,
          squelchDb: s.squelchDb ?? -120,
          dspTime: o
        }, [i.buffer]);
      } else
        self.postMessage({ type: "audio", samples: null, chunkId: e.chunkId, squelchOpen: s.squelchOpen, squelchDb: s.squelchDb ?? -120, dspTime: o });
    } catch (h) {
      self.postMessage({ type: "error", error: h.message });
    }
  }
};
function v(t, e) {
  const a = Y[t.mode];
  if (a === void 0) {
    console.error(`[DSP Worker] Unknown mode "${t.mode}" — no IF rate defined. Skipping DDC config.`);
    return;
  }
  s.currentIfRate !== a && (s.audioResampler = new K(a, B), s.currentIfRate = a, f.set_if_sample_rate(a));
  const h = (t.freq - e) * 1e6;
  f.set_shift(E, h), f.set_bandwidth(t.bandwidth), f.set_squelch(t.squelchLevel, t.squelchEnabled), t.mode === "wfm" ? f.set_wfm_mode(!0) : f.set_wfm_mode(!1), f.set_audio_filters(t.lowPass || !1, t.highPass || !1);
}
function ee(t, e) {
  const a = e.mode, h = e.bandwidth;
  if (a === "nfm" || a === "wfm") {
    let c;
    try {
      c = f.process_ptr(A, t);
    } catch (l) {
      throw console.error("DEBUG process_ptr crashed:", l), l;
    }
    const r = f.get_output_len();
    let o = !1;
    if (e.squelchEnabled && r > 0 && (o = f.get_output_len() > 0 && new Float32Array(R.memory.buffer, c, r)[Math.floor(r / 2)] === 0), s.squelchOpen = !o, s.squelchDb = f.get_squelch_db(), r === 0) return null;
    const i = new Float32Array(R.memory.buffer, c, r);
    if (e.deEmphasis !== "none") {
      let l = 0;
      e.deEmphasis === "22us" ? l = 22e-6 : e.deEmphasis === "50us" ? l = 5e-5 : e.deEmphasis === "75us" && (l = 75e-6);
      const d = 1 / (1 + l * B), b = 1 - d;
      let g = s.deemphPrev;
      for (let n = 0; n < r; n++)
        g = d * i[n] + b * g, i[n] = g < -1 ? -1 : g > 1 ? 1 : g;
      s.deemphPrev = g;
    } else
      for (let l = 0; l < r; l++)
        i[l] > 1 ? i[l] = 1 : i[l] < -1 && (i[l] = -1);
    r > s.audioTarget.length && (s.audioTarget = new Float32Array(r + 1024));
    const u = s.audioTarget.subarray(0, r);
    return u.set(i), u;
  } else {
    const c = f.process_iq_only_ptr(A, t), r = f.get_iq_output_len(), o = r / 2;
    if (o === 0) return null;
    const i = new Float32Array(R.memory.buffer, c, r);
    let u = 0;
    for (let n = 0; n < o; n++) {
      const m = i[n * 2], P = i[n * 2 + 1];
      u += Math.sqrt(m * m + P * P);
    }
    u /= o;
    const l = 10 * Math.log10(u + 1e-12);
    s.squelchDb = l, o > s.scratchBuf.length && (s.scratchBuf = new Float32Array(o + 128));
    const d = s.scratchBuf.subarray(0, o);
    if (e.squelchEnabled && l < e.squelchLevel) {
      s.squelchOpen = !1, d.fill(0);
      const n = s.audioResampler.process(d);
      return n.length > 0 ? n : null;
    }
    s.squelchOpen = e.squelchEnabled && l >= e.squelchLevel;
    const b = s.currentIfRate;
    if (a === "am")
      for (let n = 0; n < o; n++) {
        const m = i[n * 2], P = i[n * 2 + 1], M = Math.sqrt(m * m + P * P), y = 0.9999;
        s.dcAvg = y * s.dcAvg + (1 - y) * M;
        const S = M - s.dcAvg, q = 50 / b, D = 5 / b, w = Math.abs(S);
        w > s.agcGain ? s.agcGain = s.agcGain * (1 - q) + w * q : s.agcGain = s.agcGain * (1 - D) + w * D;
        const I = s.agcGain > 1e-6 ? 0.5 / s.agcGain : 1;
        d[n] = S * I;
      }
    else if (a === "usb" || a === "lsb" || a === "dsb")
      for (let n = 0; n < o; n++) {
        const m = i[n * 2], P = i[n * 2 + 1];
        let M = 0;
        a === "usb" ? M = h / 2 : a === "lsb" && (M = -h / 2);
        const y = M / b * 2 * Math.PI;
        s.ssbPhase += y, s.ssbPhase > Math.PI && (s.ssbPhase -= 2 * Math.PI), s.ssbPhase < -Math.PI && (s.ssbPhase += 2 * Math.PI);
        const S = Math.cos(s.ssbPhase), q = Math.sin(s.ssbPhase), w = m * S - P * q, I = 50 / b, G = 5 / b, _ = Math.abs(w);
        _ > s.agcGain ? s.agcGain = s.agcGain * (1 - I) + _ * I : s.agcGain = s.agcGain * (1 - G) + _ * G;
        const O = s.agcGain > 1e-6 ? 0.5 / s.agcGain : 1;
        d[n] = w * O;
      }
    else if (a === "cw")
      for (let n = 0; n < o; n++) {
        const m = i[n * 2], P = i[n * 2 + 1], y = 700 / b * 2 * Math.PI;
        s.ssbPhase += y, s.ssbPhase > Math.PI && (s.ssbPhase -= 2 * Math.PI), s.ssbPhase < -Math.PI && (s.ssbPhase += 2 * Math.PI);
        const S = Math.cos(s.ssbPhase), q = Math.sin(s.ssbPhase), w = m * S - P * q, I = 50 / b, G = 5 / b, _ = Math.abs(w);
        _ > s.agcGain ? s.agcGain = s.agcGain * (1 - I) + _ * I : s.agcGain = s.agcGain * (1 - G) + _ * G;
        const O = s.agcGain > 1e-6 ? 0.5 / s.agcGain : 1;
        d[n] = w * O;
      }
    else if (a === "raw")
      for (let n = 0; n < o; n++)
        d[n] = i[n * 2];
    else
      d.fill(0);
    const g = s.audioResampler.process(d);
    if (g.length === 0) return null;
    for (let n = 0; n < g.length; n++)
      g[n] > 1 ? g[n] = 1 : g[n] < -1 && (g[n] = -1);
    return g.slice();
  }
}
