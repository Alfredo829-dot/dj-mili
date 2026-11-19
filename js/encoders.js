// Codificadores WAV (PCM 16 bits + LIST/INFO) y FLAC (16 bits, predictor fijo + Rice) en JS puro.
const te = new TextEncoder();

export function floatTo16(f32) {
  const o = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { let s = f32[i]; s = s < -1 ? -1 : s > 1 ? 1 : s; o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return o;
}

// meta: {title, user, date, tags, comment, software, copyright}
export function encodeWAV(chans, sampleRate, meta = {}) {
  const nch = chans.length, n = chans[0].length;
  const info = [['INAM', meta.title], ['IART', meta.user], ['ICRD', meta.date], ['IKEY', meta.tags], ['ICMT', meta.comment], ['ISFT', meta.software || 'DJ Mili'], ['ICOP', meta.copyright], ['IGNR', meta.genre]]
    .filter(x => x[1]).map(([id, v]) => { const b = te.encode(String(v) + '\0'); return { id, b, pad: b.length & 1 }; });
  const listSize = 4 + info.reduce((a, x) => a + 8 + x.b.length + x.pad, 0);
  const dataSize = n * nch * 2;
  const total = 12 + 24 + (info.length ? 8 + listSize : 0) + 8 + dataSize;
  const buf = new ArrayBuffer(total), v = new DataView(buf), u8 = new Uint8Array(buf);
  let p = 0;
  const str = s => { for (let i = 0; i < 4; i++) v.setUint8(p++, s.charCodeAt(i)); };
  const u32 = x => { v.setUint32(p, x, true); p += 4; }, u16 = x => { v.setUint16(p, x, true); p += 2; };
  str('RIFF'); u32(total - 8); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(nch); u32(sampleRate); u32(sampleRate * nch * 2); u16(nch * 2); u16(16);
  if (info.length) {
    str('LIST'); u32(listSize); str('INFO');
    for (const x of info) { str(x.id); u32(x.b.length); u8.set(x.b, p); p += x.b.length; if (x.pad) u8[p++] = 0; }
  }
  str('data'); u32(dataSize);
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) { v.setInt16(p, chans[c][i], true); p += 2; }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- FLAC ----------
class BitWriter {
  constructor(cap = 1 << 16) { this.buf = new Uint8Array(cap); this.pos = 0; this.acc = 0; this.nbits = 0; }
  ensure(n) { if (this.pos + n + 8 > this.buf.length) { let c = this.buf.length * 2; while (c < this.pos + n + 8) c *= 2; const b = new Uint8Array(c); b.set(this.buf.subarray(0, this.pos)); this.buf = b; } }
  write(val, bits) { // bits <= 32
    if (bits > 24) { this.write(Math.floor(val / 65536) & 0xffff >>> 0, bits - 16); this.write(val & 0xffff, 16); return; }
    this.ensure(4);
    this.acc = (this.acc << bits) | (val & ((1 << bits) - 1)); this.nbits += bits;
    while (this.nbits >= 8) { this.nbits -= 8; this.buf[this.pos++] = (this.acc >>> this.nbits) & 0xff; }
    this.acc &= (1 << this.nbits) - 1;
  }
  zeros(n) { while (n >= 24) { this.write(0, 24); n -= 24; } if (n) this.write(0, n); }
  align() { if (this.nbits) this.write(0, 8 - this.nbits); }
  bytes() { return this.buf.subarray(0, this.pos); }
}
const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i; for (let j = 0; j < 8; j++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; CRC8[i] = c;
  let d = i << 8; for (let j = 0; j < 8; j++) d = (d & 0x8000) ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff; CRC16[i] = d;
}
const crc8 = (b, s, e) => { let c = 0; for (let i = s; i < e; i++) c = CRC8[c ^ b[i]]; return c; };
const crc16 = (b, s, e) => { let c = 0; for (let i = s; i < e; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };

function residuals(x, order, out) {
  const n = x.length;
  for (let i = order; i < n; i++) {
    let r;
    switch (order) {
      case 0: r = x[i]; break;
      case 1: r = x[i] - x[i - 1]; break;
      case 2: r = x[i] - 2 * x[i - 1] + x[i - 2]; break;
      case 3: r = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
      default: r = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
    }
    out[i] = r;
  }
}
function riceCost(res, s, e, k) { let bits = 0; for (let i = s; i < e; i++) { const r = res[i]; const u = r >= 0 ? r * 2 : -r * 2 - 1; bits += (u >>> k) + 1 + k; } return bits; }
function bestK(res, s, e) {
  let sum = 0; for (let i = s; i < e; i++) { const r = res[i]; sum += r >= 0 ? r * 2 : -r * 2 - 1; }
  const m = e > s ? sum / (e - s) : 0;
  let k0 = m > 1 ? Math.min(14, Math.floor(Math.log2(m))) : 0;
  let best = k0, bc = riceCost(res, s, e, k0);
  for (const k of [k0 - 1, k0 + 1]) if (k >= 0 && k <= 14) { const c = riceCost(res, s, e, k); if (c < bc) { bc = c; best = k; } }
  return [best, bc];
}
function writeSubframe(bw, x, bps) {
  const n = x.length;
  let allSame = true; for (let i = 1; i < n; i++) if (x[i] !== x[0]) { allSame = false; break; }
  if (allSame) { bw.write(0, 8); bw.write(x[0] & 0xffff, bps); return; }
  const maxOrder = Math.min(4, n - 1);
  let best = null;
  const res = new Int32Array(n);
  for (let order = 0; order <= maxOrder; order++) {
    residuals(x, order, res);
    // elegir orden de partición
    for (let po = 0; po <= 6; po++) {
      if (n % (1 << po)) break;
      const ps = n >> po; if (ps <= order) break;
      let cost = 0; const ks = [];
      for (let p = 0; p < (1 << po); p++) { const s = p === 0 ? order : p * ps, e = (p + 1) * ps; const [k, c] = bestK(res, s, e); ks.push(k); cost += c + 4; }
      cost += order * bps;
      if (!best || cost < best.cost) best = { cost, order, po, ks, res: res.slice() };
    }
  }
  if (best.cost >= n * bps) { // verbatim
    bw.write(0x02, 8); for (let i = 0; i < n; i++) bw.write(x[i] & 0xffff, bps); return;
  }
  const { order, po, ks, res: r } = best;
  bw.write((0x08 | order) << 1, 8); // 0 + 001xxx + wasted=0
  for (let i = 0; i < order; i++) bw.write(x[i] & 0xffff, bps);
  bw.write(0, 2); bw.write(po, 4);
  const ps = n >> po;
  for (let p = 0; p < (1 << po); p++) {
    const k = ks[p]; bw.write(k, 4);
    const s = p === 0 ? order : p * ps, e = (p + 1) * ps;
    for (let i = s; i < e; i++) {
      const v = r[i]; const u = v >= 0 ? v * 2 : -v * 2 - 1;
      const q = u >>> k; bw.zeros(q); bw.write(1, 1); if (k) bw.write(u & ((1 << k) - 1), k);
    }
  }
}
function utf8Num(bw, v) {
  if (v < 0x80) { bw.write(v, 8); return; }
  const bytes = []; let x = v; let nb = 2;
  while (x >= (1 << (5 * nb + 1))) nb++;
  for (let i = 0; i < nb - 1; i++) { bytes.unshift(0x80 | (x & 0x3f)); x = Math.floor(x / 64); }
  const lead = (0xff00 >> nb) & 0xff; bytes.unshift(lead | x);
  bytes.forEach(b => bw.write(b, 8));
}
export function encodeFLAC(chans, sampleRate, meta = {}, onProgress) {
  const nch = chans.length, n = chans[0].length, bps = 16, BS = 4096;
  const bw = new BitWriter(Math.max(1 << 16, n * nch));
  bw.write(0x664c6143, 32); // fLaC
  // STREAMINFO
  bw.write(0, 1); bw.write(0, 7); bw.write(34, 24);
  bw.write(BS, 16); bw.write(BS, 16); bw.write(0, 24); bw.write(0, 24);
  bw.write(sampleRate, 20); bw.write(nch - 1, 3); bw.write(bps - 1, 5);
  bw.write(Math.floor(n / 2 ** 32), 4); bw.write(n >>> 0, 32);
  for (let i = 0; i < 4; i++) bw.write(0, 32); // MD5 desconocido
  // VORBIS_COMMENT
  const vendor = te.encode('DJ Mili FLAC (JS)');
  const tags = [['TITLE', meta.title], ['ARTIST', meta.user], ['DATE', meta.date], ['COMMENT', meta.comment], ['KEYWORDS', meta.tags], ['GENRE', meta.genre], ['ENCODER', 'DJ Mili'], ['COPYRIGHT', meta.copyright]]
    .filter(x => x[1]).map(([k, v]) => te.encode(k + '=' + v));
  const vcLen = 4 + vendor.length + 4 + tags.reduce((a, t) => a + 4 + t.length, 0);
  bw.write(1, 1); bw.write(4, 7); bw.write(vcLen, 24);
  const le32 = x => { bw.write(x & 0xff, 8); bw.write((x >> 8) & 0xff, 8); bw.write((x >> 16) & 0xff, 8); bw.write((x >>> 24) & 0xff, 8); };
  le32(vendor.length); vendor.forEach(b => bw.write(b, 8)); le32(tags.length);
  tags.forEach(t => { le32(t.length); t.forEach(b => bw.write(b, 8)); });
  // Frames
  let frame = 0;
  for (let off = 0; off < n; off += BS, frame++) {
    const len = Math.min(BS, n - off);
    const start = bw.pos;
    bw.write(0xfff8, 16);
    const bsCode = len === 4096 ? 12 : 7;
    bw.write(bsCode, 4); bw.write(0, 4); // sample rate desde STREAMINFO
    bw.write(nch === 2 ? 1 : 0, 4); bw.write(4, 3); bw.write(0, 1);
    utf8Num(bw, frame);
    if (bsCode === 7) bw.write(len - 1, 16);
    bw.write(crc8(bw.buf, start, bw.pos), 8);
    for (let c = 0; c < nch; c++) writeSubframe(bw, chans[c].subarray(off, off + len), bps);
    bw.align();
    bw.write(crc16(bw.buf, start, bw.pos), 16);
    if (onProgress && frame % 64 === 0) onProgress(off / n);
  }
  return new Blob([bw.bytes().slice()], { type: 'audio/flac' });
}

// Lectura de metadatos simples (ID3v2 TIT2/TPE1, FLAC Vorbis, WAV INFO) para indexar y validar licencias
export async function readTags(file) {
  const out = {};
  try {
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 262144)).arrayBuffer());
    const td = new TextDecoder('utf-8'), td16 = new TextDecoder('utf-16'), tl = new TextDecoder('latin1');
    const s4 = (o) => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3]);
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) { // ID3
      const ver = head[3]; const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
      let p = 10; const end = Math.min(10 + size, head.length);
      while (p + 10 < end) {
        const id = s4(p); if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fs = ver === 4 ? (head[p + 4] << 21) | (head[p + 5] << 14) | (head[p + 6] << 7) | head[p + 7] : (head[p + 4] << 24) | (head[p + 5] << 16) | (head[p + 6] << 8) | head[p + 7];
        const body = head.subarray(p + 10, p + 10 + fs);
        if (id[0] === 'T' || id === 'COMM' || id === 'WCOP') {
          const enc = body[0]; let txt = body.subarray(1);
          if (id === 'COMM') txt = txt.subarray(3);
          let s = enc === 1 || enc === 2 ? td16.decode(txt) : enc === 3 ? td.decode(txt) : tl.decode(txt);
          s = s.replace(/\0+/g, ' ').trim();
          const map = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TBPM: 'bpm', TCON: 'genre', TCOP: 'copyright', COMM: 'comment', WCOP: 'license' };
          if (map[id]) out[map[id]] = s;
        }
        p += 10 + fs;
      }
    } else if (s4(0) === 'fLaC') {
      let p = 4, last = 0;
      while (!last && p + 4 < head.length) {
        last = head[p] & 0x80; const type = head[p] & 0x7f; const len = (head[p + 1] << 16) | (head[p + 2] << 8) | head[p + 3];
        if (type === 4) {
          const dv = new DataView(head.buffer, p + 4); let q = 0; const vl = dv.getUint32(q, true); q += 4 + vl; const cnt = dv.getUint32(q, true); q += 4;
          for (let i = 0; i < cnt && q < len; i++) { const l = dv.getUint32(q, true); q += 4; const kv = td.decode(head.subarray(p + 4 + q, p + 4 + q + l)); q += l; const eq = kv.indexOf('='); out[kv.slice(0, eq).toLowerCase()] = kv.slice(eq + 1); }
        }
        p += 4 + len;
      }
      if (out.license === undefined && out.copyright) out.license = out.copyright;
    } else if (s4(0) === 'RIFF' && s4(8) === 'WAVE') {
      let p = 12; const dv = new DataView(head.buffer);
      while (p + 8 < head.length) {
        const id = s4(p), sz = dv.getUint32(p + 4, true);
        if (id === 'LIST' && s4(p + 8) === 'INFO') {
          let q = p + 12;
          while (q + 8 < p + 8 + sz && q + 8 < head.length) { const sid = s4(q), ssz = dv.getUint32(q + 4, true); const val = td.decode(head.subarray(q + 8, q + 8 + ssz)).replace(/\0+$/, ''); const map = { INAM: 'title', IART: 'artist', ICOP: 'copyright', ICMT: 'comment', IKEY: 'tags', IGNR: 'genre', ICRD: 'date' }; if (map[sid]) out[map[sid]] = val; q += 8 + ssz + (ssz & 1); }
        }
        if (id === 'data') break;
        p += 8 + sz + (sz & 1);
      }
    }
  } catch (e) { console.warn('tags', e); }
  return out;
}
export function licenseStatus(tags) {
  const s = [tags.license, tags.copyright, tags.comment, tags.description, tags.tags, tags.licence].filter(Boolean).join(' ').toLowerCase();
  if (/\bcc0\b|creative commons zero|public domain|dominio p[uú]blico|publicdomain\/zero/.test(s)) return 'cc0';
  if (/creative commons|cc[- ]by/.test(s)) return 'cc';
  return 'desconocida';
}
