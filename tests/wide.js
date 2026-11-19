const puppeteer = require('puppeteer-core'); const fs = require('fs'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = process.argv[2] || 'http://localhost:8765/';
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('dialog', d => d.accept());
  await p.setViewport({ width: 915, height: 412, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(URL, { waitUntil: 'networkidle0' }); await p.click('#startBtn'); await p.waitForFunction(() => window.__djm.ready, { timeout: 90000 }); await p.evaluate(require('./cap.js'));
  const R = {};
  // 1) Offline: transparencia apagado, ancho y compatibilidad mono con amount=1 (música real)
  const wav = fs.readFileSync('/tmp/djtest/demo-128.wav').toString('base64');
  R.offline = await p.evaluate(async b64 => {
    const { Widener } = await import('./js/widener.js'); const ab = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
    const src = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(ab);
    const run = async (on, amount, hp) => { const o = new OfflineAudioContext(2, src.length, src.sampleRate); const w = new Widener(o); w.set({ on, amount, headphones: hp }); w.amt.gain.value = on ? amount : 0; w.xfGain.gain.value = hp ? -0.22 : 0; const s = o.createBufferSource(); s.buffer = src; s.connect(w.input); w.output.connect(o.destination); s.start(); return o.startRendering(); };
    const st = buf => { const L = buf.getChannelData(0), R = buf.getChannelData(1); let m = 0, sd = 0, pk = 0, lr = 0, ll = 0, rr = 0; for (let i = 0; i < L.length; i++) { const M = (L[i] + R[i]) / 2, S = (L[i] - R[i]) / 2; m += M * M; sd += S * S; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; } return { side_mid_dB: 10 * Math.log10(sd / m), peak_dBFS: 20 * Math.log10(pk), corr: lr / Math.sqrt(ll * rr) }; };
    const diff = (a, bb, f) => { let e = 0, r = 0; const A0 = a.getChannelData(0), A1 = a.getChannelData(1), B0 = bb.getChannelData(0), B1 = bb.getChannelData(1); for (let i = 0; i < A0.length; i++) { const x = f(A0[i], A1[i]), y = f(B0[i], B1[i]); e += (x - y) ** 2; r += x * x; } return 10 * Math.log10(e / r + 1e-30); };
    const off = await run(false, 0, true), on = await run(true, 1, true), on2 = await run(true, 1, false), half = await run(true, 0.5, true);
    const r = { input: st(src), off: st(off), on_1: st(on), on_05: st(half), on_1_bocinas: st(on2),
      off_vs_input_error_dB: diff(src, off, (l, r) => l) , mono_sum_change_on1_dB: diff(off, on, (l, r) => l + r), mono_sum_change_on05_dB: diff(off, half, (l, r) => l + r) };
    for (const k of Object.keys(r)) if (typeof r[k] === 'object') for (const j in r[k]) r[k][j] = +r[k][j].toFixed(2); else r[k] = +r[k].toFixed(1);
    return r;
  }, wav);
  // 2) Tiempo real por el limitador (mezcla DJ): deck con EQ caliente + envolvente al máximo en la mezcla
  const fi = await p.$('#fileIn'); await fi.uploadFile('/tmp/djtest/fuerte.wav', '/tmp/djtest/fuerte.m4a');
  await p.waitForFunction(() => window.__djm.api.tracks().filter(t => /fuerte/i.test(t.name)).length >= 2 && window.__djm.api.tracks().every(t => t.analyzed), { timeout: 90000 });
  R.aac = await p.evaluate(async () => { const t = window.__djm.api.tracks().find(t => t.name === 'fuerte.m4a'); const b = await window.__djm.api.decodeTrack(t.id); return { dur: +b.duration.toFixed(2), sr: b.sampleRate, ch: b.numberOfChannels, bpm: t.bpm, lufs: t.lufs }; });
  await p.evaluate(async () => { const t = window.__djm.api.tracks().find(t => t.name === 'fuerte.wav'); await window.__djm.api.loadToDeck(0, t.id); const x = document.querySelector('#xf'); x.value = 0; x.dispatchEvent(new Event('input'));
    document.querySelector('#wideOn').checked = true; document.querySelector('#wideMaster').checked = true; document.querySelector('#wideAmt').value = 1; document.querySelector('#wideOn').dispatchEvent(new Event('change'));
    const e = window.__djm.eng; for (let i = 0; i < 10; i++) e.setEQBand(i, { g: 12 }); e.decks[0].trim.gain.value = 2; e.decks[0].seek(1); e.decks[0].play(); });
  await sleep(400); await p.evaluate(() => window.__cap.start()); await sleep(6000); await p.evaluate(() => window.__cap.stop());
  const dl = async name => { const b64 = await p.evaluate(async () => { const u = new Uint8Array(await window.__djm.lastRec[0][1].arrayBuffer()); let s = ''; for (let k = 0; k < u.length; k += 32768) s += String.fromCharCode.apply(null, u.subarray(k, k + 32768)); return btoa(s); }); fs.writeFileSync('/tmp/djtest/' + name, Buffer.from(b64, 'base64')); };
  await dl('wide_master_stress.wav');
  await p.evaluate(() => { const e = window.__djm.eng; for (let i = 0; i < 10; i++) e.setEQBand(i, { g: 0 }); e.decks[0].trim.gain.value = 1; e.decks[0].pause(); document.querySelector('#wideMaster').checked = false; document.querySelector('#wideMaster').dispatchEvent(new Event('change')); });
  // 3) Reproductor: AAC/M4A y video con imagen, envolvente al máximo, volumen alto → salida del limitador del reproductor
  await p.evaluate(() => document.querySelector('#plBtn').click());
  R.player = await p.evaluate(async () => { const pl = window.__djm.player; pl.clear(); const ts = window.__djm.api.tracks(); pl.add([ts.find(t => t.name === 'fuerte.m4a').id], true); await new Promise(r => setTimeout(r, 1500)); pl.vol.gain.value = 1; return { playing: !pl.v.paused, t: +pl.v.currentTime.toFixed(2), sr: pl.ctx.sampleRate, latencyHint: 'playback', base: pl.ctx.baseLatency }; });
  await p.evaluate(() => window.__cap.start(window.__djm.player.ctx, window.__djm.player.out)); await sleep(5000); await p.evaluate(() => window.__cap.stop()); await dl('wide_player_aac.wav');
  R.playerHD = await p.evaluate(() => document.querySelector('#plHD').textContent);
  await p.screenshot({ path: '/workspace/dj-mili/shots/31-reproductor-horizontal.png' });
  R.errors = errs; console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
