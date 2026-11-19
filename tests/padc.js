const puppeteer = require('puppeteer-core'); const fs = require('fs'); const os = require('os'); const path = require('path'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = process.argv[2] || 'http://localhost:8765/';
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'djp-'));
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', userDataDir: ud, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('dialog', d => d.accept());
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const open = async () => { await p.click('#startBtn'); await p.waitForFunction(() => window.__djm.ready, { timeout: 90000 }); await p.evaluate(require('./cap.js')); await p.waitForFunction(() => window.__djm.sampler.pads.every(x => x.buffer || x.err), { timeout: 60000 }); };
  await p.goto(URL, { waitUntil: 'networkidle0' }); await open();
  const R = { start: await p.evaluate(() => window.__djm.sampler.pads.length) };
  const add = await p.$('.pad.padd input'); await add.uploadFile('/tmp/djtest/grito.mp4', '/tmp/djtest/bajito.m4a');
  await p.waitForFunction(() => window.__djm.sampler.pads.length >= 18, { timeout: 60000 }); await sleep(500);
  R.added = await p.evaluate(() => window.__djm.sampler.pads.slice(16).map(x => ({ name: x.name, emoji: x.emoji, dur: +x.buffer.duration.toFixed(2), normDb: +(20 * Math.log10(x.norm)).toFixed(1), src: x.src.split(':')[0] })));
  // editar el pad 17 (video): renombrar, color, recortar, mover al lugar 1; borrar "Risas"
  await p.evaluate(() => { const s = window.__djm.sampler; const p = s.pads[16]; p.name = 'Grito video'; p.color = '#ff0000'; s.setTrim(16, 0.2, 1.5); s.save(); s.move(16, -1); });
  await p.evaluate(async () => { const s = window.__djm.sampler; const i = s.pads.findIndex(x => x.uid === 'risas'); await s.remove(i); });
  R.edited = await p.evaluate(() => { const s = window.__djm.sampler; return { n: s.pads.length, at15: s.pads.findIndex(x=>x.name==='Grito video'), trim: (q=>[q.start,q.end])(s.pads.find(x=>x.name==='Grito video')), color: s.pads.find(x=>x.name==='Grito video').color, hasRisas: s.pads.some(x => x.uid === 'risas') }; });
  // disparar el pad propio bajito y uno de fábrica: niveles parecidos, nada pasa de -1 dBFS
  await p.evaluate(() => window.__cap.start()); await sleep(200);
  await p.evaluate(() => { const s = window.__djm.sampler; window.__djm.api.firePad(s.pads.findIndex(x => x.name === 'bajito')); }); await sleep(2600);
  await p.evaluate(() => window.__djm.api.firePad(0)); await sleep(2500);
  await p.evaluate(() => { for (let k = 0; k < 6; k++) window.__djm.sampler.pads.forEach((_, i) => window.__djm.api.firePad(i)); }); await sleep(2500);
  await p.evaluate(() => window.__cap.stop());
  const b64 = await p.evaluate(async () => { const u = new Uint8Array(await window.__djm.lastRec[0][1].arrayBuffer()); let s = ''; for (let k = 0; k < u.length; k += 32768) s += String.fromCharCode.apply(null, u.subarray(k, k + 32768)); return btoa(s); }); fs.writeFileSync('/tmp/djtest/padc.wav', Buffer.from(b64, 'base64'));
  await p.evaluate(() => { window.__djm.api.showTab('pads'); }); await sleep(300); await p.evaluate(() => document.querySelectorAll('.pad .gear')[15].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await sleep(400);
  await p.$eval('#padsCard', e => e.scrollIntoView()); await sleep(300); await (await p.$('#padsCard')).screenshot({ path: '/workspace/dj-mili/shots/32-pads-propios.png' });
  // recargar: persistencia en IndexedDB
  await p.reload({ waitUntil: 'networkidle0' }); await open();
  R.afterReload = await p.evaluate(() => { const s = window.__djm.sampler; return { n: s.pads.length, at15: s.pads.findIndex(x=>x.name==='Grito video'), trim: (q=>[q.start,q.end])(s.pads.find(x=>x.name==='Grito video')), color: s.pads.find(x=>x.name==='Grito video').color, loaded: s.pads.every(x => x.buffer), domPads: document.querySelectorAll('.pad:not(.padd)').length }; });
  await p.evaluate(async () => { await window.__djm.sampler.resetAll(); });
  R.afterReset = await p.evaluate(async () => { const s = window.__djm.sampler; const m = await import('./js/store.js'); const keys = (await m.idb.keys?.('blobs')) || []; return { n: s.pads.length, names: s.pads.map(x => x.name).join(','), padBlobsLeft: keys.filter ? keys.filter(k => String(k).startsWith('padblob-')).length : 'n/d' }; });
  R.errors = errs; console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
