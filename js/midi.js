// Control MIDI (USB OTG en Android Chrome). Mapeo automático de pads (notas 36-43) + MIDI learn.
import { settings } from './store.js';
export class Midi {
  constructor(handler) { this.handler = handler; this.access = null; this.map = settings.get('midimap', {}); this.learnTarget = null; this.onMsg = null; this.onState = null; }
  get supported() { return !!navigator.requestMIDIAccess; }
  async enable() {
    if (!this.supported) throw new Error('Este navegador no soporta Web MIDI (usa Chrome en Android)');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    const bind = () => { for (const inp of this.access.inputs.values()) inp.onmidimessage = e => this._msg(e, inp); this.onState && this.onState(this.devices()); };
    this.access.onstatechange = bind; bind();
    return this.devices();
  }
  devices() { return this.access ? [...this.access.inputs.values()].map(i => i.name + (i.state === 'connected' ? '' : ' (desconectado)')) : []; }
  learn(target) { this.learnTarget = target; }
  key(type, ch, num) { return `${type}:${ch}:${num}`; }
  _msg(e, inp) {
    const [st, d1, d2 = 0] = e.data; const cmd = st & 0xf0, ch = (st & 0x0f) + 1;
    let type = null, val = 0;
    if (cmd === 0x90 && d2 > 0) { type = 'note'; val = d2 / 127; }
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) { type = 'noteoff'; }
    else if (cmd === 0xb0) { type = 'cc'; val = d2 / 127; }
    else if (cmd === 0xe0) { type = 'pb'; val = ((d2 << 7) | d1) / 16383; }
    if (!type) return;
    const k = this.key(type === 'noteoff' ? 'note' : type, ch, type === 'pb' ? 0 : d1);
    this.onMsg && this.onMsg({ type, ch, num: d1, val, raw: [...e.data], device: inp.name });
    if (this.learnTarget && type !== 'noteoff') { this.map[k] = this.learnTarget; settings.set('midimap', this.map); const t = this.learnTarget; this.learnTarget = null; this.handler({ learned: t, key: k }); return; }
    let target = this.map[k];
    if (!target && (type === 'note' || type === 'noteoff') && d1 >= 36 && d1 <= 43) target = 'pad' + (d1 - 36); // mapeo automático
    if (target) this.handler({ target, type, val, key: k });
  }
  clear() { this.map = {}; settings.set('midimap', {}); }
}
