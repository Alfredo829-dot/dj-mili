const puppeteer = require('puppeteer-core'); const fs = require('fs');
const URL = process.argv[2] || 'http://localhost:8765/'; const SH = '/workspace/dj-mili/shots/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const p = await b.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.screenshot({ path: SH + '00-inicio.png' });
  await p.click('#startBtn');
  await p.waitForFunction(() => window.__djm.ready, { timeout: 60000 }); await p.evaluate(require('./cap.js'));
  await p.waitForFunction(() => window.__djm.api.tracks().length >= 2 && window.__djm.api.tracks().every(t => t.analyzed), { timeout: 90000 });
  const R = {};
  R.tracks = await p.evaluate(() => window.__djm.api.tracks().map(t => ({ t: t.title, bpm: t.bpm, key: t.key, cam: t.camelot, conf: t.bpmConf })));
  R.sampleRate = await p.evaluate(() => window.__djm.eng.ctx.sampleRate + ' ' + window.__djm.eng.ctx.state);
  await p.evaluate(async () => { await window.__djm.api.loadToDeck(0, 'demo-124'); await window.__djm.api.loadToDeck(1, 'demo-128'); });
  await p.click('#deck0 .play'); await sleep(300);
  R.deckA = await p.evaluate(async () => { const d = window.__djm.eng.decks[0]; let mx = 0; for (let k = 0; k < 20; k++) { await new Promise(r => setTimeout(r, 50)); mx = Math.max(mx, window.__djm.eng.level()); } return { playing: d.playing, pos: d.position().toFixed(2), maxLevel: mx.toFixed(3) }; });
  await p.screenshot({ path: SH + '01-mezcla-deckA.png' });
  // hotcue + loop
  await p.click('#deck0 .hc[data-k="0"]'); await p.click('#deck0 .lp[data-b="4"]'); await sleep(2800);
  R.loop = await p.evaluate(() => { const d = window.__djm.eng.decks[0]; return { loop: d.loop, pos: d.position(), cue1: d.cues[0] }; });
  R.loopInside = R.loop.loop && R.loop.pos >= R.loop.loop.start - 0.01 && R.loop.pos <= R.loop.loop.end + 0.01;
  await p.click('#deck0 .lp[data-b="4"]');
  // sync + B
  await p.click('#deck1 .play'); await p.click('#deck1 .sync'); await sleep(4000);
  R.sync = await p.evaluate(() => { const [a, b] = window.__djm.eng.decks; const ph = d => ((((d.position() - d.beatOffset) / d.beatLen()) % 1) + 1) % 1; return { a: a.effBpm.toFixed(2), b: b.effBpm.toFixed(2), phaseA: ph(a).toFixed(3), phaseB: ph(b).toFixed(3) }; });
  await p.evaluate(() => { document.querySelector('#deck0 details').open = true; });
  await p.screenshot({ path: SH + '02-mezcla-2decks.png', fullPage: true });
  // EQ effect measurement on 125 Hz band
  R.eq = await p.evaluate(async () => {
    const e = window.__djm.eng, an = e.analyser, bins = new Float32Array(an.frequencyBinCount);
    const meas = async () => { let s = 0; for (let k = 0; k < 10; k++) { await new Promise(r => setTimeout(r, 60)); an.getFloatFrequencyData(bins); const hz = e.ctx.sampleRate / an.fftSize; let v = 0, n = 0; for (let i = Math.floor(90 / hz); i <= Math.ceil(170 / hz); i++) { v += bins[i]; n++; } s += v / n; } return s / 10; };
    e.setLimiter(false);
    e.setEQBand(2, { g: -15 }); await new Promise(r => setTimeout(r, 200)); const lo = await meas();
    e.setEQBand(2, { g: 15 }); await new Promise(r => setTimeout(r, 200)); const hi = await meas();
    e.setEQBand(2, { g: 0 }); e.setLimiter(true);
    return { db125_minus15: lo.toFixed(1), db125_plus15: hi.toFixed(1), diff: (hi - lo).toFixed(1) };
  });
  // pads
  await p.evaluate(() => window.__djm.eng.decks.forEach(d => d.pause()));
  await sleep(600);
  R.silence = await p.evaluate(() => window.__djm.eng.level().toFixed(3));
  await p.evaluate(() => window.__djm.api.showTab('pads'));
  const pads = await p.$$('.pad'); const box = await pads[3].boundingBox(); await p.touchscreen.tap(box.x + 20, box.y + 40); await sleep(250);
  R.padLevel = await p.evaluate(() => window.__djm.eng.level().toFixed(3));
  await p.screenshot({ path: SH + '03-pads.png' });
  await p.evaluate(() => document.querySelectorAll('.pad .gear')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await sleep(300); await p.screenshot({ path: SH + '04-pad-ajustes.png', fullPage: true });
  // MIDI simulado: nota 37 -> pad 2 ; CC learn crossfader
  R.midi = await p.evaluate(async () => { const m = window.__djm.midi; let fired = 0; const orig = window.__djm.sampler.trigger.bind(window.__djm.sampler); window.__djm.sampler.trigger = (i, v) => { fired = i + 1; return orig(i, v); };
    m._msg({ data: [0x90, 37, 100] }, { name: 'Simulado' }); m.learn('xf'); m._msg({ data: [0xb0, 7, 10] }, { name: 'Simulado' }); m._msg({ data: [0xb0, 7, 127] }, { name: 'Simulado' });
    return { padFired: fired, xf: document.querySelector('#xf').value, map: m.map, monitor: document.querySelector('#midiMon').textContent }; });
  await p.evaluate(() => { document.querySelector('#xf').value = 0.5; document.querySelector('#xf').dispatchEvent(new Event('input')); });
  // EQ tab
  await p.evaluate(() => { window.__djm.api.applyPreset('b:Cumbia'); window.__djm.api.showTab('eq'); });
  await sleep(300); await p.screenshot({ path: SH + '05-eq.png', fullPage: true });
  // Grabador eliminado
  R.noRecorder = await p.evaluate(() => !document.querySelector('#recBtn') && !document.querySelector('#recCard') && !window.__djm.api.toggleRec && !('recStart' in window.__djm.eng));
  // Buscar arriba del deck B y cargar
  await p.evaluate(() => { const q = document.querySelector('#deck1 .dq'); q.focus(); q.value = 'neón'; q.dispatchEvent(new Event('input')); }); await sleep(300);
  R.deckSearch = await p.evaluate(() => ({ results: document.querySelectorAll('#deck1 .dres .dr').length, visible: !document.querySelector('#deck1 .dres').classList.contains('hidden') }));
  await p.screenshot({ path: SH + '30-busqueda-deck.png' });
  await p.evaluate(() => document.querySelector('#deck1 .dres .dr').click()); await sleep(1500);
  R.deckSearchLoaded = await p.evaluate(() => window.__djm.eng.decks[1].track?.title);
  // Automix
  await p.evaluate(() => { const [a, b] = window.__djm.eng.decks; a.pause(); b.stop(); document.querySelector('#xf').value = 0; document.querySelector('#xf').dispatchEvent(new Event('input')); window.__djm.api.showTab('mix'); a.seek(a.duration - 9); a.play(); document.querySelector('#mixBeats').value = '8'; const c = document.querySelector('#automix'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await sleep(4500);
  R.automixMid = await p.evaluate(() => ({ xf: (+document.querySelector('#xf').value).toFixed(2), bPlaying: window.__djm.eng.decks[1].playing, msg: document.querySelector('#mixMsg').textContent }));
  await p.screenshot({ path: SH + '08-automix.png' });
  await sleep(6000);
  R.automixEnd = await p.evaluate(() => ({ xf: (+document.querySelector('#xf').value).toFixed(2), aPlaying: window.__djm.eng.decks[0].playing, bPlaying: window.__djm.eng.decks[1].playing, msg: document.querySelector('#mixMsg').textContent }));
  // Importar MP3 local y FLAC en pad
  await p.evaluate(() => window.__djm.api.showTab('lib'));
  const fi = await p.$('#fileIn'); await fi.uploadFile('/tmp/djtest/prueba100.mp3');
  await p.waitForFunction(() => window.__djm.api.tracks().some(t => t.title === 'Prueba MP3 100' && t.analyzed), { timeout: 60000 });
  R.mp3 = await p.evaluate(() => { const t = window.__djm.api.tracks().find(t => t.title === 'Prueba MP3 100'); return { bpm: t.bpm, artist: t.artist, dur: t.dur, stored: t.stored, err: t.err }; });
  await p.evaluate(() => { window.__djm.api.showTab('pads'); document.querySelectorAll('.pad .gear')[7].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await sleep(300); const pf = await p.$('#peFile'); await pf.uploadFile('/tmp/djtest/ding.flac'); await sleep(1500);
  R.padFlac = await p.evaluate(() => ({ name: window.__djm.sampler.pads[7].name, lic: window.__djm.sampler.pads[7].license, msg: document.querySelector('#peLic').textContent }));
  // Library + YouTube
  await p.evaluate(() => window.__djm.api.showTab('lib')); await sleep(300); await p.screenshot({ path: SH + '09-musica.png' });
  await p.evaluate(() => { document.querySelector('#ytBtn').click(); document.querySelector('#ytQ').value = 'cumbia sonidera'; document.querySelector('#ytGo').click(); });
  try { await p.waitForFunction(() => /resultados|respondió/.test(document.querySelector('#ytMsg').textContent), { timeout: 30000 }); } catch (e) {}
  R.yt = await p.evaluate(() => document.querySelector('#ytMsg').textContent + ' | ' + document.querySelectorAll('#ytList .it').length);
  await sleep(1500); await p.screenshot({ path: SH + '10-youtube.png' });
  // cache hit
  await p.evaluate(() => document.querySelector('#ytGo').click()); await sleep(800);
  R.ytCache = await p.evaluate(() => document.querySelector('#ytMsg').textContent);
  await p.evaluate(() => document.querySelector('#ytClose').click()); await sleep(300);
  // More tab + log
  await p.evaluate(() => { window.__djm.api.showTab('more'); document.querySelectorAll('#menuPanel details').forEach(d => d.open = true); });
  await sleep(600); await p.screenshot({ path: SH + '11-mas-bitacora.png', fullPage: true });
  await p.evaluate(() => document.querySelector('#menuClose').click()); await sleep(200);
  R.audit = await p.evaluate(async () => { const m = await import('./js/store.js'); const a = await m.auditAll(); return { n: a.length, sample: a.slice(-3) }; });
  // mic
  R.mic = await p.evaluate(async () => { try { await window.__djm.eng.micOn(); const ok = !!window.__djm.eng.mic; window.__djm.eng.micOff(); return ok; } catch (e) { return 'err ' + e.message; } });
  // party
  await p.evaluate(() => { window.__djm.eng.decks[1].play(); document.querySelector('#partyBtn').click(); }); await sleep(1500);
  await p.screenshot({ path: SH + '12-fiesta.png' });
  await p.evaluate(() => { document.querySelector('#partyX').click(); window.scrollTo(0, 0); }); await sleep(600);
  await p.screenshot({ path: SH + '14-pantalla-unica.png', fullPage: true }); await p.screenshot({ path: SH + '15-pantalla-unica-arriba.png' });
  await p.evaluate(() => document.querySelector('#partyBtn').click()); await sleep(300);
  await p.evaluate(() => document.querySelector('#partyX').click());
  // FX brake / filter / scratch sanity
  R.fx = await p.evaluate(async () => { const d = window.__djm.eng.decks[1]; d.setFilter(-0.6); d.setFX('echo', 0.5); d.scratch(); await new Promise(r => setTimeout(r, 700)); d.setFX('flanger', 0.5); d.brake(0.5); await new Promise(r => setTimeout(r, 700)); return { stoppedAfterBrake: !d.playing, filter: d.filter.type }; });
  R.errors = errs;
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
