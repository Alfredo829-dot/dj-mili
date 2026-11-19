// Pistas demo sintetizadas (autoría propia, CC0) para probar decks, BPM, tonalidad y automix sin descargar nada.
const SR = 44100;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export async function makeDemo({ bpm = 124, root = 57, minor = true, bars = 32 } = {}) {
  const beat = 60 / bpm, dur = bars * 4 * beat + 1;
  const o = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const out = o.createDynamicsCompressor(); out.threshold.value = -10; out.ratio.value = 4; const mg = o.createGain(); mg.gain.value = 0.8; out.connect(mg).connect(o.destination);
  const nb = o.createBuffer(1, SR, SR); const nd = nb.getChannelData(0); for (let i = 0; i < SR; i++) nd[i] = Math.random() * 2 - 1;
  const noise = (t, d, type, f, q, vol, pan = 0) => { const s = o.createBufferSource(); s.buffer = nb; const fl = o.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = o.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); const p = o.createStereoPanner(); p.pan.value = pan; s.connect(fl).connect(g).connect(p).connect(out); s.start(t, Math.random() * 0.5, d + 0.05); };
  const kick = t => { const s = o.createOscillator(); s.frequency.setValueAtTime(160, t); s.frequency.exponentialRampToValueAtTime(45, t + 0.12); const g = o.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); s.connect(g).connect(out); s.start(t); s.stop(t + 0.4); };
  const synth = (t, d, f, type, cut, vol, pan = 0) => { const s = o.createOscillator(); s.type = type; s.frequency.value = f; const fl = o.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(cut, t); fl.frequency.exponentialRampToValueAtTime(cut / 3, t + d); const g = o.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + d); const p = o.createStereoPanner(); p.pan.value = pan; s.connect(fl).connect(g).connect(p).connect(out); s.start(t); s.stop(t + d + 0.05); };
  const third = minor ? 3 : 4;
  const prog = minor ? [0, 8, 3, 10] : [0, 7, 9, 5]; // i-VI-III-VII / I-V-vi-IV
  for (let bar = 0; bar < bars; bar++) {
    const t0 = 0.05 + bar * 4 * beat; const breakdown = bar >= 20 && bar < 24; const intro = bar < 4;
    const deg = prog[bar % 4]; const r = root + deg;
    const isMinorChord = minor ? [0, 3].includes(deg) || deg === 5 : [9].includes(deg);
    const chord = [r, r + (isMinorChord ? 3 : 4), r + 7].map(n => n + 12);
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      if (!breakdown) kick(t);
      if (!intro) { noise(t + beat / 2, 0.05, 'highpass', 7000, 0.7, 0.25, 0.3); if (b % 2 === 1 && !breakdown) noise(t, 0.18, 'bandpass', 1500, 0.8, 0.5, -0.1); }
      if (!intro && !breakdown) synth(t + beat / 2, beat * 0.45, mtof(r - 12), 'sawtooth', 900, 0.35);
    }
    if (!intro) chord.forEach((n, i) => { synth(t0, beat * (breakdown ? 3.8 : 0.6), mtof(n), 'sawtooth', breakdown ? 2500 : 3500, 0.12, i - 1); synth(t0 + 2.5 * beat, beat * 0.5, mtof(n), 'square', 2000, breakdown ? 0 : 0.06, 1 - i); });
    // melodía simple en la escala
    const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    if (bar >= 8) for (let k = 0; k < 4; k++) { const n = root + 24 + scale[(bar * 3 + k * 2) % 7]; synth(t0 + k * beat + beat * 0.25, beat * 0.4, mtof(n), 'triangle', 5000, 0.09, 0.2); }
  }
  return o.startRendering();
}
