// Motor de audio: 2 decks, mixer, EQ maestro 10 bandas, envolvente opcional, filtro DJM, FX, micrófono y limitador.
import { Widener } from './widener.js';

export const EQ_DEFAULT = [
  { f: 31, g: 0, q: 0.7, t: 'lowshelf' }, { f: 62, g: 0, q: 1.0, t: 'peaking' }, { f: 125, g: 0, q: 1.0, t: 'peaking' },
  { f: 250, g: 0, q: 1.0, t: 'peaking' }, { f: 500, g: 0, q: 1.0, t: 'peaking' }, { f: 1000, g: 0, q: 1.0, t: 'peaking' },
  { f: 2000, g: 0, q: 1.0, t: 'peaking' }, { f: 4000, g: 0, q: 1.0, t: 'peaking' }, { f: 8000, g: 0, q: 1.0, t: 'peaking' },
  { f: 16000, g: 0, q: 0.7, t: 'highshelf' }];

export class Engine {
  constructor(opts = {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    // Calidad HD: pide 48 kHz (proceso en float de 32 bits); si el equipo no lo acepta, usa su frecuencia nativa
    try { this.ctx = new AC(opts.hd ? { latencyHint: 'interactive', sampleRate: 48000 } : { latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC({ latencyHint: 'interactive' }); }
    const c = this.ctx;
    this.masterIn = c.createGain();
    this.eq = EQ_DEFAULT.map(b => { const f = c.createBiquadFilter(); f.type = b.t; f.frequency.value = b.f; f.gain.value = b.g; f.Q.value = b.q; return f; });
    this.eqBypass = false;
    this.preEq = c.createGain(); this.postEq = c.createGain();
    this.masterIn.connect(this.preEq);
    this.preEq.connect(this.eq[0]); for (let i = 0; i < 9; i++) this.eq[i].connect(this.eq[i + 1]); this.eq[9].connect(this.postEq);
    this.master = c.createGain(); this.master.gain.value = 1;
    this.wide = new Widener(c); this.postEq.connect(this.wide.input); this.wide.output.connect(this.master); // transparente si está apagado
    this.out = c.createGain(); // salida ya limitada: altavoz y medidor
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.6;
    this.out.connect(this.analyser); this.out.connect(c.destination);
    this.gr = 0; this.overs = 0;
    this.decks = [new Deck(this, 0), new Deck(this, 1)];
    this.xf = 0.5; this.xfCurve = 'smooth'; this.setCrossfader(0.5);
    this.mic = null; this.duckOn = true;
  }
  async init() {
    const c = this.ctx;
    await c.audioWorklet.addModule(new URL('./worklets.js?v=3', import.meta.url));
    this.limiter = new AudioWorkletNode(c, 'djm-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { ceilingDb: -1, lookahead: 0.005, release: 0.12 } });
    this.limiter.port.onmessage = e => { this.gr = e.data.gr; this.overs = e.data.over; };
    this.master.connect(this.limiter).connect(this.out);
    this.decks.forEach(d => d.attach());
    this._wl = true;
  }
  // Tiempo de programación seguro: un poco en el futuro para que ninguna rampa caiga "en el pasado" (eso causa clics)
  t() { const c = this.ctx; return c.currentTime + Math.min(0.03, Math.max(0.006, c.baseLatency || 0)); }
  resume() { return this.ctx.state !== 'running' ? this.ctx.resume() : Promise.resolve(); }
  setEQBand(i, { f, g, q, t }) {
    const b = this.eq[i], now = this.ctx.currentTime;
    if (t) b.type = t; if (f) b.frequency.setTargetAtTime(f, this.t(), 0.01);
    if (g !== undefined) b.gain.setTargetAtTime(this.eqBypass ? 0 : g, this.t(), 0.01); if (q) b.Q.setTargetAtTime(q, this.t(), 0.01);
    b._g = g !== undefined ? g : b._g;
  }
  setEQ(bands) { bands.forEach((b, i) => this.setEQBand(i, b)); }
  setEQBypass(on) { this.eqBypass = on; this.eq.forEach(b => b.gain.setTargetAtTime(on ? 0 : (b._g || 0), this.t(), 0.01)); }
  setLimiter() { /* el limitador brickwall siempre está activo (techo -1 dBFS) */ }
  setCrossfader(x) {
    this.xf = x; const now = this.ctx.currentTime;
    let a, b;
    if (this.xfCurve === 'cut') { a = x < 0.95 ? 1 : (1 - x) * 20; b = x > 0.05 ? 1 : x * 20; }
    else { a = Math.cos(x * Math.PI / 2); b = Math.sin(x * Math.PI / 2); }
    this.decks[0].xfGain.gain.setTargetAtTime(a, this.t(), 0.008); this.decks[1].xfGain.gain.setTargetAtTime(b, this.t(), 0.008);
  }
  level() { const d = new Uint8Array(this.analyser.fftSize); this.analyser.getByteTimeDomainData(d); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v - 128)); return m / 128; }
  bass() { const d = new Uint8Array(this.analyser.frequencyBinCount); this.analyser.getByteFrequencyData(d); let s = 0; for (let i = 1; i < 8; i++) s += d[i]; return s / (7 * 255); }

  // ---------- Micrófono ----------
  async micOn({ echo = 0.25, echoTime = 0.28, gain = 1 } = {}) {
    if (this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
    const c = this.ctx, src = c.createMediaStreamSource(stream);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const g = c.createGain(); g.gain.value = gain;
    const d = c.createDelay(2); d.delayTime.value = echoTime; const fb = c.createGain(); fb.gain.value = 0.35; const wet = c.createGain(); wet.gain.value = echo;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000;
    src.connect(hp).connect(g); g.connect(this.masterIn); g.connect(d); d.connect(lp).connect(fb).connect(d); lp.connect(wet).connect(this.masterIn);
    this.mic = { stream, src, g, d, fb, wet };
    if (this.duckOn) this.decks.forEach(dk => dk.duck.gain.setTargetAtTime(0.4, this.t(), 0.08));
  }
  micSet({ echo, echoTime, gain }) { if (!this.mic) return; const t = this.ctx.currentTime; if (echo !== undefined) this.mic.wet.gain.setTargetAtTime(echo, this.t(), 0.02); if (echoTime) this.mic.d.delayTime.setTargetAtTime(echoTime, this.t(), 0.02); if (gain !== undefined) this.mic.g.gain.setTargetAtTime(gain, this.t(), 0.02); }
  micOff() { if (!this.mic) return; this.mic.stream.getTracks().forEach(t => t.stop()); try { this.mic.src.disconnect(); this.mic.g.disconnect(); this.mic.wet.disconnect(); } catch (e) {} this.mic = null; this.decks.forEach(dk => dk.duck.gain.setTargetAtTime(1, this.t(), 0.1)); }

  // ---------- Grabador (AudioWorklet, PCM sin pérdida) ----------
}

// ------------------------------------------------------------------
export class Deck {
  constructor(eng, idx) {
    this.eng = eng; this.idx = idx; const c = eng.ctx;
    this.norm = c.createGain(); // normalización de sonoridad por pista
    this.trim = c.createGain();
    this.eqLow = c.createBiquadFilter(); this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 220;
    this.eqMid = c.createBiquadFilter(); this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 0.7;
    this.eqHigh = c.createBiquadFilter(); this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 3500;
    // Filtro DJM: LPF + HPF fijos en serie (nunca se cambia el tipo => sin clics)
    this.lpf = c.createBiquadFilter(); this.lpf.type = 'lowpass'; this.lpf.frequency.value = 22000; this.lpf.Q.value = 0.707;
    this.hpf = c.createBiquadFilter(); this.hpf.type = 'highpass'; this.hpf.frequency.value = 10; this.hpf.Q.value = 0.707;
    this.fxIn = c.createGain(); this.dry = c.createGain(); this.wet = c.createGain(); this.wet.gain.value = 0;
    this.fxOut = c.createGain();
    this.vol = c.createGain(); this.duck = c.createGain(); this.xfGain = c.createGain();
    this.norm.connect(this.trim).connect(this.eqLow).connect(this.eqMid).connect(this.eqHigh).connect(this.lpf).connect(this.hpf).connect(this.fxIn);
    this.fxIn.connect(this.dry).connect(this.fxOut);
    this.echoD = c.createDelay(4); this.echoFb = c.createGain(); this.echoFb.gain.value = 0.45; this.echoLp = c.createBiquadFilter(); this.echoLp.type = 'lowpass'; this.echoLp.frequency.value = 5000;
    this.echoSend = c.createGain(); this.echoSend.gain.value = 0;
    this.fxIn.connect(this.echoSend).connect(this.echoD); this.echoD.connect(this.echoLp).connect(this.echoFb).connect(this.echoD); this.echoLp.connect(this.wet);
    this.flD = c.createDelay(0.05); this.flD.delayTime.value = 0.004; this.flFb = c.createGain(); this.flFb.gain.value = 0.55;
    this.flLfo = c.createOscillator(); this.flLfo.frequency.value = 0.25; this.flDepth = c.createGain(); this.flDepth.gain.value = 0.003;
    this.flLfo.connect(this.flDepth).connect(this.flD.delayTime); this.flLfo.start();
    this.flSend = c.createGain(); this.flSend.gain.value = 0;
    this.fxIn.connect(this.flSend).connect(this.flD); this.flD.connect(this.flFb).connect(this.flD); this.flD.connect(this.wet);
    this.wet.connect(this.fxOut);
    this.fxOut.connect(this.vol).connect(this.duck).connect(this.xfGain).connect(eng.masterIn);
    this.an = c.createAnalyser(); this.an.fftSize = 256; this.duck.connect(this.an); this._lv = new Float32Array(256); // solo medidor visual
    this.buffer = null; this.track = null; this.playing = false;
    this.pos0 = 0; this.rate = 1; this.bpm = 0; this.beatOffset = 0; this.key = null; this.keylock = true;
    this.cues = new Array(8).fill(null); this.cuePoint = 0; this.loop = null; this.fx = 'none'; this.fxWet = 0.5;
    this.wave = null; this.onEnd = null; this.seq = 0; this.st = { p: 0, t: 0, r: 1 }; this.when = 0; this.normDb = 0;
  }
  attach() {
    const c = this.eng.ctx;
    this.node = new AudioWorkletNode(c, 'djm-deck', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node.connect(this.norm);
    this.node.port.onmessage = e => {
      const m = e.data; if (m.seq !== undefined && m.seq < this.seq) return;
      if (m.ev === 'ended') { this.playing = false; this.pos0 = this.duration; this.onEnd && this.onEnd(this); return; }
      if (m.ev === 'autoDone') { this._autoDone && this._autoDone(); return; }
      if (m.p !== undefined) { this.st = { p: m.p, t: m.t, r: m.r }; if (!m.pl && !this.playing) this.pos0 = m.p; }
    };
  }
  send(m, transfer) { m.seq = ++this.seq; this.node.port.postMessage(m, transfer || []); }
  load(buffer, track, analysis = {}) {
    this.stop(); this.track = track;
    this.buffer = { duration: buffer.duration, length: buffer.length, sampleRate: buffer.sampleRate };
    const L = buffer.getChannelData(0).slice(), R = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice();
    this.send({ cmd: 'load', L, R }, [L.buffer, R.buffer]);
    this.send({ cmd: 'keylock', on: this.keylock });
    this.pos0 = 0; this.cuePoint = 0; this.loop = null; this.st = { p: 0, t: this.eng.ctx.currentTime, r: 1 };
    this.bpm = analysis.bpm || 0; this.beatOffset = analysis.offset || 0; this.key = analysis.key || null;
    this.cues = (analysis.cues && analysis.cues.slice()) || new Array(8).fill(null);
    this.setNorm(analysis.normDb || 0);
    this.wave = computeWave(buffer);
  }
  setNorm(db) { this.normDb = db; this.norm.gain.setTargetAtTime(Math.pow(10, db / 20), this.eng.t(), 0.05); }
  setKeylock(on) { this.keylock = on; if (this.node) this.send({ cmd: 'keylock', on }); }
  get duration() { return this.buffer ? this.buffer.duration : 0; }
  position() {
    if (!this.playing) return this.pos0;
    const now = this.eng.ctx.currentTime; if (now < this.when) return this.st.p;
    let p = this.st.p + Math.max(0, now - Math.max(this.st.t, this.when)) * this.st.r;
    if (this.loop && p >= this.loop.end) { const L = this.loop.end - this.loop.start; p = this.loop.start + ((p - this.loop.start) % L); }
    return Math.min(p, this.duration);
  }
  anchor() { const p = this.position(); this.st = { p, t: this.eng.ctx.currentTime, r: this.rate }; this.pos0 = p; }
  play(when = 0) {
    if (!this.buffer || this.playing) return; this.eng.resume();
    if (this.pos0 >= this.duration - 0.05) { this.pos0 = 0; this.send({ cmd: 'seek', t: 0 }); }
    this.when = when || 0; this.st = { p: this.pos0, t: Math.max(this.eng.ctx.currentTime, this.when), r: this.rate };
    this.send({ cmd: 'play', when: this.when }); this.playing = true;
  }
  pause() { if (!this.playing) return; this.anchor(); this.playing = false; this.send({ cmd: 'pause' }); }
  stop() { this.playing = false; this.pos0 = 0; this.loop = null; if (this.node) { this.send({ cmd: 'loop' }); this.send({ cmd: 'stop' }); } }
  toggle() { this.playing ? this.pause() : this.play(); return this.playing; }
  seek(t) {
    t = Math.max(0, Math.min(t, this.duration - 0.01));
    if (this.loop && (t < this.loop.start || t >= this.loop.end)) { this.loop = null; this.send({ cmd: 'loop' }); }
    this.send({ cmd: 'seek', t }); this.pos0 = t; this.st = { p: t, t: this.eng.ctx.currentTime, r: this.rate };
  }
  cue() { if (this.playing) { this.pause(); this.seek(this.cuePoint); } else { this.cuePoint = this.snap(this.position()); this.seek(this.cuePoint); } }
  setRate(r) { this.anchor(); this.rate = r; this.st.r = r; if (this.node) this.send({ cmd: 'rate', r, glide: true }); }
  get effBpm() { return this.bpm * this.rate; }
  beatLen() { return this.bpm ? 60 / this.bpm : 0.5; }
  snap(t) { if (!this.bpm) return t; const b = this.beatLen(); return this.beatOffset + Math.round((t - this.beatOffset) / b) * b; }
  hotcue(i, mode = 'go') {
    if (mode === 'del') { this.cues[i] = null; return 'borrado'; }
    if (this.cues[i] == null) { this.cues[i] = this.bpm ? this.snap(this.position()) : this.position(); return 'fijado'; }
    this.seek(this.cues[i]); if (!this.playing) this.play(); return 'salto';
  }
  setLoop(beats) {
    if (!this.buffer) return;
    if (this.loop && this.loop.beats === beats) { this.exitLoop(); return false; }
    const b = this.beatLen(); const p = this.position();
    const start = this.bpm ? this.beatOffset + Math.floor((p - this.beatOffset) / b + 1e-6) * b : p;
    const end = Math.min(this.duration, start + beats * b);
    this.anchor(); this.loop = { start: Math.max(0, start), end, beats };
    this.send({ cmd: 'loop', s: this.loop.start, e: this.loop.end });
    return true;
  }
  exitLoop() { if (!this.loop) return; this.anchor(); this.loop = null; this.send({ cmd: 'loop' }); }
  sync(other) {
    if (!this.bpm || !other.bpm) return false;
    this.setRate(other.effBpm / this.bpm);
    if (other.playing && this.playing) {
      const oPh = (((other.position() - other.beatOffset) / other.beatLen()) % 1 + 1) % 1;
      const mPh = (((this.position() - this.beatOffset) / this.beatLen()) % 1 + 1) % 1;
      let d = oPh - mPh; if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
      this.seek(this.position() + d * this.beatLen());
    }
    return true;
  }
  setEQ3(band, db) { const n = { low: this.eqLow, mid: this.eqMid, high: this.eqHigh }[band]; n.gain.setTargetAtTime(db, this.eng.t(), 0.01); }
  setFilter(v) {
    const t = this.eng.ctx.currentTime;
    const lf = v < -0.02 ? 20000 * Math.pow(150 / 20000, -v) : 22000, hf = v > 0.02 ? 20 * Math.pow(6000 / 20, v) : 10;
    const q = 0.707 + Math.abs(v) * 3;
    this.lpf.frequency.setTargetAtTime(Math.min(lf, this.eng.ctx.sampleRate * 0.45), this.eng.t(), 0.015); this.hpf.frequency.setTargetAtTime(hf, this.eng.t(), 0.015);
    this.lpf.Q.setTargetAtTime(v < -0.02 ? q : 0.707, this.eng.t(), 0.015); this.hpf.Q.setTargetAtTime(v > 0.02 ? q : 0.707, this.eng.t(), 0.015);
  }
  get filter() { return { type: this.lpf.frequency.value < 21000 ? 'lowpass' : this.hpf.frequency.value > 11 ? 'highpass' : 'none' }; }
  setFX(type, wet = this.fxWet, beats = 0.75) {
    this.fx = type; this.fxWet = wet; const t = this.eng.ctx.currentTime;
    this.echoSend.gain.setTargetAtTime(type === 'echo' ? 1 : 0, this.eng.t(), 0.02);
    this.flSend.gain.setTargetAtTime(type === 'flanger' ? 1 : 0, this.eng.t(), 0.02);
    this.wet.gain.setTargetAtTime(type === 'none' ? 0 : wet, this.eng.t(), 0.02);
    this.dry.gain.setTargetAtTime(type === 'flanger' ? 1 - wet * 0.5 : 1, this.eng.t(), 0.02);
    this.echoD.delayTime.setTargetAtTime(Math.min(3.9, (this.bpm ? 60 / this.effBpm : 0.5) * beats), this.eng.t(), 0.02);
  }
  // Freno de vinil: la velocidad baja a 0 (con cambio de tono, como un tornamesa real)
  brake(sec = 1.2) {
    if (!this.playing) return; const t = this.eng.ctx.currentTime; this.anchor();
    this.send({ cmd: 'auto', pts: [[t, this.rate], [t + sec, 0.001]] });
    this._autoDone = () => { this._autoDone = null; this.send({ cmd: 'rate', r: this.rate }); this.pause(); };
  }
  // Scratch "baby": ida y vuelta de velocidad y regreso al punto (Web Audio no reproduce en reversa en tiempo real)
  scratch(ms = 600) {
    if (!this.playing) return; const t = this.eng.ctx.currentTime, back = this.position();
    const pat = [2.2, 0.15, 2.0, 0.2, 2.4, 0.1], step = ms / 1000 / pat.length;
    const pts = [[t, this.rate], ...pat.map((v, i) => [t + step * (i + 0.5), v * this.rate]), [t + ms / 1000, this.rate]];
    this.send({ cmd: 'auto', pts });
    this._autoDone = () => { this._autoDone = null; if (this.playing) this.seek(back + ms / 1000 * this.rate * 0.3); };
  }
  level() { this.an.getFloatTimeDomainData(this._lv); let m = 0; for (let i = 0; i < 256; i++) { const v = Math.abs(this._lv[i]); if (v > m) m = v; } return m; }
  nudge(r) { if (this.node && this.playing) this.send({ cmd: 'rate', r: this.rate * r, glide: true }); if (r === 1) this.anchor(); }
}

// Forma de onda coloreada (graves=rojo, medios=verde, agudos=azul), ~100 columnas por segundo.
export function computeWave(buf) {
  const sr = buf.sampleRate, hop = Math.floor(sr / 100), n = Math.floor(buf.length / hop);
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
  const peak = new Float32Array(n), lo = new Float32Array(n), mi = new Float32Array(n), hi = new Float32Array(n);
  const al = 1 - Math.exp(-2 * Math.PI * 200 / sr), ah = 1 - Math.exp(-2 * Math.PI * 2500 / sr);
  let l1 = 0, l2 = 0;
  for (let f = 0; f < n; f++) {
    let pk = 0, el = 0, em = 0, eh = 0; const s = f * hop;
    for (let i = s; i < s + hop; i += 2) {
      const x = (a[i] + b[i]) * 0.5; l1 += al * (x - l1); l2 += ah * (x - l2);
      const L = l1, M = l2 - l1, H = x - l2; const ax = x < 0 ? -x : x; if (ax > pk) pk = ax;
      el += L * L; em += M * M; eh += H * H;
    }
    peak[f] = pk; lo[f] = Math.sqrt(el); mi[f] = Math.sqrt(em); hi[f] = Math.sqrt(eh);
  }
  return { peak, lo, mi, hi, fps: sr / hop };
}
