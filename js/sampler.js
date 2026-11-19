// Sampler de 8 pads. Sonidos integrados sintetizados en el navegador (autoría propia, se publican como CC0).
import { idb, settings } from './store.js';
import { readTags, licenseStatus } from './encoders.js';

const SR = 44100;
async function render(sec, fn) { const o = new OfflineAudioContext(2, Math.ceil(SR * sec), SR); fn(o); return o.startRendering(); }
function noise(o, sec) { const b = o.createBuffer(1, Math.ceil(SR * sec), SR); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = o.createBufferSource(); s.buffer = b; return s; }
function env(o, g, t, a, h, r, peak = 1) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + h); g.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r); }

export const BUILTIN = [
  { id: 'aplausos', name: 'Aplausos', emoji: '👏', make: () => render(2.6, o => {
    for (let i = 0; i < 70; i++) { const t = Math.random() * 2.0; const n = noise(o, 0.08); const bp = o.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 1800; bp.Q.value = 1.2; const g = o.createGain(); const p = o.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8; env(o, g, t, 0.002, 0.005, 0.06, 0.5 + Math.random() * 0.5); n.connect(bp).connect(g).connect(p).connect(o.destination); n.start(t); }
  }) },
  { id: 'risas', name: 'Risas', emoji: '😂', make: () => render(1.8, o => {
    const pitches = [310, 290, 300, 270, 280, 250];
    pitches.forEach((f0, i) => { const t = i * 0.22; const osc = o.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f0 * 1.15, t); osc.frequency.exponentialRampToValueAtTime(f0 * 0.85, t + 0.16);
      const n = noise(o, 0.2); const ng = o.createGain(); ng.gain.value = 0.25; const mix = o.createGain(); osc.connect(mix); n.connect(ng).connect(mix);
      const f1 = o.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 5; const f2 = o.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1250; f2.Q.value = 6;
      const g = o.createGain(); env(o, g, t, 0.01, 0.06, 0.1, 1.2); mix.connect(f1).connect(g); mix.connect(f2).connect(g); g.connect(o.destination); osc.start(t); osc.stop(t + 0.2); n.start(t); });
  }) },
  { id: 'trompeta', name: 'Trompetas', emoji: '🎺', make: () => render(1.9, o => {
    [[392, 0, 0.18], [392, 0.2, 0.18], [392, 0.4, 0.18], [523.25, 0.6, 1.1]].forEach(([f, t, d]) => {
      [f, f * 1.003, f * 1.5].forEach((ff, j) => { const osc = o.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = ff; const vib = o.createOscillator(); vib.frequency.value = 5.5; const vg = o.createGain(); vg.gain.value = t > 0.5 ? 4 : 0; vib.connect(vg).connect(osc.frequency);
        const lp = o.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(600, t); lp.frequency.linearRampToValueAtTime(3200, t + 0.06); lp.Q.value = 2; const g = o.createGain(); env(o, g, t, 0.03, d - 0.08, 0.12, j === 2 ? 0.08 : 0.22);
        osc.connect(lp).connect(g).connect(o.destination); osc.start(t); vib.start(t); osc.stop(t + d + 0.2); vib.stop(t + d + 0.2); });
    });
  }) },
  { id: 'airhorn', name: 'Air horn', emoji: '📯', make: () => render(1.6, o => {
    [0, 0.28, 0.56].forEach((t, k) => { const d = k === 2 ? 0.9 : 0.22; [440, 443, 554, 659, 220].forEach(f => { const osc = o.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f * 0.94, t); osc.frequency.linearRampToValueAtTime(f, t + 0.05);
      const g = o.createGain(); env(o, g, t, 0.01, d, 0.08, 0.11); const hp = o.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300; const sh = o.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 3); } sh.curve = c;
      osc.connect(hp).connect(sh).connect(g).connect(o.destination); osc.start(t); osc.stop(t + d + 0.1); }); });
  }) },
  { id: 'sirena', name: 'Sirena', emoji: '🚨', make: () => render(2.2, o => {
    const osc = o.createOscillator(); osc.type = 'square'; const lfo = o.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 1.6; const lg = o.createGain(); lg.gain.value = 350; osc.frequency.value = 900; lfo.connect(lg).connect(osc.frequency);
    const lp = o.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500; const g = o.createGain(); env(o, g, 0, 0.05, 1.8, 0.3, 0.25); osc.connect(lp).connect(g).connect(o.destination); osc.start(); lfo.start();
  }) },
  { id: 'laser', name: 'Láser', emoji: '⚡', make: () => render(0.9, o => {
    [0, 0.18, 0.36].forEach(t => { const osc = o.createOscillator(); osc.type = 'square'; osc.frequency.setValueAtTime(2400, t); osc.frequency.exponentialRampToValueAtTime(120, t + 0.25); const g = o.createGain(); env(o, g, t, 0.002, 0.05, 0.2, 0.3); osc.connect(g).connect(o.destination); osc.start(t); osc.stop(t + 0.3); });
  }) },
  { id: 'boom', name: 'Boom', emoji: '💥', make: () => render(2.2, o => {
    const osc = o.createOscillator(); osc.frequency.setValueAtTime(120, 0); osc.frequency.exponentialRampToValueAtTime(32, 1.2); const g = o.createGain(); env(o, g, 0, 0.003, 0.15, 1.8, 1); osc.connect(g).connect(o.destination); osc.start();
    const n = noise(o, 1.5); const lp = o.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, 0); lp.frequency.exponentialRampToValueAtTime(100, 1.2); const ng = o.createGain(); env(o, ng, 0, 0.002, 0.05, 1.2, 0.6); n.connect(lp).connect(ng).connect(o.destination); n.start();
  }) },
  { id: 'riser', name: 'Subida', emoji: '🚀', make: () => render(4, o => {
    const n = noise(o, 4); const bp = o.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(9000, 3.9); const g = o.createGain(); g.gain.setValueAtTime(0.05, 0); g.gain.exponentialRampToValueAtTime(0.8, 3.9); g.gain.linearRampToValueAtTime(0, 4);
    n.connect(bp).connect(g).connect(o.destination); n.start();
    const osc = o.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(110, 0); osc.frequency.exponentialRampToValueAtTime(880, 3.9); const og = o.createGain(); og.gain.setValueAtTime(0.01, 0); og.gain.exponentialRampToValueAtTime(0.12, 3.9); og.gain.linearRampToValueAtTime(0, 4); osc.connect(og).connect(o.destination); osc.start();
  }) },
];
export const PAD_DEFAULT = { gain: 0.8, reverb: 0.15, delay: 0, delayTime: 0.25, low: 0, mid: 0, high: 0, choke: false };

function makeIR(ctx, sec = 2.2) { const len = Math.floor(ctx.sampleRate * sec); const b = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); } return b; }

export class Sampler {
  constructor(eng) {
    this.eng = eng; const c = eng.ctx;
    this.bus = c.createGain(); this.bus.gain.value = 0.9; this.bus.connect(eng.masterIn);
    this.rev = c.createConvolver(); this.rev.buffer = makeIR(c); this.revRet = c.createGain(); this.revRet.gain.value = 0.8; this.rev.connect(this.revRet).connect(this.bus);
    this.pads = [];
    const cfg = settings.get('pads', []);
    for (let i = 0; i < 8; i++) {
      const p = { i, ...PAD_DEFAULT, ...(cfg[i] || {}), buffer: null, src: null, name: BUILTIN[i].name, emoji: BUILTIN[i].emoji, license: 'cc0', custom: !!(cfg[i] && cfg[i].custom) };
      p.g = c.createGain(); p.lo = c.createBiquadFilter(); p.lo.type = 'lowshelf'; p.lo.frequency.value = 250; p.mi = c.createBiquadFilter(); p.mi.type = 'peaking'; p.mi.frequency.value = 1200; p.hi = c.createBiquadFilter(); p.hi.type = 'highshelf'; p.hi.frequency.value = 4000;
      p.rs = c.createGain(); p.ds = c.createGain(); p.d = c.createDelay(2); p.dfb = c.createGain(); p.dfb.gain.value = 0.4;
      p.g.connect(p.lo).connect(p.mi).connect(p.hi); p.hi.connect(this.bus); p.hi.connect(p.rs).connect(this.rev); p.hi.connect(p.ds).connect(p.d); p.d.connect(p.dfb).connect(p.d); p.d.connect(this.bus);
      this.pads.push(p); this.apply(i);
    }
  }
  apply(i) { const p = this.pads[i], t = this.eng.ctx.currentTime; p.g.gain.setTargetAtTime(p.gain, t, 0.01); p.rs.gain.setTargetAtTime(p.reverb, t, 0.01); p.ds.gain.setTargetAtTime(p.delay, t, 0.01); p.d.delayTime.setTargetAtTime(p.delayTime, t, 0.01); p.lo.gain.setTargetAtTime(p.low, t, 0.01); p.mi.gain.setTargetAtTime(p.mid, t, 0.01); p.hi.gain.setTargetAtTime(p.high, t, 0.01); }
  save() { settings.set('pads', this.pads.map(p => ({ gain: p.gain, reverb: p.reverb, delay: p.delay, delayTime: p.delayTime, low: p.low, mid: p.mid, high: p.high, choke: p.choke, custom: p.custom, name: p.custom ? p.name : undefined, license: p.license }))); }
  async init(onProgress) {
    for (let i = 0; i < 8; i++) {
      const p = this.pads[i];
      if (p.custom) {
        try { const blob = await idb.get('blobs', 'pad' + i); if (blob) { p.buffer = await this.decodeRetry(blob); const c = settings.get('pads', [])[i] || {}; p.name = c.name || 'Muestra'; p.emoji = '🎵'; p.license = c.license || 'desconocida'; onProgress && onProgress(i); continue; } } catch (e) { console.warn('pad custom', e); }
        p.custom = false;
      }
      p.buffer = await BUILTIN[i].make(); onProgress && onProgress(i);
    }
  }
  async decodeRetry(blob, tries = 3) {
    let last;
    for (let k = 0; k < tries; k++) {
      try { const ab = await blob.arrayBuffer(); return await this.eng.ctx.decodeAudioData(ab); }
      catch (e) { last = e; await new Promise(r => setTimeout(r, 300 * (k + 1))); }
    }
    throw last || new Error('no se pudo decodificar');
  }
  async loadCustom(i, file) {
    const tags = await readTags(file);
    const buffer = await this.decodeRetry(file, 3);
    const p = this.pads[i]; p.buffer = buffer; p.custom = true; p.name = (tags.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 18); p.emoji = '🎵'; p.license = licenseStatus(tags);
    await idb.put('blobs', file, 'pad' + i); this.save();
    return { license: p.license, tags };
  }
  async resetPad(i) { const p = this.pads[i]; p.custom = false; p.name = BUILTIN[i].name; p.emoji = BUILTIN[i].emoji; p.license = 'cc0'; p.buffer = await BUILTIN[i].make(); await idb.del('blobs', 'pad' + i); this.save(); }
  trigger(i, vel = 1) {
    const p = this.pads[i]; if (!p.buffer) return false;
    this.eng.resume();
    if (p.choke && p.src) { try { p.src.stop(); } catch (e) {} }
    const s = this.eng.ctx.createBufferSource(); s.buffer = p.buffer; const vg = this.eng.ctx.createGain(); vg.gain.value = vel; s.connect(vg).connect(p.g); s.start(); p.src = s; s.onended = () => { vg.disconnect(); if (p.src === s) p.src = null; };
    return true;
  }
}
