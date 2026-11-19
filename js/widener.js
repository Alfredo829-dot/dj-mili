// "Envolvente": ensanchador estéreo en Medio/Lado (M/S), compatible con mono por construcción.
// L = M + S', R = M - S'  →  L + R = 2M siempre: todo lo que se agrega vive solo en el Lado (S'),
// así que al sumar a mono (bocina Bluetooth, celular) se cancela y no hay filtrado de peine.
//  · ancho: realza el Lado arriba de 120 Hz (los graves se quedan al centro)
//  · "Haas" mono‑seguro: copia del Medio retrasada 11/17 ms y con pasa‑altos, inyectada en el Lado
//  · crossfeed para audífonos: baja un poco el Lado en graves‑medios (< 700 Hz), como escuchar en bocinas
export class Widener {
  constructor(ctx) {
    const c = ctx; this.ctx = c;
    const g = v => { const n = c.createGain(); n.gain.value = v; return n; };
    const bq = (type, f, q = 0.707) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    this.input = g(1); this.input.channelCount = 2; this.input.channelCountMode = 'explicit'; this.input.channelInterpretation = 'speakers';
    const sp = c.createChannelSplitter(2); this.input.connect(sp);
    const M = g(1), S = g(1);
    const lm = g(0.5), rm = g(0.5), ls = g(0.5), rs = g(-0.5);
    sp.connect(lm, 0); sp.connect(rm, 1); sp.connect(ls, 0); sp.connect(rs, 1);
    lm.connect(M); rm.connect(M); ls.connect(S); rs.connect(S);
    // Lado total = S + extra·cantidad
    const St = g(1); S.connect(St);
    this.amt = g(0); this.amt.connect(St);
    const hp = bq('highpass', 120); this.wGain = g(1.2); S.connect(hp).connect(this.wGain).connect(this.amt);
    const lp = bq('lowpass', 700); this.xfGain = g(-0.22); S.connect(lp).connect(this.xfGain).connect(this.amt);
    const d1 = c.createDelay(0.05); d1.delayTime.value = 0.011; const h1 = bq('highpass', 350); const l1 = bq('lowpass', 7000); this.h1g = g(0.16);
    M.connect(d1).connect(h1).connect(l1).connect(this.h1g).connect(this.amt);
    const d2 = c.createDelay(0.05); d2.delayTime.value = 0.017; const h2 = bq('highpass', 500); this.h2g = g(-0.10);
    M.connect(d2).connect(h2).connect(this.h2g).connect(this.amt);
    // Reconstrucción L/R
    const Lo = g(1), Ro = g(1), nS = g(-1);
    M.connect(Lo); St.connect(Lo); M.connect(Ro); St.connect(nS).connect(Ro);
    const mg = c.createChannelMerger(2); Lo.connect(mg, 0, 0); Ro.connect(mg, 0, 1);
    this.output = g(1); mg.connect(this.output);
    this.on = false; this.amount = 0.5; this.headphones = true;
  }
  t() { return this.ctx.currentTime + 0.01; }
  set({ on = this.on, amount = this.amount, headphones = this.headphones } = {}) {
    this.on = on; this.amount = amount; this.headphones = headphones; const t = this.t();
    this.amt.gain.setTargetAtTime(on ? amount : 0, t, 0.03);
    this.xfGain.gain.setTargetAtTime(headphones ? -0.22 : 0, t, 0.03);
  }
}
