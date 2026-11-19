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
  await p.waitForFunction(() => window.__djm.ready, { timeout: 60000 }); await p.evaluate(require('./cap.js'));
  const fi = await p.$('#fileIn'); await fi.uploadFile('/tmp/djtest/tono440.wav', '/tmp/djtest/fuerte.wav', '/tmp/djtest/bajita.wav', '/tmp/djtest/prueba100.mp3', '/tmp/djtest/m_bajita.wav', '/tmp/djtest/m_fuerte.wav', '/tmp/djtest/m_muybajita.wav');
  await p.waitForFunction(() => window.__djm.api.tracks().length >= 9 && window.__djm.api.tracks().every(t => t.analyzed), { timeout: 120000 });
  const id = async title => p.evaluate(t => window.__djm.api.tracks().find(x => x.title === t).id, title);
  const R = { tag: TAG };
  const rec = async (name, ms, during) => {
    await p.evaluate(() => { window.__djm.lastRec = null; });
    await p.evaluate(() => window.__cap.toggle()); await sleep(150);
    if (during) await during(); else await sleep(ms);
    await p.evaluate(() => window.__cap.toggle());
    await p.waitForFunction(() => window.__djm.lastRec, { timeout: 30000 });
    const b64 = await p.evaluate(async () => { const b = new Uint8Array(await window.__djm.lastRec[0][1].arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); });
    fs.writeFileSync(OUT + name + '.wav', Buffer.from(b64, 'base64'));
  };
  const xf = v => p.evaluate(v => { const x = document.querySelector('#xf'); x.value = v; x.dispatchEvent(new Event('input')); }, v);
  const stopAll = () => p.evaluate(() => window.__djm.eng.decks.forEach(d => d.pause()));
  if (process.argv[4] === 'nodraw') await p.evaluate(() => window.__djm.api.showTab('more'));
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
  R.errors = errs; console.log(JSON.stringify(R)); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
