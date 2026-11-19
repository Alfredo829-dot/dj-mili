// Worker: codifica PCM 16 bits a MP3 con LAME (lamejs, LGPL) sin bloquear la interfaz.
importScripts('../vendor/lame.min.js');
onmessage = e => {
  const { L, R, sampleRate, kbps } = e.data;
  const enc = new lamejs.Mp3Encoder(2, sampleRate, kbps); const parts = []; const B = 1152 * 20;
  for (let i = 0; i < L.length; i += B) {
    const b = enc.encodeBuffer(L.subarray(i, i + B), R.subarray(i, i + B)); if (b.length) parts.push(new Uint8Array(b.buffer, b.byteOffset, b.length).slice());
    if ((i / B) % 50 === 0) postMessage({ progress: i / L.length });
  }
  const f = enc.flush(); if (f.length) parts.push(new Uint8Array(f.buffer, f.byteOffset, f.length).slice());
  postMessage({ done: true, parts });
};
