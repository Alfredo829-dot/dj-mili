// Detección de BPM por análisis offline: envolvente de onsets (graves) + autocorrelación + fase del primer beat.
export async function detectBPM(buffer, { min = 70, max = 180 } = {}) {
  const sr = 11025;
  const maxDur = Math.min(buffer.duration, 90);
  const startAt = buffer.duration > 120 ? 30 : 0; // saltar intro en pistas largas
  const len = Math.floor(Math.min(maxDur, buffer.duration - startAt) * sr);
  if (len < sr * 4) return { bpm: 0, offset: 0, confidence: 0 };
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource(); src.buffer = buffer;
  const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
  const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30;
  src.connect(hp).connect(lp).connect(off.destination); src.start(0, startAt);
  const low = (await off.startRendering()).getChannelData(0);
  // también banda completa para hats/snares
  const off2 = new OfflineAudioContext(1, len, sr);
  const s2 = off2.createBufferSource(); s2.buffer = buffer; s2.connect(off2.destination); s2.start(0, startAt);
  const full = (await off2.startRendering()).getChannelData(0);
  const hop = 128, fps = sr / hop, frames = Math.floor(len / hop);
  const env = new Float32Array(frames);
  let prevL = 0, prevF = 0;
  for (let f = 0; f < frames; f++) {
    let eL = 0, eF = 0; const b = f * hop;
    for (let i = 0; i < hop; i++) { const a = low[b + i], c = full[b + i]; eL += a * a; eF += c * c; }
    eL = Math.sqrt(eL / hop); eF = Math.sqrt(eF / hop);
    env[f] = Math.max(0, eL - prevL) * 2 + Math.max(0, eF - prevF); prevL = eL; prevF = eF;
  }
  // normalizar y quitar media local
  const W = Math.round(fps * 0.5); const o = new Float32Array(frames);
  let acc = 0; for (let i = 0; i < frames; i++) { acc += env[i]; if (i >= W) acc -= env[i - W]; const m = acc / Math.min(i + 1, W); o[i] = Math.max(0, env[i] - m); }
  const minLag = Math.floor(fps * 60 / max), maxLag = Math.ceil(fps * 60 / min);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) { let s = 0; for (let i = 0; i + lag < frames; i++) s += o[i] * o[i + lag]; ac[lag] = s / (frames - lag); }
  // puntuación con armónicos (lag, 2*lag) para preferir el tempo base
  let best = 0, bestLag = minLag, total = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sc = ac[lag];
    const l2 = lag * 2; if (l2 < frames) { let s = 0; for (let i = 0; i + l2 < frames; i++) s += o[i] * o[i + l2]; sc += 0.5 * s / (frames - l2); }
    total += ac[lag];
    if (sc > best) { best = sc; bestLag = lag; }
  }
  // refinamiento parabólico
  const y0 = ac[bestLag - 1] || 0, y1 = ac[bestLag], y2 = ac[bestLag + 1] || 0;
  const d = (y0 - 2 * y1 + y2) !== 0 ? 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) : 0;
  const lagF = bestLag + Math.max(-0.5, Math.min(0.5, d));
  let bpm = 60 * fps / lagF;
  while (bpm < 85) bpm *= 2; while (bpm > 175) bpm /= 2;
  bpm = Math.round(bpm * 10) / 10;
  // refinamiento fino: peine de beats (tempo + fase) sobre todo el fragmento
  const comb = (b) => { const period = fps * 60 / b; let bs = -1, bp = 0; for (let ph = 0; ph < period; ph += 0.5) { let s = 0; for (let t = ph; t < frames; t += period) { const k = Math.round(t); s += (o[k] || 0) + 0.5 * ((o[k - 1] || 0) + (o[k + 1] || 0)); } if (s > bs) { bs = s; bp = ph; } } return [bs, bp]; };
  let fine = bpm, [bestS, bestPh] = comb(bpm);
  for (let b = bpm - 1.5; b <= bpm + 1.5; b += 0.02) { const [s, ph] = comb(b); if (s > bestS) { bestS = s; bestPh = ph; fine = b; } }
  const ri = Math.round(fine); const [si, phi] = comb(ri);
  if (si >= bestS * 0.985) { fine = ri; bestPh = phi; bestS = si; }
  bpm = Math.round(fine * 100) / 100;
  let offset = startAt + bestPh / fps; const beat = 60 / bpm;
  offset = offset % beat;
  const confidence = Math.min(1, best / ((total / (maxLag - minLag + 1)) * 3 || 1));
  return { bpm, offset, confidence: Math.round(confidence * 100) / 100 };
}
