// Sonoridad integrada ITU-R BS.1770-4 / EBU R128 (LUFS) con filtro K y compuertas absoluta (-70) y relativa (-10).
function kCoefs(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs); a0 = 1 + K / Q + K * K;
  const s2 = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [s1, s2];
}
// chans: Float32Array[]; devuelve { lufs, peak } (peak en dBFS de muestra)
export function integratedLoudness(chans, fs) {
  const [s1, s2] = kCoefs(fs), n = chans[0].length, step = Math.round(fs * 0.1), nSteps = Math.floor(n / step);
  const ms = new Float64Array(nSteps); let peak = 0;
  for (const x of chans) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0, w1 = 0, w2 = 0;
    for (let s = 0; s < nSteps; s++) {
      let acc = 0; const e = (s + 1) * step;
      for (let i = s * step; i < e; i++) {
        const v = x[i]; const av = v < 0 ? -v : v; if (av > peak) peak = av;
        const y = s1.b0 * v + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y;
        const z = s2.b0 * y + s2.b1 * z1 + s2.b2 * z2 - s2.a1 * w1 - s2.a2 * w2; z2 = z1; z1 = y; w2 = w1; w1 = z;
        acc += z * z;
      }
      ms[s] += acc;
    }
  }
  const blocks = []; for (let s = 0; s + 4 <= nSteps; s++) blocks.push((ms[s] + ms[s + 1] + ms[s + 2] + ms[s + 3]) / (4 * step));
  const L = z => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter(z => z > 0 && L(z) > -70); if (!abs.length) return { lufs: -70, peak: 20 * Math.log10(peak || 1e-9) };
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter(z => L(z) > rel);
  return { lufs: L(g.reduce((a, b) => a + b, 0) / g.length), peak: 20 * Math.log10(peak || 1e-9) };
}
export const TARGET_LUFS = -14;
// Sube como máximo +18 dB y no más de 9 dB por encima del pico (para no exprimir el limitador)
export function normGainDb(lufs, peakDb) { if (lufs === undefined || lufs <= -69) return 0; let g = TARGET_LUFS - lufs; if (peakDb !== undefined) g = Math.min(g, -1 - peakDb + 9); return Math.round(Math.max(-15, Math.min(18, g)) * 10) / 10; }
