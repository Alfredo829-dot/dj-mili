const puppeteer = require('puppeteer-core');
(async () => { const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--autoplay-policy=no-user-gesture-required'] }); const p = await b.newPage();
await p.goto('http://localhost:8765/', { waitUntil: 'networkidle0' }); await p.click('#startBtn'); await p.waitForFunction(() => window.__djm.ready, { timeout: 90000 });
console.log(JSON.stringify(await p.evaluate(async () => { const e = window.__djm.eng; const f = new Float32Array([125]), m = new Float32Array(1), ph = new Float32Array(1); const r = {};
 for (const g of [-15, 15]) { e.setEQBand(2, { g }); await new Promise(r => setTimeout(r, 300)); e.eq[2].getFrequencyResponse(f, m, ph); r['g' + g] = (20 * Math.log10(m[0])).toFixed(1); }
 // render offline: tono 125 Hz por la misma cadena (EQ + widener) sin limitador
 const sr = e.ctx.sampleRate, oc = new OfflineAudioContext(2, sr, sr); const osc = oc.createOscillator(); osc.frequency.value = 125; const bq = oc.createBiquadFilter(); bq.type = e.eq[2].type; bq.frequency.value = e.eq[2].frequency.value; bq.Q.value = e.eq[2].Q.value; bq.gain.value = 15; osc.connect(bq).connect(oc.destination); osc.start(); const buf = await oc.startRendering(); let pk = 0; buf.getChannelData(0).slice(sr/2).forEach(v => pk = Math.max(pk, Math.abs(v))); r.offline_plus15 = (20*Math.log10(pk)).toFixed(1); e.setEQBand(2, { g: 0 }); return r; })));
await b.close(); })();
