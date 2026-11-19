// Pruebas de calidad de audio de punta a punta: graba la salida maestra real del navegador.
const puppeteer = require('puppeteer-core'); const fs = require('fs');
const URL = process.argv[2], TAG = process.argv[3] || 'new', OUT = '/tmp/djtest/rec_' + TAG + '_';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const p = await b.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(URL, { waitUntil: 'networkidle0' }); await p.click('#startBtn');
  await p.waitForFunction(() => window.__djm.ready, { timeout: 60000 });
  const fi = await p.$('#fileIn'); await fi.uploadFile('/tmp/djtest/tono440.wav', '/tmp/djtest/fuerte.wav', '/tmp/djtest/bajita.wav', '/tmp/djtest/prueba100.mp3', '/tmp/djtest/m_bajita.wav', '/tmp/djtest/m_fuerte.wav', '/tmp/djtest/m_muybajita.wav');
  await p.waitForFunction(() => window.__djm.api.tracks().length >= 9 && window.__djm.api.tracks().every(t => t.analyzed), { timeout: 120000 });
  const id = async title => p.evaluate(t => window.__djm.api.tracks().find(x => x.title === t).id, title);
  const R = { tag: TAG };
  const rec = async (name, ms, during) => {
    await p.evaluate(() => { document.querySelector('#recFmt').value = 'wav'; window.__djm.lastRec = null; });
    await p.evaluate(() => window.__djm.api.toggleRec()); await sleep(150);
    if (during) await during(); else await sleep(ms);
    await p.evaluate(() => window.__djm.api.toggleRec());
    await p.waitForFunction(() => window.__djm.lastRec, { timeout: 30000 });
    const b64 = await p.evaluate(async () => { const b = new Uint8Array(await window.__djm.lastRec[0][1].arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); });
    fs.writeFileSync(OUT + name + '.wav', Buffer.from(b64, 'base64'));
  };
  const xf = v => p.evaluate(v => { const x = document.querySelector('#xf'); x.value = v; x.dispatchEvent(new Event('input')); }, v);
  const stopAll = () => p.evaluate(() => window.__djm.eng.decks.forEach(d => d.pause()));
  // ---- 1) LUFS entre pistas ----
  for (const norm of TAG === 'new' ? [true, false] : [false]) {
    if (TAG === 'new') await p.evaluate(n => { const c = document.querySelector('#normalize'); c.checked = n; c.dispatchEvent(new Event('change')); }, norm);
    await xf(0);
    for (const t of ['Demo Neón 124', 'Demo Láser 128', 'Musica bajita', 'Musica fuerte', 'Musica muy bajita', 'Pista fuerte', 'Prueba MP3 100', 'Pista bajita']) {
      const tid = await id(t); await stopAll(); await p.evaluate(tid => window.__djm.api.loadToDeck(0, tid), tid);
      await p.evaluate(() => { const d = window.__djm.eng.decks[0]; d.seek(8); d.play(); }); await sleep(200);
      await rec('lufs_' + (norm ? 'norm_' : 'raw_') + t.replace(/\W+/g, '_'), 8000);
    }
    await stopAll();
  }
  if (TAG === 'new') await p.evaluate(() => { const c = document.querySelector('#normalize'); c.checked = true; c.dispatchEvent(new Event('change')); });
  // ---- 2) Pico: EQ +15 en todo, 2 decks, 8 pads apilados, micro con eco ----
  await p.evaluate(async (a, bb) => { await window.__djm.api.loadToDeck(0, a); await window.__djm.api.loadToDeck(1, bb); }, await id('Pista fuerte'), await id('Demo Neón 124'));
  await xf(0.5);
  await p.evaluate(() => { const e = window.__djm.eng; for (let i = 0; i < 10; i++) e.setEQBand(i, { g: 15 }); e.decks.forEach(d => { d.vol.gain.value = 1; d.trim.gain.value = 2; d.play(); }); window.__djm.sampler.bus.gain.value = 1.5; window.__djm.sampler.pads.forEach(pd => { pd.gain = 1.5; window.__djm.sampler.apply(pd.i); }); });
  const micOk = await p.evaluate(async () => { try { await window.__djm.eng.micOn({ gain: 2, echo: 0.9 }); return true; } catch (e) { return e.message; } });
  R.micOn = micOk; let minGr = 0;
  await rec('peak_stress', 0, async () => { for (let k = 0; k < 24; k++) { await p.evaluate(() => { for (let i = 0; i < 8; i++) window.__djm.api.firePad(i, 1, 'test'); }); await sleep(250); const g = await p.evaluate(() => window.__djm.eng.gr || 0); minGr = Math.min(minGr, g); } });
  R.limiterMaxGR_dB = +minGr.toFixed(1);
  R.overs = await p.evaluate(() => window.__djm.eng.overs);
  await p.evaluate(() => { const e = window.__djm.eng; for (let i = 0; i < 10; i++) e.setEQBand(i, { g: 0 }); e.micOff && e.micOff(); e.decks.forEach(d => { d.trim.gain.value = 1; d.vol.gain.value = 0.9; }); window.__djm.sampler.bus.gain.value = 0.9; window.__djm.sampler.pads.forEach(pd => { pd.gain = 0.8; window.__djm.sampler.apply(pd.i); }); });
  await stopAll();
  // ---- 3) Mic solo a ganancia alta (pasa por el limitador) ----
  if (micOk === true) { await p.evaluate(async () => { await window.__djm.eng.micOn({ gain: 2, echo: 0.9 }); window.__djm.eng.micSet({ gain: 2 }); }); await rec('mic_only', 3000); await p.evaluate(() => window.__djm.eng.micOff()); }
  // ---- 4) Clics: tono 440 con hot cues, loops, pausa, crossfader, pads ----
  const tone = await id('Tono 440');
  await p.evaluate(async t => { await window.__djm.api.loadToDeck(0, t); await window.__djm.api.loadToDeck(1, t); }, tone);
  // pad con coseno (empieza en pico = peor caso)
  await p.evaluate(() => document.querySelectorAll('.pad .gear')[7].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await sleep(200);
  const pf = await p.$('#peFile'); await pf.uploadFile('/tmp/djtest/cospad.wav'); await sleep(1200);
  await p.evaluate(() => { const pd = window.__djm.sampler.pads[7]; pd.choke = true; pd.reverb = 0; pd.delay = 0; window.__djm.sampler.apply(7); });
  for (const kl of TAG === 'new' ? [false, true] : [false]) {
    await p.evaluate(kl => window.__djm.eng.decks.forEach(d => d.setKeylock && d.setKeylock(kl)), kl);
    await xf(0);
    await p.evaluate(() => { const [a, bb] = window.__djm.eng.decks; a.setRate(1); bb.setRate(1); a.seek(1); bb.seek(3.3333); a.play(); bb.play(); a.cues = [2.0101, 5.3377, 9.7013, 12.123, 15.55, 18.0007, 21.31, 24.777]; });
    await sleep(300);
    await rec('clicks_' + (kl ? 'kl' : 'nokl'), 0, async () => {
      for (let k = 0; k < 8; k++) { await p.evaluate(k => window.__djm.eng.decks[0].hotcue(k), k); await sleep(300); }
      await p.evaluate(() => window.__djm.eng.decks[0].setLoop(1)); await sleep(2200); await p.evaluate(() => window.__djm.eng.decks[0].exitLoop());
      await p.evaluate(() => window.__djm.eng.decks[0].setLoop(0.5)); await sleep(1300); await p.evaluate(() => window.__djm.eng.decks[0].exitLoop());
      await p.evaluate(() => window.__djm.eng.decks[0].pause()); await sleep(300); await p.evaluate(() => window.__djm.eng.decks[0].play()); await sleep(400);
      for (let k = 0; k < 4; k++) { await xf(1); await sleep(250); await xf(0); await sleep(250); }
      for (let k = 0; k < 6; k++) { await p.evaluate(() => window.__djm.api.firePad(7, 1, 'test')); await sleep(180); }
      await sleep(600);
      await p.evaluate(() => window.__djm.eng.decks[0].setRate(1.06)); await sleep(800); await p.evaluate(() => window.__djm.eng.decks[0].setRate(1)); await sleep(600);
    });
    await stopAll();
  }
  // ---- 5) Key lock: tono a +8 % ----
  if (TAG === 'new') for (const kl of [true, false]) {
    await p.evaluate(kl => { const d = window.__djm.eng.decks[0]; d.setKeylock(kl); d.seek(2); d.setRate(1.08); d.play(); }, kl); await xf(0); await sleep(500);
    await rec('keylock_' + (kl ? 'on' : 'off'), 3000); await stopAll();
  }
  R.errors = errs; console.log(JSON.stringify(R)); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
