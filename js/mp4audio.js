// Extrae la pista de audio AAC de un MP4/MOV/M4V sin recodificar (copia exacta, empaquetada como ADTS .aac).
async function readU8(blob, s, e) { return new Uint8Array(await blob.slice(s, e).arrayBuffer()); }
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const typ = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
function* boxes(b, s, e) { let p = s; while (p + 8 <= e) { let size = u32(b, p); const t = typ(b, p + 4); let h = 8; if (size === 1) { size = u32(b, p + 8) * 2 ** 32 + u32(b, p + 12); h = 16; } else if (size === 0) size = e - p; if (size < h) return; yield { t, s: p, h: p + h, e: p + size }; p += size; } }
const child = (b, box, t) => { for (const c of boxes(b, box.h, box.e)) if (c.t === t) return c; return null; };
const path = (b, box, ...ts) => ts.reduce((x, t) => x && child(b, x, t), box);

export async function extractAAC(file, onProgress) {
  // 1) localizar moov leyendo solo cabeceras
  let p = 0, moov = null; const n = file.size;
  while (p + 8 <= n) { const h = await readU8(file, p, p + 16); let size = u32(h, 0); const t = typ(h, 4); if (size === 1) size = u32(h, 8) * 2 ** 32 + u32(h, 12); else if (size === 0) size = n - p; if (size < 8) break; if (t === 'moov') { moov = await readU8(file, p, p + size); break; } p += size; }
  if (!moov) throw new Error('MP4 sin moov');
  const root = { h: 8, e: moov.length };
  let trak = null;
  for (const t of boxes(moov, 8, moov.length)) if (t.t === 'trak') { const hd = path(moov, t, 'mdia', 'hdlr'); if (hd && typ(moov, hd.h + 8) === 'soun') { trak = t; break; } }
  if (!trak) throw new Error('El video no tiene pista de audio');
  const stbl = path(moov, trak, 'mdia', 'minf', 'stbl');
  const stsd = child(moov, stbl, 'stsd'); const entry = stsd.h + 8; const fmt = typ(moov, entry + 4);
  if (fmt !== 'mp4a') throw new Error('Audio ' + fmt + ' (solo se extrae AAC)');
  // esds dentro de mp4a (28 bytes de cabecera de muestra de audio)
  const mp4a = { h: entry + 8 + 28, e: entry + u32(moov, entry) };
  const esds = child(moov, mp4a, 'esds'); if (!esds) throw new Error('Sin esds');
  // buscar DecoderSpecificInfo (tag 0x05)
  let q = esds.h + 4, asc = null;
  const len = () => { let l = 0, c; do { c = moov[q++]; l = (l << 7) | (c & 0x7f); } while (c & 0x80); return l; };
  while (q < esds.e) { const tag = moov[q++]; const l = len(); if (tag === 0x03) { q += 3; continue; } if (tag === 0x04) { q += 13; continue; } if (tag === 0x05) { asc = moov.subarray(q, q + l); break; } q += l; }
  if (!asc) throw new Error('Sin configuración AAC');
  let aot = asc[0] >> 3, sfi = ((asc[0] & 7) << 1) | (asc[1] >> 7), ch = (asc[1] >> 3) & 0xf;
  if (aot === 5 || aot === 29) aot = 2; // HE-AAC: el núcleo es LC (SBR implícito)
  if (aot < 1 || aot > 4 || sfi > 12) throw new Error('Perfil AAC no soportado');
  const stsz = child(moov, stbl, 'stsz'), stsc = child(moov, stbl, 'stsc'), stco = child(moov, stbl, 'stco') || child(moov, stbl, 'co64');
  const fixed = u32(moov, stsz.h + 4), count = u32(moov, stsz.h + 8);
  const sizes = new Uint32Array(count); for (let i = 0; i < count; i++) sizes[i] = fixed || u32(moov, stsz.h + 12 + i * 4);
  const is64 = stco && typ(moov, stco.s + 4) === 'co64'; const nch = u32(moov, stco.h + 4);
  const chunkOff = new Float64Array(nch); for (let i = 0; i < nch; i++) chunkOff[i] = is64 ? u32(moov, stco.h + 8 + i * 8) * 2 ** 32 + u32(moov, stco.h + 12 + i * 8) : u32(moov, stco.h + 8 + i * 4);
  const ne = u32(moov, stsc.h + 4); const sc = []; for (let i = 0; i < ne; i++) sc.push([u32(moov, stsc.h + 8 + i * 12), u32(moov, stsc.h + 12 + i * 12)]);
  // offsets de cada muestra
  const offs = new Float64Array(count); let si = 0;
  for (let c = 0; c < nch && si < count; c++) { let k = sc.length - 1; while (k > 0 && sc[k][0] > c + 1) k--; const per = sc[k][1]; let o = chunkOff[c]; for (let j = 0; j < per && si < count; j++) { offs[si] = o; o += sizes[si]; si++; } }
  // 2) copiar muestras con cabecera ADTS, leyendo por ventanas de 8 MB
  const total = sizes.reduce((a, b) => a + b, 0) + 7 * count; const out = new Uint8Array(total); let w = 0;
  const WIN = 8 << 20; let ws = -1, we = -1, wb = null;
  for (let i = 0; i < count; i++) {
    const o = offs[i], sz = sizes[i];
    if (o < ws || o + sz > we) { ws = o; we = Math.min(n, o + Math.max(WIN, sz)); wb = await readU8(file, ws, we); if (onProgress) onProgress(i / count); }
    const fl = sz + 7;
    out[w] = 0xff; out[w + 1] = 0xf1; out[w + 2] = ((aot - 1) << 6) | (sfi << 2) | ((ch >> 2) & 1); out[w + 3] = ((ch & 3) << 6) | (fl >> 11);
    out[w + 4] = (fl >> 3) & 0xff; out[w + 5] = ((fl & 7) << 5) | 0x1f; out[w + 6] = 0xfc;
    out.set(wb.subarray(o - ws, o - ws + sz), w + 7); w += fl;
  }
  return new Blob([out], { type: 'audio/aac' });
}
