// AudioWorklets de DJ Mili: reproductor de deck (key lock WSOLA + remuestreo Hermite, sin clics)
// y limitador brickwall con lookahead (techo -1 dBFS) para la salida maestra.
const HS = 1024, N = 2048, T = 512, DEC = 8, XF = 256;
const WIN = new Float32Array(N); for (let n = 0; n < N; n++) WIN[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N);

function herm(x, p) {
  const i = Math.floor(p), f = p - i, n = x.length;
  if (i >= 1 && i + 2 < n) {
    const x0 = x[i]; if (f === 0) return x0;
    const xm1 = x[i - 1], x1 = x[i + 1], x2 = x[i + 2];
    const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }
  return i >= 0 && i < n ? x[i] : 0;
}

class DeckProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null; this.R = null; this.len = 0; this.m8 = null;
    this.playing = false; this.env = 0; this.envT = 0; this.envStep = 1 / Math.round(sampleRate * 0.005);
    this.when = 0; this.pos = 0; this.rate = 1; this.rateT = 1; this.auto = null;
    this.keylock = true; this.mode = 'rs'; this.loopS = -1; this.loopE = -1;
    this.voices = []; this.fadeIn = 0;
    this.oL = new Float32Array(N); this.oR = new Float32Array(N); this.eL = new Float32Array(HS); this.eR = new Float32Array(HS);
    this.eIdx = HS; this.apos = 0; this.prevStart = -1; this.frameA = 0; this.frameRate = 1; this.curA = 0;
    this.wsFade = 0; this.wl = 0; this.wr = 0;
    this.seq = 0; this.cnt = 0; this.ended = false;
    this.port.onmessage = e => this.msg(e.data);
  }
  msg(m) {
    if (m.seq !== undefined) this.seq = m.seq;
    switch (m.cmd) {
      case 'load': {
        this.L = m.L; this.R = m.R || m.L; this.len = this.L.length;
        const n8 = Math.floor(this.len / DEC); const a = new Float32Array(n8);
        for (let i = 0; i < n8; i++) { let s = 0; const b = i * DEC; for (let k = 0; k < DEC; k++) s += this.L[b + k] + this.R[b + k]; a[i] = s; }
        this.m8 = a; this.playing = false; this.env = 0; this.envT = 0; this.pos = 0; this.loopS = this.loopE = -1; this.voices = []; this.auto = null; this.ended = false; this.mode = 'rs';
        this.report(true); break;
      }
      case 'play': this.when = m.when || 0; if (!this.playing) { this.playing = true; this.env = 0; this.ended = false; this.mode = this.wantMode(); if (this.mode === 'ws') this.wsInit(this.pos); } this.envT = 1; break;
      case 'pause': this.envT = 0; break;
      case 'seek': {
        const t = Math.max(0, Math.min(this.len - 1, m.t * sampleRate));
        if (!this.playing || this.env === 0) { this.pos = t; if (this.mode === 'ws') this.wsInit(t); this.curA = t; this.report(true); }
        else this.jump(t);
        this.ended = false; break;
      }
      case 'rate': this.rateT = m.r; if (!m.glide) this.rate = m.r; break;
      case 'auto': this.auto = m.pts; break;
      case 'keylock': this.keylock = !!m.on; break;
      case 'loop': if (m.s === undefined || m.s === null) { this.loopS = this.loopE = -1; } else { this.loopS = m.s * sampleRate; this.loopE = m.e * sampleRate; } break;
      case 'stop': this.playing = false; this.env = 0; this.envT = 0; this.pos = 0; this.voices = []; this.report(true); break;
    }
  }
  wantMode() { return this.keylock && !this.auto ? 'ws' : 'rs'; }
  curPos() { return this.mode === 'ws' ? this.curA : this.pos; }
  report(force) { if (force || (++this.cnt & 3) === 0) this.port.postMessage({ p: this.curPos() / sampleRate, t: currentTime, pl: this.playing, r: this.rate, seq: this.seq, ws: this.mode === 'ws' }); }
  // ---- WSOLA ----
  wsInit(p) { this.apos = p; this.prevStart = -1; this.oL.fill(0); this.oR.fill(0); this.eIdx = HS; this.curA = p; }
  search(nat, ideal) {
    const m8 = this.m8, n8 = HS / DEC, len = this.len;
    if (nat < 0 || nat + N >= len || ideal - T < 0 || ideal + T + N >= len) return 0;
    const b8 = (nat / DEC) | 0; let best = -Infinity, bd = 0;
    for (let d = -T; d <= T; d += DEC) { const c8 = ((ideal + d) / DEC) | 0; let s = 0; for (let k = 0; k < n8; k++) s += m8[b8 + k] * m8[c8 + k]; if (s > best) { best = s; bd = d; } }
    const L = this.L, R = this.R; best = -Infinity; let fd = bd;
    for (let d = bd - DEC + 1; d < bd + DEC; d++) { const c = ideal + d; let s = 0; for (let k = 0; k < HS; k += 2) s += (L[nat + k] + R[nat + k]) * (L[c + k] + R[c + k]); if (s > best) { best = s; fd = d; } }
    return fd;
  }
  genFrame() {
    if (this.loopE > 0 && this.apos >= this.loopE) this.apos = this.loopS + (this.apos - this.loopS) % (this.loopE - this.loopS);
    const ideal = Math.round(this.apos);
    let start = ideal;
    if (this.prevStart >= 0) {
      const nat = this.prevStart + HS;
      // a velocidad 1 y sin salto: continuación natural = salida idéntica al original (bit a bit)
      if (Math.abs(this.rate - 1) < 1e-4 && Math.abs(nat - ideal) <= T) { start = nat; this.apos = nat; }
      else start = ideal + this.search(nat, ideal);
    }
    const L = this.L, R = this.R, oL = this.oL, oR = this.oR, len = this.len;
    if (start >= 0 && start + N <= len) { for (let n = 0; n < N; n++) { const w = WIN[n]; oL[n] += w * L[start + n]; oR[n] += w * R[start + n]; } }
    else for (let n = 0; n < N; n++) { const j = start + n; if (j >= 0 && j < len) { oL[n] += WIN[n] * L[j]; oR[n] += WIN[n] * R[j]; } }
    this.eL.set(oL.subarray(0, HS)); this.eR.set(oR.subarray(0, HS));
    oL.copyWithin(0, HS); oR.copyWithin(0, HS); oL.fill(0, HS); oR.fill(0, HS);
    this.eIdx = 0; this.frameA = this.apos; this.frameRate = this.rate; this.prevStart = start; this.apos += HS * this.rate;
  }
  wsNext() { if (this.eIdx >= HS) this.genFrame(); this.wl = this.eL[this.eIdx]; this.wr = this.eR[this.eIdx]; this.curA = this.frameA + this.eIdx * this.frameRate; this.eIdx++; }
  // ---- saltos sin clic ----
  jump(t) {
    if (this.mode === 'ws') { this.apos = t; this.prevStart = -1; return; } // la cola Hann del cuadro anterior + el nuevo cuadro = crossfade de 21 ms
    if (this.voices.length > 3) this.voices.shift();
    this.voices.push({ p: this.pos, r: this.rate, i: 0, n: XF }); this.pos = t; this.fadeIn = XF;
  }
  switchMode(to) {
    if (to === 'ws') { this.voices.push({ p: this.pos, r: this.rate, i: 0, n: HS }); this.wsInit(this.pos); }
    else { this.pos = this.curA; this.wsFade = XF; this.fadeIn = XF; }
    this.mode = to;
  }
  process(_, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
    if (!this.L || !this.playing) { this.report(false); return true; }
    // automatización de velocidad (freno / scratch)
    if (this.auto) {
      const pts = this.auto, t = currentTime; let v = pts[pts.length - 1][1];
      if (t >= pts[pts.length - 1][0]) { this.auto = null; this.rate = v; this.rateT = v; this.port.postMessage({ ev: 'autoDone', seq: this.seq }); }
      else { for (let k = 1; k < pts.length; k++) if (t < pts[k][0]) { const a = pts[k - 1], b = pts[k]; v = t <= a[0] ? a[1] : a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); break; } this.rate = v; }
    } else this.rate += (this.rateT - this.rate) * 0.35;
    const want = this.wantMode(); if (want !== this.mode && this.rate > 0.02) this.switchMode(want);
    let i0 = 0;
    if (this.when > currentTime) { i0 = Math.round((this.when - currentTime) * sampleRate); if (i0 >= n) { this.report(false); return true; } }
    const L = this.L, R = this.R, len = this.len, rate = this.rate, step = this.envStep;
    for (let i = i0; i < n; i++) {
      let l = 0, r = 0;
      if (this.mode === 'ws') { this.wsNext(); l = this.wl; r = this.wr; }
      else {
        if (this.wsFade > 0) { this.wsNext(); const g = 0.5 + 0.5 * Math.cos(Math.PI * (XF - this.wsFade) / XF); l += this.wl * g; r += this.wr * g; this.wsFade--; }
        if (this.loopE > 0 && this.pos >= this.loopE) this.jump(this.loopS + (this.pos - this.loopS) % (this.loopE - this.loopS));
        let sl = herm(L, this.pos), sr = herm(R, this.pos);
        if (this.fadeIn > 0) { const g = 0.5 - 0.5 * Math.cos(Math.PI * (XF - this.fadeIn) / XF); sl *= g; sr *= g; this.fadeIn--; }
        l += sl; r += sr; this.pos += rate;
      }
      for (let v = this.voices.length - 1; v >= 0; v--) { const vo = this.voices[v]; const g = 0.5 + 0.5 * Math.cos(Math.PI * vo.i / vo.n); l += herm(L, vo.p) * g; r += herm(R, vo.p) * g; vo.p += vo.r; if (++vo.i >= vo.n) this.voices.splice(v, 1); }
      // envolvente play/pausa (5 ms)
      if (this.env !== this.envT) { this.env += this.env < this.envT ? step : -step; if (this.env > 1) this.env = 1; if (this.env < 0) this.env = 0; if (Math.abs(this.env - this.envT) < step / 2) this.env = this.envT; }
      // fundido de 5 ms al llegar al final de la pista
      const rem = (len - 1 - this.curPos()) / (rate > 0.05 ? rate : 0.05); const eg = rem < 240 ? (rem > 0 ? rem / 240 : 0) : 1;
      oL[i] = l * this.env * eg; oR[i] = r * this.env * eg;
      if (this.env === 0 && this.envT === 0) { this.playing = false; this.pos = this.curPos(); for (let k = i + 1; k < n; k++) { oL[k] = 0; oR[k] = 0; } this.report(true); return true; }
      if (this.curPos() >= len - 1) { this.playing = false; this.ended = true; this.pos = len - 1; for (let k = i + 1; k < n; k++) { oL[k] = 0; oR[k] = 0; } this.port.postMessage({ ev: 'ended', seq: this.seq }); this.report(true); return true; }
    }
    this.report(false);
    return true;
  }
}
registerProcessor('djm-deck', DeckProc);

class LimiterProc extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = (o && o.processorOptions) || {};
    this.ceil = Math.pow(10, (p.ceilingDb ?? -1) / 20);
    this.L = Math.max(1, Math.round((p.lookahead ?? 0.005) * sampleRate));
    this.rel = 1 - Math.exp(-1 / ((p.release ?? 0.12) * sampleRate));
    this.dl = new Float32Array(this.L); this.dr = new Float32Array(this.L); this.di = 0;
    this.box = new Float64Array(this.L); this.bi = 0; this.sum = this.L;  this.box.fill(1);
    const W = this.L + 1; this.cap = W + 2; this.qv = new Float32Array(this.cap); this.qi = new Float64Array(this.cap); this.qh = 0; this.qt = 0; this.W = W;
    this.env = 1; this.n = 0; this.minG = 1; this.cnt = 0; this.over = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
    const iL = inp && inp[0], iR = inp && (inp[1] || inp[0]);
    const ceil = this.ceil, L = this.L, cap = this.cap, qv = this.qv, qi = this.qi;
    for (let k = 0; k < n; k++) {
      const xl = iL ? iL[k] : 0, xr = iR ? iR[k] : 0;
      const pk = Math.max(xl < 0 ? -xl : xl, xr < 0 ? -xr : xr);
      const tg = pk > ceil ? ceil / pk : 1;
      while (this.qt !== this.qh && qv[(this.qt - 1 + cap) % cap] >= tg) this.qt = (this.qt - 1 + cap) % cap;
      qv[this.qt] = tg; qi[this.qt] = this.n; this.qt = (this.qt + 1) % cap;
      while (qi[this.qh] <= this.n - this.W) this.qh = (this.qh + 1) % cap;
      const m = qv[this.qh];
      this.env = m < this.env ? m : this.env + (m - this.env) * this.rel;
      this.sum += this.env - this.box[this.bi]; this.box[this.bi] = this.env; this.bi = (this.bi + 1) % L;
      const g = this.sum / L;
      let yl = this.dl[this.di] * g, yr = this.dr[this.di] * g; this.dl[this.di] = xl; this.dr[this.di] = xr; this.di = (this.di + 1) % L;
      if (yl > ceil * 1.000001 || yl < -ceil * 1.000001 || yr > ceil * 1.000001 || yr < -ceil * 1.000001) this.over++;
      if (yl > ceil) yl = ceil; else if (yl < -ceil) yl = -ceil; if (yr > ceil) yr = ceil; else if (yr < -ceil) yr = -ceil;
      oL[k] = yl; oR[k] = yr; if (g < this.minG) this.minG = g; this.n++;
    }
    if (++this.cnt % 16 === 0) { this.port.postMessage({ gr: 20 * Math.log10(this.minG), over: this.over }); this.minG = 1; }
    return true;
  }
}
registerProcessor('djm-limiter', LimiterProc);
