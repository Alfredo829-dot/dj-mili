// Sampler de 16 pads (2 bancos de 8). Grabaciones reales CC0 (Freesound) + sonidos sintetizados en el navegador (autoría propia, CC0).
import { idb, settings } from './store.js';
import { readTags, licenseStatus, floatTo16, encodeFLAC } from './encoders.js';
import { integratedLoudness } from './loudness.js';

const SR = 44100;
async function render(sec, fn) { const o = new OfflineAudioContext(2, Math.ceil(SR * sec), SR); fn(o); return o.startRendering(); }
function noise(o, sec) { const b = o.createBuffer(1, Math.ceil(SR * sec), SR); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = o.createBufferSource(); s.buffer = b; return s; }
function env(o, g, t, a, h, r, peak = 1) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + h); g.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r); }

// Utilidades de síntesis a nivel de muestra (para scratch/rewind/platillo)
function bufFrom(o, L, R = L) { const b = o.createBuffer(2, L.length, SR); b.getChannelData(0).set(L); b.getChannelData(1).set(R); return b; }
function play(o, buf, t = 0, gain = 1, rate) { const s = o.createBufferSource(); s.buffer = buf; const g = o.createGain(); g.gain.value = gain; if (rate) rate(s.playbackRate); s.connect(g).connect(o.destination); s.start(t); return g; }
function roomIR(o, sec = 1.6, damp = 0.5) { const len = Math.floor(SR * sec), b = o.createBuffer(2, len, SR); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const x = Math.random() * 2 - 1; lp += (x - lp) * (1 - damp * i / len); d[i] = lp * Math.exp(-6.9 * i / len); } [0.011, 0.017, 0.023, 0.031].forEach((e, k) => { d[Math.floor((e + c * 0.003) * SR)] += 0.5 / (k + 1); }); } return b; }
function withRoom(o, sec, wet = 0.3, damp = 0.5) { const dry = o.createGain(), cv = o.createConvolver(), wg = o.createGain(); cv.buffer = roomIR(o, sec, damp); wg.gain.value = wet; dry.connect(o.destination); dry.connect(cv).connect(wg).connect(o.destination); return dry; }
// Fuente "vocal" (diente de sierra con formantes "ah") para el scratch, como una muestra de vinil
function vocalSrc(n, f0 = 180) { const out = new Float32Array(n); let ph = 0; const fm = [[730, 0.08], [1090, 0.06], [2440, 0.05]].map(([f, bw]) => ({ f, r: Math.exp(-Math.PI * f * bw / SR), y1: 0, y2: 0 }));
  for (let i = 0; i < n; i++) { ph += (f0 * (1 + 0.04 * Math.sin(i / SR * 30))) / SR; ph -= Math.floor(ph); const x = 2 * ph - 1 + (Math.random() - 0.5) * 0.3; let y = 0; for (const r of fm) { const c = 2 * r.r * Math.cos(2 * Math.PI * r.f / SR); const v = x + c * r.y1 - r.r * r.r * r.y2; r.y2 = r.y1; r.y1 = v; y += v * (1 - r.r); } out[i] = y * 1.2; } return out; }
function readVar(src, pos) { // lectura con interpolación lineal a velocidad variable (como un plato)
  const out = new Float32Array(pos.length); for (let i = 0; i < pos.length; i++) { const p = Math.max(0, Math.min(src.length - 2, pos[i])), k = Math.floor(p), f = p - k; out[i] = src[k] * (1 - f) + src[k + 1] * f; } return out; }
function cymbal(n) { const out = new Float32Array(n); const fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map(f => f * 2.1); const ph = fr.map(() => Math.random()); let hp = 0, prev = 0;
  for (let i = 0; i < n; i++) { let x = 0; for (let k = 0; k < fr.length; k++) { ph[k] += fr[k] / SR; ph[k] -= Math.floor(ph[k]); x += ph[k] < 0.5 ? 1 : -1; } x = x / 6 + (Math.random() * 2 - 1) * 0.9; hp = 0.85 * (hp + x - prev); prev = x; out[i] = hp * Math.exp(-2.2 * i / SR); } return out; }
const norm = (a, pk = 0.89) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); const g = m ? pk / m : 1; for (let i = 0; i < a.length; i++) a[i] *= g; return a; };
const ramp = (a, fi, fo) => { const ni = Math.round(fi * SR), no = Math.round(fo * SR); for (let i = 0; i < ni; i++) a[i] *= i / ni; for (let i = 0; i < no; i++) a[a.length - 1 - i] *= i / no; return a; };
// Grabaciones reales CC0 (Freesound, ver assets/pads/CREDITOS.md); si no hay red se usa una versión sintetizada
async function fetchDecode(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); const ab = await r.arrayBuffer(); const o = new OfflineAudioContext(2, 1, SR); return o.decodeAudioData(ab); }
const real = (file, fallback) => async () => { try { return await fetchDecode(new URL('../assets/pads/' + file, import.meta.url)); } catch (e) { console.warn('pad real', file, e); return fallback(); } };
const synthClaps = (n, sec) => render(sec, o => { const room = withRoom(o, 1.4, 0.35); for (let i = 0; i < n; i++) { const t = Math.pow(Math.random(), 0.7) * (sec - 1.2); const nz = noise(o, 0.03); const bp = o.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700 + Math.random() * 2200; bp.Q.value = 0.8 + Math.random(); const g = o.createGain(); const p = o.createStereoPanner(); p.pan.value = Math.random() * 2 - 1; env(o, g, t, 0.0007, 0.002, 0.012 + Math.random() * 0.02, (0.3 + Math.random() * 0.7) * Math.min(1, (sec - 1 - t) * 1.2)); nz.connect(bp).connect(g).connect(p).connect(room); nz.start(t); } });

export const BUILTIN = [
  { id: 'aplausos', reverb: 0.04, real: true, name: 'Aplausos', emoji: '👏', make: real('aplausos.mp3', () => synthClaps(900, 5)) },
  { id: 'risas', reverb: 0.04, real: true, name: 'Risas', emoji: '😂', make: real('risas.mp3', () => synthClaps(300, 3)) },
  { id: 'ovacion', reverb: 0.04, real: true, name: 'Ovación', emoji: '🙌', make: real('ovacion.mp3', () => synthClaps(1400, 6)) },
  { id: 'oooh', reverb: 0.04, real: true, name: 'Ooooh', emoji: '😮', make: real('oooh.mp3', () => synthClaps(200, 2)) },
  { id: 'hey', reverb: 0.04, real: true, name: '¡Hey!', emoji: '🗣️', make: real('hey.mp3', () => synthClaps(40, 1.2)) },
  { id: 'airhorn', name: 'Air horn', emoji: '📯', make: () => render(1.8, o => {
    const room = withRoom(o, 1.2, 0.18);
    [0, 0.3, 0.6].forEach((t, k) => { const d = k === 2 ? 0.95 : 0.2; [440, 442.5, 554.4, 659.3, 880.6].forEach((f, j) => { const osc = o.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f * 0.92, t); osc.frequency.exponentialRampToValueAtTime(f, t + 0.04);
      const g = o.createGain(); env(o, g, t, 0.006, d, 0.07, j === 4 ? 0.05 : 0.12); const hp = o.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350; const pk = o.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2200; pk.gain.value = 6; const sh = o.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) c[i] = Math.tanh((i / 512 - 1) * 2.5); sh.curve = c; sh.oversample = '4x';
      osc.connect(hp).connect(sh).connect(pk).connect(g).connect(room); osc.start(t); osc.stop(t + d + 0.1); }); });
  }) },
  { id: 'sirena', name: 'Sirena', emoji: '🚨', make: () => render(2.4, o => {
    const room = withRoom(o, 1.5, 0.25);
    const osc = o.createOscillator(); osc.type = 'sawtooth'; const lfo = o.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 2.2; const lg = o.createGain(); lg.gain.value = 420; osc.frequency.value = 1050; lfo.connect(lg).connect(osc.frequency);
    const lp = o.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; const g = o.createGain(); env(o, g, 0, 0.04, 1.95, 0.35, 0.22); osc.connect(lp).connect(g).connect(room); osc.start(); lfo.start();
  }) },
  { id: 'rewind', name: 'Rewind', emoji: '⏪', make: () => render(1.7, o => {
    // "Música" corta (acordes + bombo) leída hacia atrás acelerando, como regresar el disco con la mano
    const n = SR * 4, src = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / SR; let x = 0; for (const f of [220, 277.2, 329.6, 440]) x += ((t * f) % 1) * 2 - 1; x *= 0.12; const bt = t % 0.47; x += Math.sin(2 * Math.PI * 55 * bt * (1 + 2 * Math.exp(-bt * 30))) * Math.exp(-bt * 9) * 0.8; src[i] = x; }
    const pos = new Float32Array(Math.round(1.6 * SR)); let p = n - 1, v = 0;
    for (let i = 0; i < pos.length; i++) { const t = i / SR; v = t < 0.08 ? -t / 0.08 : -(1 + t * 5.5); if (t > 1.35) v *= Math.max(0, (1.6 - t) / 0.25); p += v; pos[i] = p; }
    const y = ramp(norm(readVar(src, pos), 0.8), 0.003, 0.08); const lp = o.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000; const s = o.createBufferSource(); s.buffer = bufFrom(o, y); s.connect(lp).connect(o.destination); s.start();
  }) },
  { id: 'scratch', name: 'Scratch', emoji: '💿', make: () => render(1.3, o => {
    const src = vocalSrc(SR * 2); ramp(src, 0.02, 0.02);
    // baby scratches: adelante-atrás con velocidad de mano (sin^2) y fader cerrado en los cambios
    const n = Math.round(1.25 * SR), pos = new Float32Array(n), gate = new Float32Array(n), strokes = [0.14, 0.14, 0.09, 0.09, 0.09, 0.09, 0.2, 0.2, 0.1, 0.1]; let i = 0, base = SR * 0.25, dir = 1;
    for (const d of strokes) { const len = Math.round(d * SR), dist = SR * 0.22 * (d / 0.14); for (let k = 0; k < len && i < n; k++, i++) { const u = k / len; pos[i] = base + dir * dist * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)); gate[i] = Math.min(1, Math.sin(Math.PI * u) * 4); } base += dir * dist; dir = -dir; }
    const y = readVar(src, pos.subarray(0, i)); for (let k = 0; k < y.length; k++) y[k] *= gate[k]; norm(y, 0.8); ramp(y, 0.003, 0.02);
    const hp = o.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120; const s = o.createBufferSource(); s.buffer = bufFrom(o, y); s.connect(hp).connect(o.destination); s.start();
  }) },
  { id: 'impacto', name: 'Impacto', emoji: '💥', make: () => render(3.2, o => {
    const room = withRoom(o, 2.8, 0.45, 0.7);
    const osc = o.createOscillator(); osc.frequency.setValueAtTime(150, 0); osc.frequency.exponentialRampToValueAtTime(38, 0.5); const g = o.createGain(); env(o, g, 0, 0.002, 0.12, 1.6, 0.9); osc.connect(g).connect(o.destination); osc.start();
    const nz = noise(o, 2.5); const lp = o.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(9000, 0); lp.frequency.exponentialRampToValueAtTime(200, 1.4); const ng = o.createGain(); env(o, ng, 0, 0.001, 0.03, 1.4, 0.7); nz.connect(lp).connect(ng).connect(room); nz.start();
    [97, 163, 241, 317].forEach(f => { const m = o.createOscillator(); m.type = 'triangle'; m.frequency.value = f; const mg = o.createGain(); env(o, mg, 0, 0.001, 0.01, 0.9, 0.08); m.connect(mg).connect(room); m.start(); });
  }) },
  { id: 'riser', name: 'Subida', emoji: '🚀', make: () => render(4, o => {
    const n = noise(o, 4); const bp = o.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(9000, 3.9); const g = o.createGain(); g.gain.setValueAtTime(0.05, 0); g.gain.exponentialRampToValueAtTime(0.8, 3.9); g.gain.linearRampToValueAtTime(0, 4);
    n.connect(bp).connect(g).connect(o.destination); n.start();
    [110, 110.7, 165].forEach(f => { const osc = o.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f, 0); osc.frequency.exponentialRampToValueAtTime(f * 8, 3.9); const og = o.createGain(); og.gain.setValueAtTime(0.01, 0); og.gain.exponentialRampToValueAtTime(0.08, 3.9); og.gain.linearRampToValueAtTime(0, 4); osc.connect(og).connect(o.destination); osc.start(); });
  }) },
  { id: 'disparo', name: 'Disparo FX', emoji: '🔫', make: () => render(2.6, o => {
    const room = withRoom(o, 2.4, 0.5, 0.6);
    [0, 0.16, 0.32].forEach(t => { const nz = noise(o, 0.4); const hp = o.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900; const ng = o.createGain(); env(o, ng, t, 0.0005, 0.004, 0.12, 0.9); nz.connect(hp).connect(ng).connect(room); nz.start(t);
      const th = o.createOscillator(); th.frequency.setValueAtTime(180, t); th.frequency.exponentialRampToValueAtTime(45, t + 0.15); const tg = o.createGain(); env(o, tg, t, 0.001, 0.01, 0.2, 0.7); th.connect(tg).connect(room); th.start(t); th.stop(t + 0.4); });
  }) },
  { id: 'bassdrop', name: 'Bass drop', emoji: '🔊', make: () => render(2.6, o => {
    const osc = o.createOscillator(); osc.frequency.setValueAtTime(180, 0); osc.frequency.exponentialRampToValueAtTime(38, 1.8); const sh = o.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) c[i] = Math.tanh((i / 512 - 1) * 1.8); sh.curve = c; sh.oversample = '4x';
    const g = o.createGain(); env(o, g, 0, 0.004, 0.3, 2.1, 0.75); osc.connect(sh).connect(g).connect(o.destination); osc.start();
    const ck = noise(o, 0.05); const cg = o.createGain(); env(o, cg, 0, 0.0005, 0.003, 0.03, 0.4); const hp = o.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000; ck.connect(hp).connect(cg).connect(o.destination); ck.start();
  }) },
  { id: 'revcym', name: 'Platillo rev.', emoji: '🥁', make: () => render(2.6, o => {
    const L = cymbal(Math.round(2.5 * SR)), R = cymbal(Math.round(2.5 * SR)); L.reverse(); R.reverse(); norm(L, 0.6); norm(R, 0.6); ramp(L, 0.01, 0.004); ramp(R, 0.01, 0.004);
    const s = o.createBufferSource(); s.buffer = bufFrom(o, L, R); s.connect(o.destination); s.start();
  }) },
  { id: 'laser', name: 'Láser', emoji: '⚡', make: () => render(1.2, o => {
    const room = withRoom(o, 1, 0.25);
    [0, 0.18, 0.36].forEach(t => { const osc = o.createOscillator(); osc.type = 'square'; osc.frequency.setValueAtTime(2400, t); osc.frequency.exponentialRampToValueAtTime(120, t + 0.25); const lp = o.createBiquadFilter(); lp.frequency.value = 5000; const g = o.createGain(); env(o, g, t, 0.002, 0.05, 0.2, 0.25); osc.connect(lp).connect(g).connect(room); osc.start(t); osc.stop(t + 0.3); });
  }) },
  { id: 'trompeta', name: 'Trompetas', emoji: '🎺', make: () => render(2.2, o => {
    const room = withRoom(o, 1.6, 0.3);
    [[392, 0, 0.18], [392, 0.2, 0.18], [392, 0.4, 0.18], [523.25, 0.6, 1.1]].forEach(([f, t, d]) => {
      [f, f * 1.004, f * 0.997, f * 2].forEach((ff, j) => { const osc = o.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = ff; const vib = o.createOscillator(); vib.frequency.value = 5.5; const vg = o.createGain(); vg.gain.value = t > 0.5 ? 4 : 0; vib.connect(vg).connect(osc.frequency);
        const lp = o.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(600, t); lp.frequency.linearRampToValueAtTime(3200, t + 0.06); lp.Q.value = 2; const g = o.createGain(); env(o, g, t, 0.03, d - 0.08, 0.12, j === 3 ? 0.05 : 0.15);
        const p = o.createStereoPanner(); p.pan.value = [-0.4, 0.4, 0, 0][j]; osc.connect(lp).connect(g).connect(p).connect(room); osc.start(t); vib.start(t); osc.stop(t + d + 0.2); vib.stop(t + d + 0.2); });
    });
  }) },
];
export const NPADS = BUILTIN.length;
// Nivela los pads sintetizados al mismo volumen que las grabaciones (RMS ≈ -18 dBFS, pico ≤ -1 dBFS)
function levelPad(buf, rmsDb = -18, peakLin = 0.89) { let pk = 0, ss = 0, n = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i]; ss += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); } n += d.length; }
  const rms = Math.sqrt(ss / Math.max(1, n)); if (!pk) return buf; const g = Math.min(Math.pow(10, rmsDb / 20) / rms, peakLin / pk); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; } return buf; }
const makePad = async i => { const b = await BUILTIN[i].make(); return BUILTIN[i].real ? b : levelPad(b); };
// Fundido de 3 ms al final de muestras propias para que no truenen al terminar
function fadeEdges(buf) { const n = Math.min(buf.length, Math.round(buf.sampleRate * 0.003)); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n; } return buf; }
export const PAD_DEFAULT = { gain: 0.8, reverb: 0.15, delay: 0, delayTime: 0.25, low: 0, mid: 0, high: 0, choke: false, start: 0, end: 0, norm: 1 };
export const PAD_COLORS = ['#ff2bd6', '#ffd23f', '#ff9f1c', '#ff3b5c', '#3d7bff', '#00e5ff', '#b04dff', '#39ff88', '#ff6b00', '#e0e0ff', '#ff2b5c', '#00ffd0', '#ffe600', '#ff4040', '#7a5cff', '#00b3ff'];
export const MAX_PADS = 64, MAX_PAD_SEC = 60;

function makeIR(ctx, sec = 2.2) { const len = Math.floor(ctx.sampleRate * sec); const b = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); } return b; }

// Nivel de pads propios: -14 LUFS (como las grabaciones CC0), pico ≤ -1 dBFS; si el sonido es muy corto para medir LUFS, usa RMS
function padNorm(buf, start, end) {
  const sr = buf.sampleRate, a = Math.floor(start * sr), b = Math.min(buf.length, end > start ? Math.floor(end * sr) : buf.length);
  const ch = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(buf.getChannelData(c).subarray(a, b));
  let pk = 0, ss = 0; for (const d of ch) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; ss += v * v; }
  if (!pk) return 1; let lufs = -Infinity; try { if (b - a > sr * 0.5) lufs = integratedLoudness(ch, sr).lufs; } catch (e) {}
  const lv = isFinite(lufs) ? lufs : 20 * Math.log10(Math.sqrt(ss / (ch.length * (b - a))) + 1e-9) + 1;
  return Math.min(Math.pow(10, (-14 - lv) / 20), 0.89 / pk, 16);
}
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const KEEP = ['uid', 'src', 'name', 'emoji', 'color', 'gain', 'reverb', 'delay', 'delayTime', 'low', 'mid', 'high', 'choke', 'start', 'end', 'norm', 'license'];
function defaults() { return BUILTIN.map((b, i) => ({ uid: b.id, src: 'builtin:' + b.id, name: b.name, emoji: b.emoji, color: PAD_COLORS[i % 16], license: 'cc0', ...PAD_DEFAULT, reverb: b.reverb ?? PAD_DEFAULT.reverb })); }

export class Sampler {
  constructor(eng) {
    this.eng = eng; const c = eng.ctx;
    this.bus = c.createGain(); this.bus.gain.value = 0.9; this.bus.connect(eng.masterIn); // → EQ maestro → limitador
    this.rev = c.createConvolver(); this.rev.buffer = makeIR(c); this.revRet = c.createGain(); this.revRet.gain.value = 0.8; this.rev.connect(this.revRet).connect(this.bus);
    let cfg = settings.get('padsV3', null);
    if (!cfg) { // migración: pads propios de versiones anteriores
      cfg = defaults(); const old = settings.get('pads16', null) || settings.get('pads', []);
      (old || []).forEach((o, i) => { if (o && cfg[i]) { Object.assign(cfg[i], { gain: o.gain ?? cfg[i].gain, reverb: o.reverb ?? cfg[i].reverb, delay: o.delay || 0, delayTime: o.delayTime || 0.25, low: o.low || 0, mid: o.mid || 0, high: o.high || 0, choke: !!o.choke }); if (o.custom) Object.assign(cfg[i], { src: 'legacy:pad' + i, name: o.name || 'Muestra', emoji: '🎵', license: o.license || 'desconocida' }); } });
    }
    this.pads = cfg.map(p => this._nodes({ ...PAD_DEFAULT, ...p }));
  }
  _nodes(p) {
    const c = this.eng.ctx; p.buffer = p.buffer || null; p.voices = new Set();
    p.g = c.createGain(); p.lo = c.createBiquadFilter(); p.lo.type = 'lowshelf'; p.lo.frequency.value = 250; p.mi = c.createBiquadFilter(); p.mi.type = 'peaking'; p.mi.frequency.value = 1200; p.hi = c.createBiquadFilter(); p.hi.type = 'highshelf'; p.hi.frequency.value = 4000;
    p.rs = c.createGain(); p.ds = c.createGain(); p.d = c.createDelay(2); p.dfb = c.createGain(); p.dfb.gain.value = 0.4;
    p.g.connect(p.lo).connect(p.mi).connect(p.hi); p.hi.connect(this.bus); p.hi.connect(p.rs).connect(this.rev); p.hi.connect(p.ds).connect(p.d); p.d.connect(p.dfb).connect(p.d); p.d.connect(this.bus);
    this._apply(p); return p;
  }
  _apply(p) { const t = this.eng.t(); p.g.gain.setTargetAtTime(p.gain * (p.norm || 1), t, 0.01); p.rs.gain.setTargetAtTime(p.reverb, t, 0.01); p.ds.gain.setTargetAtTime(p.delay, t, 0.01); p.d.delayTime.setTargetAtTime(p.delayTime, t, 0.01); p.lo.gain.setTargetAtTime(p.low, t, 0.01); p.mi.gain.setTargetAtTime(p.mid, t, 0.01); p.hi.gain.setTargetAtTime(p.high, t, 0.01); }
  apply(i) { const p = typeof i === "object" ? i : this.pads[i]; if (p) this._apply(p); }
  save() { settings.set('padsV3', this.pads.map(p => Object.fromEntries(KEEP.map(k => [k, p[k]])))); }
  async _load(p) {
    if (p.src.startsWith('builtin:')) { const i = BUILTIN.findIndex(b => 'builtin:' + b.id === p.src); if (i >= 0) { p.buffer = await makePad(i); return; } }
    const key = p.src.startsWith('legacy:') ? p.src.slice(7) : p.src.slice(5); const blob = await idb.get('blobs', key);
    if (!blob) throw new Error('falta el audio del pad'); p.buffer = await this.decodeRetry(blob);
  }
  async init(onProgress) {
    for (let i = 0; i < this.pads.length; i++) { const p = this.pads[i]; try { await this._load(p); } catch (e) { console.warn('pad', p.name, e); p.err = e.message; } onProgress && onProgress(i); }
  }
  async decodeRetry(blob, tries = 3) {
    let last;
    for (let k = 0; k < tries; k++) {
      try { const ab = await blob.arrayBuffer(); return fadeEdges(await this.eng.ctx.decodeAudioData(ab)); }
      catch (e) { last = e; await new Promise(r => setTimeout(r, 300 * (k + 1))); }
    }
    throw last || new Error('no se pudo decodificar');
  }
  // Audio (o el audio de un video) → FLAC sin pérdida guardado en IndexedDB; máx. 60 s
  async _store(file) {
    let buf = await this.decodeRetry(file, 3); let cut = false;
    if (buf.duration > MAX_PAD_SEC) { const n = Math.floor(MAX_PAD_SEC * buf.sampleRate); const o = new AudioBuffer({ length: n, numberOfChannels: Math.min(2, buf.numberOfChannels), sampleRate: buf.sampleRate }); for (let c = 0; c < o.numberOfChannels; c++) o.copyToChannel(buf.getChannelData(c).subarray(0, n), c); buf = fadeEdges(o); cut = true; }
    const L = floatTo16(buf.getChannelData(0)), R = floatTo16(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0));
    const key = 'padblob-' + uid(); await idb.put('blobs', encodeFLAC([L, R], buf.sampleRate, { title: file.name }), key);
    return { buf, key, cut };
  }
  async addFromFile(file) {
    if (this.pads.length >= MAX_PADS) throw new Error('máximo ' + MAX_PADS + ' pads');
    const tags = /^video\//.test(file.type) ? {} : await readTags(file).catch(() => ({}));
    const { buf, key, cut } = await this._store(file);
    const i = this.pads.length;
    const p = this._nodes({ ...PAD_DEFAULT, uid: uid(), src: 'blob:' + key, name: (tags.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 22), emoji: /^video\//.test(file.type) ? '🎬' : '🎵', color: PAD_COLORS[i % 16], license: licenseStatus(tags), reverb: 0, buffer: buf });
    p.norm = padNorm(buf, 0, 0); this._apply(p); this.pads.push(p); this.save(); return { pad: p, cut };
  }
  async loadCustom(i, file) { // reemplaza el sonido de un pad existente
    const tags = /^video\//.test(file.type) ? {} : await readTags(file).catch(() => ({}));
    const { buf, key } = await this._store(file); const p = this.pads[i]; await this._dropBlob(p);
    Object.assign(p, { buffer: buf, src: 'blob:' + key, name: (tags.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 22), emoji: '🎵', license: licenseStatus(tags), start: 0, end: 0 });
    p.norm = padNorm(buf, 0, 0); this._apply(p); this.save(); return { license: p.license, tags };
  }
  async _dropBlob(p) { if (p.src.startsWith('blob:')) await idb.del('blobs', p.src.slice(5)); else if (p.src.startsWith('legacy:')) await idb.del('blobs', p.src.slice(7)); }
  async remove(i) { const p = this.pads[i]; this._silence(p); await this._dropBlob(p); setTimeout(() => { try { p.g.disconnect(); p.hi.disconnect(); p.d.disconnect(); } catch (e) {} }, 100); this.pads.splice(i, 1); this.save(); }
  move(i, dir) { const j = i + dir; if (j < 0 || j >= this.pads.length) return false; [this.pads[i], this.pads[j]] = [this.pads[j], this.pads[i]]; this.save(); return true; }
  setTrim(i, start, end) { const p = this.pads[i]; if (!p.buffer) return; p.start = Math.max(0, Math.min(start, p.buffer.duration - 0.02)); p.end = end > p.start + 0.02 && end < p.buffer.duration ? end : 0; if (!p.src.startsWith('builtin:')) p.norm = padNorm(p.buffer, p.start, p.end); this._apply(p); this.save(); }
  async resetPad(i) { // vuelve al sonido de fábrica (si el pad es de fábrica)
    const p = this.pads[i], b = BUILTIN.find(x => x.id === p.uid); if (!b) return false;
    await this._dropBlob(p); Object.assign(p, { src: 'builtin:' + b.id, name: b.name, emoji: b.emoji, license: 'cc0', start: 0, end: 0, norm: 1 }); await this._load(p); this._apply(p); this.save(); return true;
  }
  async resetAll() {
    this.stopAll(); for (const p of this.pads) { await this._dropBlob(p); try { p.g.disconnect(); p.hi.disconnect(); p.d.disconnect(); } catch (e) {} }
    this.pads = defaults().map(p => this._nodes(p)); this.save(); await this.init();
  }
  _silence(p) { const t = this.eng.t(); for (const v of p.voices) { try { v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.linearRampToValueAtTime(0, t + 0.015); v.s.stop(t + 0.02); } catch (e) {} } }
  stopAll() { for (const p of this.pads) this._silence(p); } // fundido de 15 ms (sin clic)
  trigger(i, vel = 1) {
    const p = this.pads[i]; if (!p || !p.buffer) return false;
    this.eng.resume();
    const c = this.eng.ctx, t = this.eng.t();
    if (p.choke && p.src_) { const og = p.vg; og.gain.cancelScheduledValues(t); og.gain.setValueAtTime(og.gain.value, t); og.gain.linearRampToValueAtTime(0, t + 0.006); try { p.src_.stop(t + 0.01); } catch (e) {} }
    const s = c.createBufferSource(); s.buffer = p.buffer; const vg = c.createGain(); vg.gain.value = 0;
    const st = p.start || 0, en = p.end > st ? p.end : p.buffer.duration, dur = en - st;
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(vel, t + 0.002); // ataque de 2 ms
    if (p.end > st) { vg.gain.setValueAtTime(vel, t + Math.max(0.003, dur - 0.006)); vg.gain.linearRampToValueAtTime(0, t + dur); } // fundido de 6 ms en el recorte final
    s.connect(vg).connect(p.g); s.start(t, st, dur + 0.01); p.src_ = s; p.vg = vg; const voice = { s, g: vg }; p.voices.add(voice); s.onended = () => { vg.disconnect(); p.voices.delete(voice); if (p.src_ === s) p.src_ = null; };
    return true;
  }
}
