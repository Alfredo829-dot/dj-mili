// Detección de tonalidad (cromagrama + perfiles Krumhansl) y notación Camelot para mezcla armónica.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) { const a = i + j, b = a + len / 2; const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
}
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Camelot: mayor = B, menor = A
const CAM_MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAM_MIN = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
function corr(a, b) { const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12; let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db || 1); }
export async function detectKey(buffer) {
  const sr = 11025, start = buffer.duration > 100 ? 20 : 0, dur = Math.min(90, buffer.duration - start);
  const len = Math.floor(dur * sr); if (len < 4096 * 4) return null;
  const off = new OfflineAudioContext(1, len, sr); const s = off.createBufferSource(); s.buffer = buffer; s.connect(off.destination); s.start(0, start);
  const x = (await off.startRendering()).getChannelData(0);
  const N = 4096, hop = 4096, chroma = new Float64Array(12), win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const binPc = new Int8Array(N / 2).fill(-1), binW = new Float32Array(N / 2);
  for (let k = 1; k < N / 2; k++) { const f = k * sr / N; if (f < 55 || f > 2000) continue; const midi = 69 + 12 * Math.log2(f / 440); const r = Math.round(midi); if (Math.abs(midi - r) > 0.35) continue; binPc[k] = ((r % 12) + 12) % 12; binW[k] = 1 / Math.sqrt(f / 55); }
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let p = 0; p + N <= len; p += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[p + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const frame = new Float64Array(12); let tot = 0;
    for (let k = 1; k < N / 2; k++) if (binPc[k] >= 0) { const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * binW[k]; frame[binPc[k]] += m; tot += m; }
    if (tot > 0) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / tot;
    if (p % (hop * 8) === 0) await new Promise(r => setTimeout(r, 0));
  }
  let best = { r: -2 };
  for (let t = 0; t < 12; t++) {
    const rot = i => chroma[(i + t) % 12];
    const c = Array.from({ length: 12 }, (_, i) => rot(i));
    const rM = corr(c, MAJ), rm = corr(c, MIN);
    if (rM > best.r) best = { r: rM, tonic: t, minor: false };
    if (rm > best.r) best = { r: rm, tonic: t, minor: true };
  }
  const name = NOTES[best.tonic] + (best.minor ? 'm' : '');
  const camelot = (best.minor ? CAM_MIN[best.tonic] : CAM_MAJ[best.tonic]) + (best.minor ? 'A' : 'B');
  return { name, camelot, confidence: Math.round(best.r * 100) / 100 };
}
export function camelotCompatible(a, b) {
  if (!a || !b) return null;
  const na = parseInt(a), la = a.slice(-1), nb = parseInt(b), lb = b.slice(-1);
  if (a === b) return 'perfecta';
  if (la === lb && (Math.abs(na - nb) === 1 || Math.abs(na - nb) === 11)) return 'compatible';
  if (na === nb && la !== lb) return 'compatible (relativa)';
  if (la === lb && (Math.abs(na - nb) === 2 || Math.abs(na - nb) === 10)) return 'energía (+2)';
  return 'choca';
}
export function camelotNeighbors(c) {
  if (!c) return [];
  const n = parseInt(c), l = c.slice(-1); const w = x => ((x - 1 + 12) % 12) + 1;
  return [c, w(n + 1) + l, w(n - 1) + l, n + (l === 'A' ? 'B' : 'A')];
}
