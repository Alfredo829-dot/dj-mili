const puppeteer = require('puppeteer-core'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = process.argv[2] || 'http://localhost:8765/'; const SH = '/workspace/dj-mili/shots/';
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(URL, { waitUntil: 'networkidle0' }); await p.click('#startBtn'); await p.waitForFunction(() => window.__djm.ready);
  await p.waitForFunction(() => window.__djm.api.tracks().filter(t => t.demo).length >= 2 && window.__djm.api.tracks().every(t => t.analyzed), { timeout: 90000 });
  await p.evaluate(async () => { const ts = window.__djm.api.tracks().filter(t => t.demo); await window.__djm.api.loadToDeck(0, ts[0].id); await window.__djm.api.loadToDeck(1, ts[1].id); const [a, c] = window.__djm.eng.decks; a.play(); c.play(); a.hotcue(0, 'go'); c.hotcue(0, 'go'); c.hotcue(1, 'go'); document.querySelector('#deck0 .eqh').value = 3; document.querySelector('#deck0 .eqh').dispatchEvent(new Event('input')); document.querySelector('#deck1 .eql').value = -12; document.querySelector('#deck1 .eql').dispatchEvent(new Event('input')); window.__djm.api.applyPreset('b:Cumbia'); window.__djm.api.deckUI.forEach(u => u.render()); });
  await sleep(2500); await p.evaluate(() => window.__djm.api.firePad(2)); await sleep(60);
  await p.screenshot({ path: SH + '20-vertical.png' }); await p.screenshot({ path: SH + '21-vertical-completa.png', fullPage: true });
  for (const [w, h, n] of [[915, 412, '22-horizontal-915x412'], [800, 360, '23-horizontal-800x360']]) {
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await sleep(1200);
    await p.evaluate(() => window.scrollTo(0, 0)); await p.evaluate(() => window.__djm.api.firePad(9)); await sleep(60);
    await p.screenshot({ path: SH + n + '.png' }); await p.screenshot({ path: SH + n + '-completa.png', fullPage: true });
  }
  const m = await p.evaluate(() => ({ jog: document.querySelector('#deck0 .jog').getBoundingClientRect().width, hc: document.querySelector('#deck0 .hc').getBoundingClientRect().height, pad: document.querySelector('.pad').getBoundingClientRect().width, overflowX: document.documentElement.scrollWidth > innerWidth }));
  console.log(JSON.stringify({ m, errs })); await b.close();
})();
