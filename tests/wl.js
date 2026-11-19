// Ejecuta los AudioWorklets en Node para medir calidad y rendimiento.
const fs = require('fs'), vm = require('vm');
const SR = 48000;
const ctx = { sampleRate: SR, currentTime: 0, procs: {}, Math, Float32Array, Float64Array, Infinity, console,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage: () => {}, onmessage: null }; } },
  registerProcessor(n, c) { ctx.procs[n] = c; } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync('/workspace/dj-mili/js/worklets.js', 'utf8'), ctx);
const Deck = ctx.procs['djm-deck'], Lim = ctx.procs['djm-limiter'];
function run(p, seconds, events = []) { // events: [time, fn]
  const n = Math.round(seconds * SR / 128), L = new Float32Array(n * 128), R = new Float32Array(n * 128);
  ctx.currentTime = 0; let ev = 0;
  for (let b = 0; b < n; b++) {
    const t = b * 128 / SR; ctx.currentTime = t;
    while (ev < events.length && events[ev][0] <= t) events[ev++][1]();
    const o = [new Float32Array(128), new Float32Array(128)]; p.process([], [o]); L.set(o[0], b * 128); R.set(o[1], b * 128);
  }
  return [L, R];
}
const send = (p, m) => p.msg(m);
const sine = (f, sec, a = 0.5) => { const x = new Float32Array(sec * SR); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / SR); return x; };
const save = (name, L) => fs.writeFileSync('/tmp/djtest/out/' + name + '.f32', Buffer.from(L.buffer));
const res = {};
// 1. key lock pitch
for (const [kl, name] of [[true, 'kl_on'], [false, 'kl_off']]) {
  const p = new Deck(); const s = sine(440, 20); send(p, { cmd: 'load', L: s, R: s }); send(p, { cmd: 'keylock', on: kl }); send(p, { cmd: 'rate', r: 1.08 }); send(p, { cmd: 'play' });
  const [L] = run(p, 4); save(name, L); res[name + '_pos'] = (p.curPos() / SR).toFixed(3);
}
// 2. ws rate 1 transparency
{ const p = new Deck(); const s = sine(440, 10); const noise = new Float32Array(10 * SR).map((_, i) => s[i] + 0.2 * Math.sin(2 * Math.PI * 97 * i / SR)); send(p, { cmd: 'load', L: noise, R: noise }); send(p, { cmd: 'keylock', on: true }); send(p, { cmd: 'play' });
  const [L] = run(p, 3); let err = 0, pk = 0; for (let i = 1024; i < L.length; i++) { err = Math.max(err, Math.abs(L[i] - noise[i])); } res.ws_rate1_maxerr_db = (20 * Math.log10(err + 1e-12)).toFixed(1); }
// 3. clicks: seeks + loops in both modes, plus naive reference
for (const kl of [false, true]) {
  const p = new Deck(); const s = sine(440, 30); send(p, { cmd: 'load', L: s, R: s }); send(p, { cmd: 'keylock', on: kl }); send(p, { cmd: 'play' });
  const evs = []; for (let k = 1; k <= 12; k++) evs.push([k * 0.37, () => send(p, { cmd: 'seek', t: 1 + Math.random() * 20 })]);
  evs.push([5, () => send(p, { cmd: 'loop', s: 6.0123, e: 6.5123 })]); evs.push([8, () => send(p, { cmd: 'loop' })]);
  evs.push([8.5, () => send(p, { cmd: 'pause' })]); evs.push([8.8, () => send(p, { cmd: 'play' })]);
  evs.push([9.3, () => send(p, { cmd: 'rate', r: 1.06, glide: true })]); evs.push([9.8, () => send(p, { cmd: 'keylock', on: !kl })]);
  const [L] = run(p, 10.5, evs); save('clicks_' + (kl ? 'ws' : 'rs'), L);
}
{ // naive: saltos duros sin fundido (como el motor anterior con BufferSource.stop/start)
  const s = sine(440, 30); const L = new Float32Array(10.5 * SR); let pos = 0, nextJ = 0.37 * SR, k = 0;
  for (let i = 0; i < L.length; i++) { if (i >= nextJ && k < 12) { pos = Math.floor((1 + Math.random() * 20) * SR); nextJ += 0.37 * SR; k++; } L[i] = s[pos++]; }
  save('clicks_naive', L);
}
// 4. limiter
{ const p = new Lim({ processorOptions: { ceilingDb: -1 } }); const n = 5 * SR; const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.6 * Math.sin(2 * Math.PI * 60 * i / SR) + ((i % SR) < 2000 ? 2.2 * Math.sin(2 * Math.PI * 3000 * i / SR) : 0) + ((i % 9000) === 0 ? 3 : 0);
  const out = new Float32Array(n); for (let b = 0; b < n / 128; b++) { const o = [new Float32Array(128), new Float32Array(128)]; const sl = x.subarray(b * 128, b * 128 + 128); p.process([[sl, sl]], [o]); out.set(o[0], b * 128); }
  let pk = 0, clamps = 0; for (const v of out) { pk = Math.max(pk, Math.abs(v)); } 
  // ¿cuántas muestras quedaron justo en el techo por el recorte de seguridad?
  const c = Math.pow(10, -1 / 20); for (const v of out) if (Math.abs(Math.abs(v) - c) < 1e-7) clamps++;
  res.limiter_in_peak_db = (20 * Math.log10(3.6)).toFixed(1); res.limiter_out_peak_db = (20 * Math.log10(pk)).toFixed(2); res.limiter_samples_over_ceiling_before_safety_clip = p.over; save('lim', out);
}
// 5. rendimiento (factor de tiempo real)
for (const [kl, nm] of [[true, 'ws'], [false, 'rs']]) { const p = new Deck(); const s = sine(440, 120); send(p, { cmd: 'load', L: s, R: s }); send(p, { cmd: 'keylock', on: kl }); send(p, { cmd: 'rate', r: 1.05 }); send(p, { cmd: 'play' }); const t0 = process.hrtime.bigint(); run(p, 60); const ms = Number(process.hrtime.bigint() - t0) / 1e6; res['cpu_' + nm + '_ms_per_60s'] = ms.toFixed(0) + ` (${(60000 / ms).toFixed(0)}x tiempo real)`; }
{ const p = new Lim({}); const x = new Float32Array(128).fill(0.5); const t0 = process.hrtime.bigint(); for (let b = 0; b < 60 * SR / 128; b++) p.process([[x, x]], [[new Float32Array(128), new Float32Array(128)]]); res.cpu_limiter_ms_per_60s = (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0); }
console.log(JSON.stringify(res, null, 1));
