const puppeteer = require('puppeteer-core'); const fs = require('fs'); const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await p.goto(process.argv[2] || 'http://localhost:8765/', { waitUntil: 'networkidle0' }); await p.click('#startBtn'); await p.waitForFunction(() => window.__djm.ready);
  await p.waitForFunction(() => window.__djm.sampler.pads.every(x => x.buffer), { timeout: 60000 });
  const info = await p.evaluate(() => window.__djm.sampler.pads.map(x => ({ name: x.name, len: x.buffer.duration.toFixed(2), sr: x.buffer.sampleRate, ch: x.buffer.numberOfChannels, lic: x.license })));
  console.log(JSON.stringify(info));
  fs.mkdirSync('pads', { recursive: true });
  for (let i = 0; i < info.length; i++) {
    const b64 = await p.evaluate(i => { const bf = window.__djm.sampler.pads[i].buffer; const n = bf.length, L = bf.getChannelData(0), R = bf.getChannelData(bf.numberOfChannels > 1 ? 1 : 0); const f = new Float32Array(n * 2); for (let k = 0; k < n; k++) { f[2 * k] = L[k]; f[2 * k + 1] = R[k]; } const u = new Uint8Array(f.buffer); let s = ''; for (let k = 0; k < u.length; k += 32768) s += String.fromCharCode.apply(null, u.subarray(k, k + 32768)); return [bf.sampleRate, btoa(s)]; }, i);
    fs.writeFileSync(`pads/${i}_${info[i].name.replace(/[^\w]/g, '')}.f32`, Buffer.from(b64[1], 'base64')); info[i].fsr = b64[0];
  }
  // grabar los 16 pads (WAV + MP3 320 + FLAC + comprimido)
  await p.evaluate(() => { document.querySelector('#recFmt').value = 'all'; document.querySelector('#recComp').checked = true; });
  await p.evaluate(() => window.__djm.api.toggleRec()); await sleep(300);
  for (let i = 0; i < 16; i++) { await p.evaluate(i => window.__djm.api.firePad(i, 1, 't'), i); await sleep(450); }
  await sleep(2500); await p.evaluate(() => { window.__djm.lastRec = null; return window.__djm.api.toggleRec(); }); await p.waitForFunction(() => window.__djm.lastRec, { timeout: 120000 });
  const recs = await p.evaluate(async () => { const out = []; for (const [ext, blob] of window.__djm.lastRec) { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let k = 0; k < u.length; k += 32768) s += String.fromCharCode.apply(null, u.subarray(k, k + 32768)); out.push([ext, btoa(s)]); } return out; });
  const name = await p.evaluate(() => document.querySelector('#recName').value); console.log('recName', name);
  for (const [ext, d] of recs) fs.writeFileSync('pads/rec16.' + ext, Buffer.from(d, 'base64'));
  await p.evaluate(() => document.querySelector('#padsCard').scrollIntoView()); await sleep(300);
  await (await p.$('#padsCard')).screenshot({ path: '/workspace/dj-mili/shots/13-pads16.png' });
  console.log('errors', JSON.stringify(errs)); fs.writeFileSync('pads/info.json', JSON.stringify(info)); await b.close();
})();
