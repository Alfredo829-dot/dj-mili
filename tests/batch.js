const puppeteer = require('puppeteer-core'); const fs = require('fs'); const os = require('os'); const path = require('path'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = process.argv[2] || 'http://localhost:8765/'; const SH = '/workspace/dj-mili/shots/';
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'djb-'));
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', userDataDir: ud, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  let p = await b.newPage(); const errs = []; const hook = pg => { pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text())); pg.on('dialog', d => d.accept()); }; hook(p);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(URL, { waitUntil: 'networkidle0' }); await p.click('#startBtn'); await p.waitForFunction(() => window.__djm.ready, { timeout: 60000 });
  await p.waitForFunction(() => window.__djm.api.tracks().length >= 2 && window.__djm.api.tracks().every(t => t.analyzed), { timeout: 90000 });
  const R = {}; const files = fs.readdirSync('/tmp/batch').map(f => '/tmp/batch/' + f); R.files = files.length;
  const t0 = Date.now(); const fi = await p.$('#fileIn'); await fi.uploadFile(...files);
  await p.waitForFunction(n => window.__djm.api.tracks().length >= n + 2, { timeout: 300000 }, files.length - 1);
  R.importSec = (Date.now() - t0) / 1000; R.impMsg = await p.evaluate(() => document.querySelector('#impMsg').textContent);
  await p.waitForFunction(() => window.__djm.api.tracks().every(t => t.analyzed), { timeout: 600000, polling: 1000 });
  R.importPlusAnalysisSec = (Date.now() - t0) / 1000;
  R.heapMB = await p.evaluate(() => performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 'n/d');
  const snap = () => p.evaluate(async () => { const ts = window.__djm.api.tracks().filter(t => !t.demo); const m = await import('./js/store.js'); let blobs = 0; for (const t of ts) if (await m.idb.get('blobs', t.id)) blobs++; return { n: ts.length, blobs, analyzed: ts.filter(t => t.analyzed && t.bpm).length, errs: ts.filter(t => t.err).map(t => t.name + ': ' + t.err), videos: ts.filter(t => t.video).map(t => t.title), bpmSample: ts.slice(0, 4).map(t => t.title + ' ' + t.bpm + ' ' + t.camelot + ' ' + t.lufs), persisted: await navigator.storage.persisted(), est: await navigator.storage.estimate().then(e => (e.usage / 1048576).toFixed(1) + ' MB') }; });
  R.before = await snap(); R.storeInfo = await p.evaluate(() => document.querySelector('#storeInfo').textContent);
  await p.evaluate(() => { document.querySelector('#libCard').scrollIntoView(); document.querySelector('#q').value = 'video'; document.querySelector('#q').dispatchEvent(new Event('input')); }); await sleep(400);
  await p.evaluate(() => { document.querySelector('#q').value = ''; document.querySelector('#q').dispatchEvent(new Event('input')); document.querySelector('#libCard').scrollIntoView(); }); await sleep(400);
  await p.screenshot({ path: SH + '16-biblioteca-50.png' });
  // recargar → persistencia
  const auditBefore = await p.evaluate(async () => (await (await import('./js/store.js')).auditAll()).filter(a => a.accion === 'analizar').length);
  await p.reload({ waitUntil: 'networkidle0' }); await p.click('#startBtn'); await p.waitForFunction(() => window.__djm.ready, { timeout: 60000 }); await sleep(3000);
  R.after = await snap();
  R.reanalyzedAfterReload = (await p.evaluate(async () => (await (await import('./js/store.js')).auditAll()).filter(a => a.accion === 'analizar').length)) - auditBefore;
  // video mp4 en deck A pasando por EQ y grabadora
  console.log(JSON.stringify(R)); const vid = await p.evaluate(() => (window.__djm.api.tracks().find(t => /Video fiesta/.test(t.title)) || {}).id);
  await p.evaluate(async id => { await window.__djm.api.loadToDeck(0, id); document.querySelector('#xf').value = 0; document.querySelector('#xf').dispatchEvent(new Event('input')); document.querySelector('#recFmt').value = 'wav'; }, vid);
  await p.evaluate(() => window.__djm.api.toggleRec()); await p.evaluate(() => window.__djm.eng.decks[0].play()); await sleep(4000);
  await p.evaluate(() => window.__djm.eng.decks[0].setEQ3('low', -26)); await sleep(3000);
  await p.evaluate(() => { window.__djm.lastRec = null; window.__djm.eng.decks[0].pause(); return window.__djm.api.toggleRec(); }); await p.waitForFunction(() => window.__djm.lastRec);
  const wav = await p.evaluate(async () => { const u = new Uint8Array(await window.__djm.lastRec[0][1].arrayBuffer()); let s = ''; for (let k = 0; k < u.length; k += 32768) s += String.fromCharCode.apply(null, u.subarray(k, k + 32768)); return btoa(s); });
  fs.writeFileSync('rec_video_mp4.wav', Buffer.from(wav, 'base64'));
  // guardar solo audio (mp4 → AAC/ADTS) y decodificar
  R.extract = await p.evaluate(async id => { const t = window.__djm.api.tracks().find(t => t.id === id); const before = t.size; await window.__djm.api.makeAudioOnly(id); const buf = await window.__djm.api.decodeTrack(id); return { before, after: t.size, how: t.extracted, dur: buf.duration.toFixed(2), ch: buf.numberOfChannels }; }, vid);
  R.extractWebm = await p.evaluate(async () => { const t = window.__djm.api.tracks().find(t => /Clip galeria/.test(t.title)); const before = t.size; await window.__djm.api.makeAudioOnly(t.id); const buf = await window.__djm.api.decodeTrack(t.id); return { before, after: t.size, how: t.extracted, dur: buf.duration.toFixed(2) }; });
  // borrar una
  R.del = await p.evaluate(async () => { const t = window.__djm.api.tracks().find(t => t.name === 'lote_01.m4a'); await window.__djm.api.deleteTrack(t.id); const m = await import('./js/store.js'); return { gone: !window.__djm.api.tracks().some(x => x.id === t.id), blob: !!(await m.idb.get('blobs', t.id)) }; });
  await p.evaluate(() => document.querySelector('#libCard').scrollIntoView()); await sleep(500); await p.screenshot({ path: SH + '17-biblioteca-video-audio.png' });
  R.errors = errs; console.log(JSON.stringify(R, null, 1)); await b.close();
})();
