// Reproductor normal (aparte de los decks): audio y video CON imagen, lista, anterior/siguiente, aleatorio, repetir.
// Cadena: <video> → volumen → Envolvente (M/S) → limitador -1 dBFS → salida. Contexto propio con latencyHint 'playback'.
import { Widener } from './widener.js';
const fmt = t => { if (!isFinite(t) || t < 0) t = 0; const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
export class Player {
  constructor({ video, getBlob, tracks, settings, audit, onState }) {
    Object.assign(this, { v: video, getBlob, tracksFn: tracks, settings, audit, onState });
    this.list = settings.get('plList', []); this.idx = settings.get('plIdx', 0); this.shuffle = settings.get('plShuf', false); this.repeat = settings.get('plRep', 'all');
    this.ctx = null; this.url = null; this.cur = null; this.order = null;
    this.v.addEventListener('ended', () => this.next(true));
    this.v.addEventListener('play', () => this._state()); this.v.addEventListener('pause', () => this._state());
    this.v.addEventListener('error', () => { this.audit('reproductor', 'error', (this.cur?.title || '') + ': no se pudo leer'); this._state('No se pudo reproducir este archivo'); });
    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession; const h = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) {} };
      h('play', () => this.toggle(true)); h('pause', () => this.toggle(false)); h('previoustrack', () => this.prev()); h('nexttrack', () => this.next());
      h('seekto', e => { this.v.currentTime = e.seekTime; });
    }
  }
  tracks() { return this.tracksFn(); }
  async ensureCtx(hd) {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.ctx = new AC(hd ? { latencyHint: 'playback', sampleRate: 48000 } : { latencyHint: 'playback' }); } catch (e) { this.ctx = new AC({ latencyHint: 'playback' }); }
    const c = this.ctx; await c.audioWorklet.addModule(new URL('./worklets.js?v=3', import.meta.url));
    this.src = c.createMediaElementSource(this.v); this.vol = c.createGain(); this.vol.gain.value = this.settings.get('plVol', 0.9);
    this.wide = new Widener(c);
    this.lim = new AudioWorkletNode(c, 'djm-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { ceilingDb: -1, lookahead: 0.005, release: 0.12 } });
    this.lim.port.onmessage = e => { this.gr = e.data.gr; };
    this.out = c.createGain();
    this.src.connect(this.vol).connect(this.wide.input); this.wide.output.connect(this.lim).connect(this.out).connect(c.destination);
    this.onCtx && this.onCtx(c); return c;
  }
  save() { this.settings.set('plList', this.list); this.settings.set('plIdx', this.idx); this.settings.set('plShuf', this.shuffle); this.settings.set('plRep', this.repeat); }
  add(ids, playNow) { const start = this.list.length; for (const id of ids) if (!this.list.includes(id)) this.list.push(id); this.order = null; this.save(); this._state(); if (playNow && ids.length) this.play(this.list.indexOf(ids[0]) >= 0 ? this.list.indexOf(ids[0]) : start); }
  remove(i) { this.list.splice(i, 1); if (i < this.idx) this.idx--; this.order = null; this.save(); this._state(); }
  clear() { this.v.pause(); this.list = []; this.idx = 0; this.order = null; this.save(); this._state(); }
  async play(i = this.idx, hd) {
    const ts = this.tracks(); this.list = this.list.filter(id => ts.some(t => t.id === id)); if (!this.list.length) { this._state('La lista está vacía'); return false; }
    this.idx = Math.max(0, Math.min(this.list.length - 1, i)); const t = ts.find(x => x.id === this.list[this.idx]); this.cur = t; this.save();
    await this.ensureCtx(hd ?? this.settings.get('hd', true)); if (this.ctx.state !== 'running') await this.ctx.resume();
    const blob = await this.getBlob(t); if (!blob) { this._state('Archivo no disponible: vuélvelo a agregar'); return false; }
    if (this.url) URL.revokeObjectURL(this.url); this.url = URL.createObjectURL(blob);
    this.v.src = this.url; this.blobInfo = { size: blob.size, type: blob.type || t.type || '' };
    try { await this.v.play(); } catch (e) { this._state('Toca ▶ para empezar'); }
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || 'DJ Mili', album: t.album || '' });
    this.audit('reproductor', 'ok', t.title); this._state(); return true;
  }
  toggle(force) { if (!this.v.src) return this.play(); const on = force ?? this.v.paused; if (on) { this.ctx?.resume(); this.v.play(); } else this.v.pause(); }
  _orderIdx(step) {
    if (!this.shuffle) return this.idx + step; const L = this.list.length;
    if (!this.order || this.order.length !== L) { this.order = [...Array(L).keys()]; for (let i = L - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.order[i], this.order[j]] = [this.order[j], this.order[i]]; } }
    const q = this.order.indexOf(this.idx) + step; return q >= L ? L + this.order[q - L] : q < 0 ? this.order[q + L] : this.order[q];
  }
  next(auto) {
    if (!this.list.length) return;
    if (auto && this.repeat === 'one') { this.v.currentTime = 0; this.v.play(); return; }
    let n = this._orderIdx(1);
    if (n >= this.list.length) { if (this.repeat === 'off' && auto) { this._state(); return; } n %= this.list.length; }
    this.play(n);
  }
  prev() { if (this.v.currentTime > 3) { this.v.currentTime = 0; return; } let n = this._orderIdx(-1); if (n < 0) n = (n % this.list.length + this.list.length) % this.list.length; this.play(n); }
  hdText() {
    const t = this.cur, c = this.ctx; if (!t) return '';
    const dur = this.v.duration || t.dur || 0, kb = dur ? Math.round(this.blobInfo.size * 8 / dur / 1000) : 0;
    const ext = (t.name || '').split('.').pop().toUpperCase();
    const lossless = /FLAC|WAV/.test(ext) || /flac|wav/.test(this.blobInfo.type);
    return `Salida ${c ? c.sampleRate : '—'} Hz · proceso float 32 bits · fuente ${ext}${kb ? ' ~' + kb + ' kbps' : ''}${lossless ? ' (sin pérdida)' : ''}. HD depende del archivo: un MP3/AAC no gana calidad por subir la frecuencia.`;
  }
  _state(msg) { this.onState && this.onState(msg); }
}
export { fmt };
