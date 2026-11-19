// Motor de audio: 2 decks, mixer, EQ maestro 10 bandas, filtro DJM, FX, micrófono y grabador.
import { floatTo16 } from './encoders.js';

export const EQ_DEFAULT = [
  { f: 31, g: 0, q: 0.7, t: 'lowshelf' }, { f: 62, g: 0, q: 1.0, t: 'peaking' }, { f: 125, g: 0, q: 1.0, t: 'peaking' },
  { f: 250, g: 0, q: 1.0, t: 'peaking' }, { f: 500, g: 0, q: 1.0, t: 'peaking' }, { f: 1000, g: 0, q: 1.0, t: 'peaking' },
  { f: 2000, g: 0, q: 1.0, t: 'peaking' }, { f: 4000, g: 0, q: 1.0, t: 'peaking' }, { f: 8000, g: 0, q: 1.0, t: 'peaking' },
  { f: 16000, g: 0, q: 0.7, t: 'highshelf' }];

export class Engine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.masterIn = c.createGain();
    this.eq = EQ_DEFAULT.map(b => { const f = c.createBiquadFilter(); f.type = b.t; f.frequency.value = b.f; f.gain.value = b.g; f.Q.value = b.q; return f; });
    this.eqBypass = false;
    this.preEq = c.createGain(); this.postEq = c.createGain();
    this.masterIn.connect(this.preEq);
    this.preEq.connect(this.eq[0]); for (let i = 0; i < 9; i++) this.eq[i].connect(this.eq[i + 1]); this.eq[9].connect(this.postEq);
    this.limiter = c.createDynamicsCompressor();
    Object.assign(this.limiter, {}); this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    this.master = c.createGain(); this.master.gain.value = 0.9;
    this.postEq.connect(this.limiter).connect(this.master);
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.6;
    this.master.connect(this.analyser);
    this.master.connect(c.destination);
    this.decks = [new Deck(this, 0), new Deck(this, 1)];
    this.xf = 0.5; this.xfCurve = 'smooth'; this.setCrossfader(0.5);
    this.mic = null; this.duckOn = true;
    this.rec = null;
  }
  resume() { return this.ctx.state !== 'running' ? this.ctx.resume() : Promise.resolve(); }
  setEQBand(i, { f, g, q, t }) {
    const b = this.eq[i], now = this.ctx.currentTime;
    if (t) b.type = t; if (f) b.frequency.setTargetAtTime(f, now, 0.01);
    if (g !== undefined) b.gain.setTargetAtTime(this.eqBypass ? 0 : g, now, 0.01); if (q) b.Q.setTargetAtTime(q, now, 0.01);
    b._g = g !== undefined ? g : b._g;
  }
  setEQ(bands) { bands.forEach((b, i) => this.setEQBand(i, b)); }
  setEQBypass(on) { this.eqBypass = on; this.eq.forEach(b => b.gain.setTargetAtTime(on ? 0 : (b._g || 0), this.ctx.currentTime, 0.01)); }
  setLimiter(on) { this.postEq.disconnect(); this.limiter.disconnect(); if (on) { this.postEq.connect(this.limiter).connect(this.master); } else this.postEq.connect(this.master); }
  setCrossfader(x) {
    this.xf = x; const now = this.ctx.currentTime;
    let a, b;
    if (this.xfCurve === 'cut') { a = x < 0.95 ? 1 : (1 - x) * 20; b = x > 0.05 ? 1 : x * 20; }
    else { a = Math.cos(x * Math.PI / 2); b = Math.sin(x * Math.PI / 2); }
    this.decks[0].xfGain.gain.setTargetAtTime(a, now, 0.008); this.decks[1].xfGain.gain.setTargetAtTime(b, now, 0.008);
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
    if (this.duckOn) this.decks.forEach(dk => dk.duck.gain.setTargetAtTime(0.4, c.currentTime, 0.08));
  }
  micSet({ echo, echoTime, gain }) { if (!this.mic) return; const t = this.ctx.currentTime; if (echo !== undefined) this.mic.wet.gain.setTargetAtTime(echo, t, 0.02); if (echoTime) this.mic.d.delayTime.setTargetAtTime(echoTime, t, 0.02); if (gain !== undefined) this.mic.g.gain.setTargetAtTime(gain, t, 0.02); }
  micOff() { if (!this.mic) return; this.mic.stream.getTracks().forEach(t => t.stop()); try { this.mic.src.disconnect(); this.mic.g.disconnect(); this.mic.wet.disconnect(); } catch (e) {} this.mic = null; this.decks.forEach(dk => dk.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.1)); }

  // ---------- Grabador (AudioWorklet, PCM sin pérdida) ----------
  async recStart() {
    if (this.rec) return;
    const c = this.ctx;
    const rec = { L: [], R: [], frames: 0, started: Date.now() };
    const onData = (l, r) => { rec.L.push(floatTo16(l)); rec.R.push(floatTo16(r)); rec.frames += l.length; };
    if (c.audioWorklet && !this._wl) {
      const code = `class R extends AudioWorkletProcessor{constructor(){super();this.on=true;this.n=0;this.l=new Float32Array(4096);this.r=new Float32Array(4096);this.port.onmessage=e=>{if(e.data==='stop'){this.flush();this.on=false;}}}
      flush(){if(this.n){this.port.postMessage([this.l.slice(0,this.n),this.r.slice(0,this.n)]);this.n=0;}}
      process(ins){const i=ins[0];if(!this.on)return false;if(i&&i.length){const a=i[0],b=i[1]||i[0];for(let k=0;k<a.length;k++){this.l[this.n]=a[k];this.r[this.n]=b[k];this.n++;if(this.n===4096){this.port.postMessage([this.l,this.r]);this.l=new Float32Array(4096);this.r=new Float32Array(4096);this.n=0;}}}return true;}}
      registerProcessor('djm-rec',R);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      try { await c.audioWorklet.addModule(url); this._wl = true; } catch (e) { this._wl = false; }
    }
    if (this._wl) {
      const node = new AudioWorkletNode(c, 'djm-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
      node.port.onmessage = e => onData(e.data[0], e.data[1]);
      this.master.connect(node); rec.node = node;
    } else {
      const sp = c.createScriptProcessor(4096, 2, 2);
      sp.onaudioprocess = e => onData(new Float32Array(e.inputBuffer.getChannelData(0)), new Float32Array(e.inputBuffer.getChannelData(1)));
      const z = c.createGain(); z.gain.value = 0; this.master.connect(sp); sp.connect(z).connect(c.destination); rec.node = sp; rec.z = z;
    }
    this.rec = rec;
  }
  async recStop() {
    const rec = this.rec; if (!rec) return null;
    if (rec.node.port) { rec.node.port.postMessage('stop'); await new Promise(r => setTimeout(r, 150)); }
    try { this.master.disconnect(rec.node); } catch (e) {} try { rec.node.disconnect(); } catch (e) {}
    this.rec = null;
    const join = arr => { const o = new Int16Array(rec.frames); let p = 0; for (const a of arr) { o.set(a.subarray(0, Math.min(a.length, rec.frames - p)), p); p += a.length; } return o; };
    return { L: join(rec.L), R: join(rec.R), sampleRate: this.ctx.sampleRate, seconds: rec.frames / this.ctx.sampleRate, started: rec.started };
  }
  recSeconds() { return this.rec ? this.rec.frames / this.ctx.sampleRate : 0; }
}

// ------------------------------------------------------------------
export class Deck {
  constructor(eng, idx) {
    this.eng = eng; this.idx = idx; const c = eng.ctx;
    this.trim = c.createGain();
    this.eqLow = c.createBiquadFilter(); this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 220;
    this.eqMid = c.createBiquadFilter(); this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 0.7;
    this.eqHigh = c.createBiquadFilter(); this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 3500;
    this.filter = c.createBiquadFilter(); this.filter.type = 'allpass'; this.filter.Q.value = 1;
    this.fxIn = c.createGain(); this.dry = c.createGain(); this.wet = c.createGain(); this.wet.gain.value = 0;
    this.fxOut = c.createGain();
    this.vol = c.createGain(); this.duck = c.createGain(); this.xfGain = c.createGain();
    this.trim.connect(this.eqLow).connect(this.eqMid).connect(this.eqHigh).connect(this.filter).connect(this.fxIn);
    this.fxIn.connect(this.dry).connect(this.fxOut);
    // Echo (sincronizado al BPM)
    this.echoD = c.createDelay(4); this.echoFb = c.createGain(); this.echoFb.gain.value = 0.45; this.echoLp = c.createBiquadFilter(); this.echoLp.type = 'lowpass'; this.echoLp.frequency.value = 5000;
    this.echoSend = c.createGain(); this.echoSend.gain.value = 0;
    this.fxIn.connect(this.echoSend).connect(this.echoD); this.echoD.connect(this.echoLp).connect(this.echoFb).connect(this.echoD); this.echoLp.connect(this.wet);
    // Flanger
    this.flD = c.createDelay(0.05); this.flD.delayTime.value = 0.004; this.flFb = c.createGain(); this.flFb.gain.value = 0.55;
    this.flLfo = c.createOscillator(); this.flLfo.frequency.value = 0.25; this.flDepth = c.createGain(); this.flDepth.gain.value = 0.003;
    this.flLfo.connect(this.flDepth).connect(this.flD.delayTime); this.flLfo.start();
    this.flSend = c.createGain(); this.flSend.gain.value = 0;
    this.fxIn.connect(this.flSend).connect(this.flD); this.flD.connect(this.flFb).connect(this.flD); this.flD.connect(this.wet);
    this.wet.connect(this.fxOut);
    this.fxOut.connect(this.vol).connect(this.duck).connect(this.xfGain).connect(eng.masterIn);
    this.buffer = null; this.track = null; this.src = null; this.playing = false;
    this.pos0 = 0; this.t0 = 0; this.rate = 1; this.bpm = 0; this.beatOffset = 0; this.key = null;
    this.cues = new Array(8).fill(null); this.cuePoint = 0; this.loop = null; this.fx = 'none'; this.fxWet = 0.5;
    this.wave = null; this.onEnd = null;
  }
  load(buffer, track, analysis = {}) {
    this.stop(); this.buffer = buffer; this.track = track; this.pos0 = 0; this.cuePoint = 0; this.loop = null;
    this.bpm = analysis.bpm || 0; this.beatOffset = analysis.offset || 0; this.key = analysis.key || null;
    this.cues = (analysis.cues && analysis.cues.slice()) || new Array(8).fill(null);
    this.wave = computeWave(buffer);
  }
  get duration() { return this.buffer ? this.buffer.duration : 0; }
  position() {
    if (!this.playing) return this.pos0;
    let p = this.pos0 + (this.eng.ctx.currentTime - this.t0) * this.rate;
    if (this.loop && p >= this.loop.end) { const L = this.loop.end - this.loop.start; p = this.loop.start + ((p - this.loop.start) % L); }
    return Math.min(p, this.duration);
  }
  anchor() { this.pos0 = this.position(); this.t0 = this.eng.ctx.currentTime; }
  _startSrc(at, when = 0) {
    const c = this.eng.ctx; const s = c.createBufferSource(); s.buffer = this.buffer; s.playbackRate.value = this.rate;
    if (this.loop) { s.loop = true; s.loopStart = this.loop.start; s.loopEnd = this.loop.end; }
    s.connect(this.trim);
    const t = when || c.currentTime;
    s.start(t, Math.max(0, Math.min(at, this.duration - 0.001)));
    s.onended = () => { if (this.src === s && this.playing) { this.playing = false; this.pos0 = this.duration; this.src = null; this.onEnd && this.onEnd(this); } };
    this.src = s; this.t0 = t; this.pos0 = at;
  }
  play(when = 0) { if (!this.buffer || this.playing) return; this.eng.resume(); if (this.pos0 >= this.duration - 0.05) this.pos0 = 0; this._startSrc(this.pos0, when); this.playing = true; }
  pause() { if (!this.playing) return; this.anchor(); this.playing = false; this._kill(); }
  _kill() { if (this.src) { const s = this.src; this.src = null; try { s.onended = null; s.stop(); s.disconnect(); } catch (e) {} } }
  stop() { this._kill(); this.playing = false; this.pos0 = 0; }
  toggle() { this.playing ? this.pause() : this.play(); return this.playing; }
  seek(t) { t = Math.max(0, Math.min(t, this.duration - 0.01)); if (this.loop && (t < this.loop.start || t >= this.loop.end)) this.loop = null; if (this.playing) { this._kill(); this._startSrc(t); } else this.pos0 = t; }
  cue() { // estilo CDJ: en pausa fija el cue; tocando vuelve al cue y pausa
    if (this.playing) { this.pause(); this.seek(this.cuePoint); } else { this.cuePoint = this.snap(this.position()); this.seek(this.cuePoint); }
  }
  setRate(r) { this.anchor(); this.rate = r; if (this.src) this.src.playbackRate.setValueAtTime(r, this.eng.ctx.currentTime); }
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
    if (this.src) { this.src.loopStart = this.loop.start; this.src.loopEnd = this.loop.end; this.src.loop = true; }
    return true;
  }
  exitLoop() { if (!this.loop) return; this.anchor(); this.loop = null; if (this.src) this.src.loop = false; }
  sync(other) {
    if (!this.bpm || !other.bpm) return false;
    let target = other.effBpm / this.bpm;
    // fase: alinear fracción de beat
    this.setRate(target);
    if (other.playing && this.playing) {
      const ob = 60 / other.effBpm, mb = 60 / this.effBpm;
      const oPh = (((other.position() - other.beatOffset) / other.beatLen()) % 1 + 1) % 1;
      const mPh = (((this.position() - this.beatOffset) / this.beatLen()) % 1 + 1) % 1;
      let d = oPh - mPh; if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
      this.seek(this.position() + d * this.beatLen());
    }
    return true;
  }
  setEQ3(band, db) { const n = { low: this.eqLow, mid: this.eqMid, high: this.eqHigh }[band]; n.gain.setTargetAtTime(db, this.eng.ctx.currentTime, 0.01); }
  // Filtro DJM: -1 = pasa-bajos total, 0 = neutro, +1 = pasa-altos total
  setFilter(v) {
    const f = this.filter, t = this.eng.ctx.currentTime;
    if (Math.abs(v) < 0.03) { f.type = 'allpass'; return; }
    if (v < 0) { f.type = 'lowpass'; f.frequency.setTargetAtTime(20000 * Math.pow(150 / 20000, -v), t, 0.01); }
    else { f.type = 'highpass'; f.frequency.setTargetAtTime(20 * Math.pow(6000 / 20, v), t, 0.01); }
    f.Q.setTargetAtTime(1.2 + Math.abs(v) * 3, t, 0.01);
  }
  setFX(type, wet = this.fxWet, beats = 0.75) {
    this.fx = type; this.fxWet = wet; const t = this.eng.ctx.currentTime;
    this.echoSend.gain.setTargetAtTime(type === 'echo' ? 1 : 0, t, 0.02);
    this.flSend.gain.setTargetAtTime(type === 'flanger' ? 1 : 0, t, 0.02);
    this.wet.gain.setTargetAtTime(type === 'none' ? 0 : wet, t, 0.02);
    this.dry.gain.setTargetAtTime(type === 'flanger' ? 1 - wet * 0.5 : 1, t, 0.02);
    this.echoD.delayTime.setTargetAtTime(Math.min(3.9, (this.bpm ? 60 / this.effBpm : 0.5) * beats), t, 0.02);
  }
  brake(sec = 1.2) {
    if (!this.playing || !this.src) return;
    const c = this.eng.ctx, t = c.currentTime; this.anchor();
    this.src.playbackRate.cancelScheduledValues(t); this.src.playbackRate.setValueAtTime(this.rate, t); this.src.playbackRate.linearRampToValueAtTime(0.01, t + sec);
    const p = this.pos0 + this.rate * sec / 2;
    setTimeout(() => { this._kill(); this.playing = false; this.pos0 = Math.min(p, this.duration); }, sec * 1000);
  }
  // Scratch simulado: movimiento de ida y vuelta tipo "baby scratch" (Web Audio no reproduce en reversa en tiempo real)
  scratch(ms = 600) {
    if (!this.playing || !this.src) return;
    const c = this.eng.ctx, t = c.currentTime, pr = this.src.playbackRate; this.anchor();
    const pat = [2.2, 0.15, 2.0, 0.2, 2.4, 0.1]; const step = ms / 1000 / pat.length;
    pr.cancelScheduledValues(t); pr.setValueAtTime(this.rate, t);
    pat.forEach((v, i) => pr.linearRampToValueAtTime(v * this.rate, t + step * (i + 0.5)));
    pr.linearRampToValueAtTime(this.rate, t + ms / 1000);
    const back = this.position();
    setTimeout(() => { if (this.playing) this.seek(back); }, ms); // vuelve a donde estaba (como regresar el disco)
  }
  nudge(r) { if (this.src) this.src.playbackRate.setTargetAtTime(this.rate * r, this.eng.ctx.currentTime, 0.02); if (r === 1) this.anchor(); else this._nudgeT = this._nudgeT; }
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
