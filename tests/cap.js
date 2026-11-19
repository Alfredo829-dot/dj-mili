// Captura de prueba (solo en tests): graba la salida limitada del motor sin grabador en la app.
module.exports = `window.__cap = {
  async start(ctx, node) {
    ctx = ctx || window.__djm.eng.ctx; node = node || window.__djm.eng.out;
    if (!ctx.__capMod) { const src = "class C extends AudioWorkletProcessor{constructor(){super();this.on=true;this.port.onmessage=e=>{if(e.data==='stop')this.on=false}}process(i){if(!this.on)return false;const a=i[0];if(a&&a.length){this.port.postMessage([a[0].slice(),(a[1]||a[0]).slice()])}return true}}registerProcessor('cap',C)"; await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))); ctx.__capMod = 1; }
    const n = new AudioWorkletNode(ctx, 'cap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' }); const L = [], R = [];
    n.port.onmessage = e => { L.push(e.data[0]); R.push(e.data[1]); }; node.connect(n); this.cur = { n, L, R, ctx, node };
  },
  async stop() {
    const c = this.cur; c.n.port.postMessage('stop'); await new Promise(r => setTimeout(r, 150)); try { c.node.disconnect(c.n); } catch (e) {}
    const len = c.L.reduce((a, b) => a + b.length, 0); const enc = await import('./js/encoders.js');
    const cat = a => { const o = new Float32Array(len); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
    const blob = enc.encodeWAV([enc.floatTo16(cat(c.L), false), enc.floatTo16(cat(c.R), false)], c.ctx.sampleRate, {}); window.__djm.lastRec = [['wav', blob]]; this.cur = null; return true;
  },
  toggle() { return this.cur ? this.stop() : this.start(); }
};`;
