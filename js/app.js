import { Engine, EQ_DEFAULT } from './engine.js';
import { Sampler, BUILTIN, PAD_COLORS } from './sampler.js';
const BUILTIN_IDS = BUILTIN.map(b => b.id);
import { detectBPM } from './bpm.js';
import { detectKey, camelotCompatible, camelotNeighbors } from './key.js';
import { encodeWAV, encodeFLAC, readTags, floatTo16 } from './encoders.js';
import { extractAAC } from './mp4audio.js';
import { idb, settings, audit, auditAll, onAudit, cachePurge, auditTrim } from './store.js';
import { Midi } from './midi.js';
import { searchYouTube, parseYouTubeId } from './search.js';
import { makeDemo } from './demo.js';
import { Player } from './player.js';
import { integratedLoudness, normGainDb, TARGET_LUFS } from './loudness.js';

const VERSION = '1.2.0';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (html) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = t => { if (!isFinite(t) || t < 0) t = 0; const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
let toastT; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }
window.__djm = {}; // ganchos para pruebas

let eng, sampler, midi;
const session = new Map(); // id -> File (si no se guarda copia)
let tracks = [];
const HC = ['#ff3b5c', '#ff9f1c', '#ffd23f', '#39ff88', '#00e5ff', '#3d7bff', '#b04dff', '#ff2bd6'];

// ---------------- Arranque y PIN ----------------
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function checkLock() {
  const ph = settings.get('pinHash', null); if (!ph) return;
  $('#lock').classList.remove('hidden'); $('#pinIn').focus();
  await new Promise(res => {
    const go = async () => {
      const h = await sha(settings.get('pinSalt', '') + $('#pinIn').value);
      if (h === ph) { audit('desbloqueo PIN', 'ok'); $('#lock').classList.add('hidden'); $('#pinIn').value = ''; res(); }
      else { audit('desbloqueo PIN', 'error', 'PIN incorrecto'); $('#pinMsg').textContent = 'PIN incorrecto'; $('#pinIn').value = ''; }
    };
    $('#pinGo').onclick = go; $('#pinIn').onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}

async function boot() {
  $('#ver').textContent = 'DJ Mili v' + VERSION;
  await checkLock();
  $('#startBtn').onclick = start;
}
async function start() {
  $('#startMsg').textContent = 'Preparando audio…'; if (installed() && settings.get('lockLand', true)) lockLandscape();
  try {
    eng = new Engine({ hd: settings.get('hd', true) }); await eng.init(); await eng.resume();
    window.__djm.eng = eng;
    sampler = new Sampler(eng); window.__djm.sampler = sampler;
    buildDecks(); buildPads(); buildEQ(); bindUI();
    $('#start').classList.add('hidden');
    sampler.init(i => { const p = $$('.pad')[i]; if (p) refreshPad(i); }).then(() => audit('pads listos', 'ok')).catch(e => audit('pads listos', 'error', e.message));
    tracks = (await idb.all('tracks')).sort((a, b) => a.added - b.added);
    if (!tracks.some(t => t.demo) && !settings.get('demoDone', false)) await createDemos();
    renderLib(); renderQueue(); renderPlaylists(); renderPerms(); renderLog(); renderStorage();
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => es.forEach(e => { const u = deckUI.find(x => x.root === e.target); if (u) u.visible = e.isIntersecting; })); deckUI.forEach(u => io.observe(u.root)); }
    analyzePending();
    audit('abrir app', 'ok', 'v' + VERSION + ' ' + eng.ctx.sampleRate + ' Hz');
    requestAnimationFrame(loop); setInterval(automixTick, 150);
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.DJMiliAndroid) navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.storage?.persist?.();
    window.__djm.ready = true;
  } catch (e) { console.error(e); $('#startMsg').textContent = 'Error: ' + e.message; }
}

// ---------------- Pistas demo ----------------
async function createDemos() {
  $('#anaMsg').textContent = 'Creando pistas demo…';
  const list = [{ bpm: 124, root: 57, minor: true, name: 'Demo Neón 124' }, { bpm: 128, root: 60, minor: false, name: 'Demo Láser 128' }];
  for (const d of list) {
    const buf = await makeDemo({ bpm: d.bpm, root: d.root, minor: d.minor, bars: 32 });
    const L = new Int16Array(buf.length), R = new Int16Array(buf.length); const a = buf.getChannelData(0), b = buf.getChannelData(1);
    for (let i = 0; i < buf.length; i++) { L[i] = Math.max(-1, Math.min(1, a[i])) * 32767; R[i] = Math.max(-1, Math.min(1, b[i])) * 32767; }
    const blob = encodeWAV([L, R], buf.sampleRate, { title: d.name, user: 'DJ Mili', copyright: 'CC0 - autoría propia', comment: 'Pista demo generada' });
    const id = 'demo-' + d.bpm;
    const tr = { id, name: d.name + '.wav', title: d.name, artist: 'DJ Mili (demo CC0)', size: blob.size, type: 'audio/wav', dur: buf.duration, added: Date.now(), stored: true, demo: true };
    await idb.put('blobs', blob, id); await idb.put('tracks', tr); tracks.push(tr);
  }
  settings.set('demoDone', true);
  $('#anaMsg').textContent = '';
}

// ---------------- Biblioteca ----------------
const AUD_RE = /\.(mp3|flac|wav|m4a|aac|ogg|oga|opus)$/i, VID_RE = /\.(mp4|webm|mov|m4v|mkv|3gp)$/i;
const isVideoFile = f => /^video\//.test(f.type) || VID_RE.test(f.name);
async function askPersist() { try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) { const ok = await navigator.storage.persist(); audit('permiso almacenamiento', ok ? 'ok' : 'error', ok ? 'persistente' : 'el navegador lo negó'); } } catch (e) {} }
async function audioOnlyBlob(f) {
  // 1) MP4/MOV/M4V con AAC: copia exacta del audio (sin recodificar)
  if (/\.(mp4|mov|m4v|3gp)$/i.test(f.name) || /mp4|quicktime/.test(f.type)) { try { return { blob: await extractAAC(f), how: 'AAC copiado' }; } catch (e) { console.warn('aac', e); } }
  // 2) Otro (WebM/MKV…): decodificar y guardar FLAC sin pérdida
  const buf = await eng.ctx.decodeAudioData(await f.arrayBuffer());
  const L = floatTo16(buf.getChannelData(0), false), R = floatTo16(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0), false);
  return { blob: encodeFLAC([L, R], buf.sampleRate, { title: f.name }), how: 'FLAC' };
}
async function importFiles(files) {
  const save = $('#saveCopies').checked, audioOnly = $('#audioOnly').checked; let n = 0, skip = 0; const added = [];
  const list = files.filter(f => AUD_RE.test(f.name) || VID_RE.test(f.name) || /^(audio|video)\//.test(f.type));
  skip = files.length - list.length;
  if (save && list.length) await askPersist();
  for (const f of list) {
    $('#impMsg').textContent = `Importando ${n + 1}/${list.length}: ${f.name}`;
    const id = 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const video = isVideoFile(f);
    const tags = video ? {} : await readTags(f);
    const base = f.name.replace(/\.[^.]+$/, '');
    const tr = { id, name: f.name, title: video ? base : (tags.title || base), artist: tags.artist || '', album: tags.album || '', genre: tags.genre || '', size: f.size, type: f.type, added: Date.now(), stored: false, tagBpm: parseFloat(tags.bpm) || 0, video };
    let blob = f;
    if (video && audioOnly) { try { const r = await audioOnlyBlob(f); blob = r.blob; tr.extracted = r.how; tr.size = blob.size; tr.origSize = f.size; } catch (e) { audit('extraer audio', 'error', f.name + ': ' + e.message); } }
    if (save) { try { await idb.put('blobs', blob, id); tr.stored = true; } catch (e) { session.set(id, blob); toast('Sin espacio para copia: queda solo en esta sesión'); } } else session.set(id, blob);
    await idb.put('tracks', tr); tracks.push(tr); added.push(tr); n++;
    audit('importar ' + (video ? 'video' : 'archivo'), 'ok', f.name + (tr.extracted ? ' · solo audio (' + tr.extracted + ')' : ''));
    if (n % 10 === 0) renderLib();
  }
  $('#impMsg').textContent = n ? `${n} agregada(s)${skip ? ` · ${skip} ignorado(s) (no es audio/video)` : ''}` : 'No se agregó nada';
  toast(n + ' canción(es) agregada(s)'); renderLib(); renderStorage(); analyzePending(); return added;
}
async function renderStorage() {
  try {
    const e = await navigator.storage.estimate(); const per = await navigator.storage.persisted?.();
    const mb = x => x > 1073741824 ? (x / 1073741824).toFixed(2) + ' GB' : (x / 1048576).toFixed(0) + ' MB';
    $('#storeInfo').innerHTML = `${mb(e.usage)} usados · ${mb(Math.max(0, e.quota - e.usage))} libres · ${per ? '🔒 persistente' : '<a href="#" id="persistA">⚠ pedir persistente</a>'}`;
    const a = $('#persistA'); if (a) a.onclick = async ev => { ev.preventDefault(); await askPersist(); renderStorage(); };
  } catch (e) { $('#storeInfo').textContent = ''; }
  $('#libCount').textContent = '(' + tracks.length + ')';
}
async function getBlob(tr) { if (session.has(tr.id)) return session.get(tr.id); if (tr.handle) { try { return await tr.handle.getFile(); } catch (e) {} } return idb.get('blobs', tr.id); }
async function decodeTrack(tr) {
  const blob = await getBlob(tr); if (!blob) throw new Error('Archivo no disponible: vuelve a agregarlo');
  let last; for (let k = 0; k < 3; k++) { try { return await eng.ctx.decodeAudioData(await blob.arrayBuffer()); } catch (e) { last = e; await new Promise(r => setTimeout(r, 250 * (k + 1))); } }
  throw new Error('No se pudo leer el audio (' + (last?.message || 'formato') + ')');
}
function measureLoudness(tr, buf) {
  const ch = [buf.getChannelData(0)]; if (buf.numberOfChannels > 1) ch.push(buf.getChannelData(1));
  const r = integratedLoudness(ch, buf.sampleRate); tr.lufs = Math.round(r.lufs * 10) / 10; tr.peakDb = Math.round(r.peak * 10) / 10; return tr;
}
const normOn = () => settings.get('normalize', true);
const trackNorm = tr => normOn() ? normGainDb(tr.lufs, tr.peakDb) : 0;
let analyzing = false;
async function analyzeTrack(tr, buf) {
  const b = await detectBPM(buf); const k = await detectKey(buf); measureLoudness(tr, buf);
  tr.dur = buf.duration; tr.bpm = b.bpm || tr.tagBpm || 0; tr.offset = b.offset; tr.bpmConf = b.confidence;
  if (k) { tr.key = k.name; tr.camelot = k.camelot; }
  tr.analyzed = true; await idb.put('tracks', tr); return tr;
}
async function analyzePending() {
  if (analyzing) return; analyzing = true;
  try {
    for (const tr of tracks) {
      if (tr.analyzed) continue;
      $('#anaMsg').textContent = 'Analizando BPM y tono: ' + tr.title;
      try { const buf = await decodeTrack(tr); await analyzeTrack(tr, buf); audit('analizar', 'ok', `${tr.title} ${tr.bpm} BPM ${tr.camelot || ''}`); }
      catch (e) { tr.analyzed = true; tr.err = e.message; audit('analizar', 'error', tr.title + ': ' + e.message); }
      renderLib();
    }
  } finally { analyzing = false; $('#anaMsg').textContent = ''; }
}
function playingKey() { const d = eng.decks.find(d => d.playing && d.track) || eng.decks.find(d => d.track); return d ? { cam: d.track.camelot, bpm: d.effBpm || d.track.bpm } : null; }
function renderLib() {
  const q = $('#q').value.trim().toLowerCase(); const only = $('#harmOnly').checked; const pk = eng && playingKey();
  const box = $('#libList'); box.innerHTML = '';
  let list = tracks.filter(t => !q || [t.title, t.artist, t.album, t.genre, t.camelot, t.key, String(Math.round(t.bpm || 0))].join(' ').toLowerCase().includes(q));
  if (only && pk && pk.cam) list = list.filter(t => camelotNeighbors(pk.cam).includes(t.camelot) && (!pk.bpm || !t.bpm || Math.abs(t.bpm - pk.bpm) / pk.bpm < 0.08));
  if (!list.length) box.innerHTML = '<p class="muted center small">Nada por aquí. Agrega canciones o videos de tu cel.</p>';
  $('#libCount').textContent = '(' + tracks.length + ')';
  for (const t of list) {
    const comp = pk && pk.cam && t.camelot ? camelotCompatible(pk.cam, t.camelot) : null;
    const col = comp === 'perfecta' || (comp && comp.startsWith('compatible')) ? 'var(--g)' : comp === 'energía (+2)' ? 'var(--y)' : comp ? 'var(--r)' : 'var(--line)';
    const it = el('div', { class: 'it' }, `<div class="t"><b>${t.video ? '<span class="vid">' + (t.extracted ? 'VIDEO→AUDIO' : 'VIDEO') + '</span>' : ''}${esc(t.title)}</b><small><span class="dot" style="background:${col}"></span>${esc(t.artist || '')} · ${t.analyzed ? (t.bpm ? t.bpm.toFixed(1) + ' BPM' : '? BPM') : '…'} · ${esc(t.camelot ? t.camelot + ' ' + t.key : '')} · ${fmt(t.dur)}${t.lufs !== undefined ? ' · ' + t.lufs + ' LUFS' : ''}${t.stored ? '' : ' · sesión'}${t.err ? ' · ⚠️' : ''}</small></div>`);
    const bA = el('button', { class: 'btn a' }, 'A'), bB = el('button', { class: 'btn b' }, 'B'), bQ = el('button', { class: 'btn' }, '+Cola'), bM = el('button', { class: 'btn' }, '⋮');
    bA.onclick = () => loadToDeck(0, t); bB.onclick = () => loadToDeck(1, t); bQ.onclick = () => { queue.push(t.id); saveQueue(); toast('En cola: ' + t.title); };
    bM.onclick = () => trackMenu(t);
    it.append(bA, bB, bQ, bM); box.append(it);
  }
}
function sheet(title, items) {
  $('#sheetTitle').textContent = title; const box = $('#sheetBtns'); box.innerHTML = '';
  for (const [label, fn, cls] of items) { const b = el('button', { class: 'btn ' + (cls || '') }, label); b.onclick = () => { $('#sheet').classList.add('hidden'); fn(); }; box.append(b); }
  $('#sheet').classList.remove('hidden');
}
async function deleteTrack(t) {
  if (!confirm('¿Borrar "' + t.title + '" de la app?')) return;
  tracks = tracks.filter(x => x !== t); queue = queue.filter(id => id !== t.id); saveQueue();
  await idb.del('tracks', t.id); await idb.del('blobs', t.id); session.delete(t.id);
  audit('borrar canción', 'ok', t.title); renderLib(); renderStorage();
}
async function makeAudioOnly(t) {
  const blob = await getBlob(t); if (!blob) return toast('Archivo no disponible');
  toast('Extrayendo audio…');
  try { const f = new File([blob], t.name, { type: t.type }); const r = await audioOnlyBlob(f); await idb.put('blobs', r.blob, t.id); t.origSize = t.size; t.size = r.blob.size; t.extracted = r.how; await idb.put('tracks', t); audit('extraer audio', 'ok', `${t.title}: ${(t.origSize / 1048576).toFixed(1)} → ${(t.size / 1048576).toFixed(1)} MB (${r.how})`); toast(`Listo: ${(t.origSize / 1048576).toFixed(1)} → ${(t.size / 1048576).toFixed(1)} MB`); renderLib(); renderStorage(); }
  catch (e) { toast('No se pudo extraer: ' + e.message); audit('extraer audio', 'error', e.message); }
}
function trackMenu(t) {
  const pls = settings.get('playlists', []);
  const items = [['▶ Cargar en deck A', () => loadToDeck(0, t)], ['▶ Cargar en deck B', () => loadToDeck(1, t)], ['＋ A la cola', () => { queue.push(t.id); saveQueue(); toast('En cola: ' + t.title); }]];
  pls.forEach(p => items.push(['☰ Agregar a "' + p.name + '"', () => { p.ids.push(t.id); settings.set('playlists', pls); renderPlaylists(); toast('Agregada a ' + p.name); }]));
  if (t.video && !t.extracted && t.stored) items.push(['🎵 Guardar solo el audio (ahorra espacio)', () => makeAudioOnly(t)]);
  items.push(['🗑 Borrar de la app', () => deleteTrack(t), 'danger']);
  sheet(t.title + ' · ' + (t.size / 1048576).toFixed(1) + ' MB', items);
}
async function loadToDeck(i, tr) {
  const d = eng.decks[i];
  if (d.playing && !confirm(`El deck ${'AB'[i]} está sonando. ¿Cargar de todos modos?`)) return false;
  toast('Cargando en ' + 'AB'[i] + '…');
  try {
    const buf = await decodeTrack(tr);
    if (!tr.analyzed || !tr.bpm) await analyzeTrack(tr, buf);
    if (tr.lufs === undefined) { measureLoudness(tr, buf); idb.put('tracks', tr); }
    d.load(buf, tr, { bpm: tr.bpm, offset: tr.offset, key: tr.camelot, cues: tr.cues, normDb: trackNorm(tr) });
    d.setRate(1); deckUI[i].render(); deckUI[i].drawOverview(); updateHarm();
    audit('cargar deck ' + 'AB'[i], 'ok', tr.title);
    showTab('mix');
    return true;
  } catch (e) { toast(e.message); audit('cargar deck ' + 'AB'[i], 'error', tr.title + ': ' + e.message); return false; }
}
function updateHarm() {
  const [a, b] = eng.decks; const h = $('#harm');
  if (a.track && b.track && a.track.camelot && b.track.camelot) {
    const c = camelotCompatible(a.track.camelot, b.track.camelot); h.textContent = `${a.track.camelot} ↔ ${b.track.camelot}: ${c}`;
    h.className = 'badge ' + (c === 'choca' ? 'bad' : c.startsWith('energía') ? 'warn' : 'ok');
  } else { h.textContent = 'Tono: —'; h.className = 'badge'; }
}

// ---------------- Cola y listas ----------------
let queue = settings.get('queue', []);
function saveQueue() { settings.set('queue', queue); renderQueue(); }
function renderQueue() {
  $('#qCount').textContent = queue.length ? '(' + queue.length + ')' : '';
  const box = $('#qList'); box.innerHTML = '';
  if (!queue.length) box.innerHTML = '<p class="muted center small">Cola vacía.</p>';
  queue.forEach((id, i) => {
    const t = tracks.find(x => x.id === id); if (!t) return;
    const it = el('div', { class: 'it' }, `<div class="t"><b>${i + 1}. ${esc(t.title)}</b><small>${t.bpm ? t.bpm.toFixed(1) + ' BPM' : ''} ${esc(t.camelot || '')}</small></div>`);
    const up = el('button', { class: 'btn' }, '↑'), rm = el('button', { class: 'btn' }, '✕');
    up.onclick = () => { if (i) { [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]]; saveQueue(); } };
    rm.onclick = () => { queue.splice(i, 1); saveQueue(); };
    it.append(up, rm); box.append(it);
  });
}
function renderPlaylists() {
  const pls = settings.get('playlists', []); const box = $('#plList'); box.innerHTML = '';
  if (!pls.length) box.innerHTML = '<p class="muted center small">Crea una lista y agrega canciones con ⋮.</p>';
  pls.forEach((p, i) => {
    const names = p.ids.map(id => tracks.find(t => t.id === id)?.title).filter(Boolean);
    const it = el('div', { class: 'it' }, `<div class="t"><b>${esc(p.name)}</b><small>${names.length} canciones · ${esc(names.slice(0, 3).join(', '))}</small></div>`);
    const q = el('button', { class: 'btn neon' }, 'A la cola'), rm = el('button', { class: 'btn' }, '✕');
    q.onclick = () => { queue.push(...p.ids.filter(id => tracks.some(t => t.id === id))); saveQueue(); toast('Lista en cola'); };
    rm.onclick = () => { if (confirm('¿Borrar lista ' + p.name + '?')) { pls.splice(i, 1); settings.set('playlists', pls); renderPlaylists(); } };
    it.append(q, rm); box.append(it);
  });
}

// ---------------- Decks UI ----------------
const deckUI = [];
const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.mp4,.webm,.mov,.m4v,.mkv';
function buildDecks() {
  for (let i = 0; i < 2; i++) {
    const root = $('#deck' + i), d = eng.decks[i], L = 'AB'[i], p = 'd' + i;
    root.innerHTML = `
      <div class="dsearch"><input class="dq" type="search" placeholder="Buscar canción para ${L}…" enterkeyhint="search" autocomplete="off" data-midi="${p}-search"><label class="btn dcel" title="Elegir canciones o videos del teléfono">📱 Del cel<input type="file" class="dfile" accept="${ACCEPT}" multiple hidden></label><div class="dres hidden"></div></div>
      <div class="hd"><span class="letter">${L}</span><span class="title">Sin canción · elige abajo en Música</span><span class="badge bpm">— BPM</span><span class="badge key">—</span></div>
      <canvas class="zoom"></canvas><canvas class="ovw"></canvas>
      <div class="info"><span><b class="el">0:00</b> / <span class="rm">-0:00</span></span><span class="loopinfo"></span><span class="ng"></span><span class="rt">0.0%</span></div>
      <div class="deckbody">
        <div class="jogcol"><canvas class="jog" data-midi="${p}-jog" title="Jog: gira para empujar/frenar; en pausa busca"></canvas><canvas class="vu"></canvas></div>
        <div class="ctlcol">
          <div class="ctl">
            <button class="btn cue" data-midi="${p}-cue">CUE</button>
            <button class="btn play" data-midi="${p}-play">▶</button>
            <button class="btn sync" data-midi="${p}-sync">SYNC</button>
            <button class="btn kl on" data-midi="${p}-keylock" title="Key lock: el tono no cambia al mover el tempo">🔒</button>
          </div>
          <div class="tempo"><input type="range" class="tmp" min="-1" max="1" step="0.001" value="0" data-midi="${p}-tempo"><span class="trng">Tempo ±8% · doble toque = 0</span></div>
          <div class="hot">${[...Array(8)].map((_, k) => `<button class="btn hc" style="--hc:${HC[k]}" data-k="${k}" data-midi="${p}-hc${k}">${k + 1}</button>`).join('')}</div>
          <div class="loops">${[['½', 0.5], ['1', 1], ['2', 2], ['4', 4], ['8', 8], ['16', 16]].map(([t, b]) => `<button class="btn lp" data-b="${b}" data-midi="${p}-loop${b}">${t}</button>`).join('')}<button class="btn del" title="Borrar hot cues">🗑 cue</button></div>
        </div>
      </div>
      <div class="knobrow">
        <label class="kn">Gain<input type="range" class="trim" min="0" max="2" step="0.01" value="1" data-def="1" data-midi="${p}-trim"></label>
        <label class="kn">Hi<input type="range" class="eqh" min="-26" max="6" step="0.5" value="0" data-def="0" data-midi="${p}-high"></label>
        <label class="kn">Mid<input type="range" class="eqm" min="-26" max="6" step="0.5" value="0" data-def="0" data-midi="${p}-mid"></label>
        <label class="kn">Low<input type="range" class="eql" min="-26" max="6" step="0.5" value="0" data-def="0" data-midi="${p}-low"></label>
        <label class="kn">Filtro<input type="range" class="flt" min="-1" max="1" step="0.01" value="0" data-def="0" data-midi="${p}-filter"></label>
        <label class="fader">Vol<input type="range" class="vol" min="0" max="1" step="0.01" value="0.9" data-midi="${p}-vol"></label>
      </div>
      <details><summary>FX: echo, flanger, freno, scratch</summary>
        <div class="fxrow">
          <select class="fx"><option value="none">FX: ninguno</option><option value="echo">Echo (al beat)</option><option value="flanger">Flanger</option></select>
          <input type="range" class="fxw" min="0" max="1" step="0.01" value="0.5" data-midi="${p}-fxwet">
          <button class="btn sm brk" data-midi="${p}-brake">Freno</button>
          <button class="btn sm scr" data-midi="${p}-scratch">Scratch</button>
        </div>
        <div class="row" style="margin-top:6px"><span class="muted tiny">Echo:</span>${[0.25, 0.5, 0.75, 1].map(b => `<button class="btn sm eb" data-b="${b}">${b === 0.75 ? '¾' : b === 0.25 ? '¼' : b === 0.5 ? '½' : '1'}</button>`).join('')}<span class="muted tiny">beat</span></div>
      </details>`;
    const q = s => root.querySelector(s);
    const ui = { root, d, i, delMode: false, ovImg: null, echoBeats: 0.75, range: 0.08 };
    const zoom = q('.zoom'), ovw = q('.ovw');
    ui.render = () => {
      const t = d.track;
      q('.title').textContent = t ? t.title + (t.artist ? ' – ' + t.artist : '') : 'Sin canción · elige abajo en Música';
      q('.bpm').textContent = d.bpm ? d.effBpm.toFixed(1) + ' BPM' : '— BPM';
      q('.key').textContent = t?.camelot ? t.camelot + ' · ' + t.key : '—';
      q('.play').classList.toggle('on', d.playing); q('.play').textContent = d.playing ? '❚❚' : '▶';
      q('.rt').textContent = ((d.rate - 1) * 100).toFixed(1) + '%';
      root.querySelectorAll('.hc').forEach((b, k) => b.classList.toggle('set', d.cues[k] != null));
      root.querySelectorAll('.lp').forEach(b => b.classList.toggle('on', !!d.loop && d.loop.beats == b.dataset.b));
      q('.del').classList.toggle('on', ui.delMode);
      q('.loopinfo').textContent = d.loop ? '⟲ ' + d.loop.beats + ' beats' : '';
      q('.kl').classList.toggle('on', d.keylock);
      q('.ng').textContent = t && t.lufs !== undefined ? (d.normDb ? `Vol ${d.normDb > 0 ? '+' : ''}${d.normDb.toFixed(1)} dB` : `${t.lufs} LUFS`) : '';
    };
    ui.drawOverview = () => {
      const w = d.wave; const cw = ovw.clientWidth * devicePixelRatio, ch = ovw.clientHeight * devicePixelRatio; ovw.width = cw; ovw.height = ch;
      const off = document.createElement('canvas'); off.width = cw; off.height = ch; const g = off.getContext('2d');
      if (w) { const n = w.peak.length, mx = maxBands(w);
        for (let x = 0; x < cw; x++) { const a = Math.floor(x / cw * n), b = Math.max(a + 1, Math.floor((x + 1) / cw * n)); let pk = 0, lo = 0, mi = 0, hi = 0; for (let k = a; k < b; k++) { pk = Math.max(pk, w.peak[k]); lo += w.lo[k]; mi += w.mi[k]; hi += w.hi[k]; } const c = b - a; g.fillStyle = bandColor(lo / c / mx.lo, mi / c / mx.mi, hi / c / mx.hi); const h = Math.max(1, pk * ch); g.fillRect(x, (ch - h) / 2, 1, h); } }
      ui.ovImg = off;
    };
    ui.draw = () => {
      const cw = zoom.clientWidth * devicePixelRatio, ch = zoom.clientHeight * devicePixelRatio;
      if (zoom.width !== cw) { zoom.width = cw; zoom.height = ch; }
      const g = zoom.getContext('2d'); g.clearRect(0, 0, cw, ch);
      const pos = d.position(), w = d.wave;
      if (w) {
        const span = 8, fps = w.fps, mx = maxBands(w), mid = ch / 2;
        if (d.loop) { const x1 = (d.loop.start - pos + span / 2) / span * cw, x2 = (d.loop.end - pos + span / 2) / span * cw; g.fillStyle = 'rgba(57,255,136,.15)'; g.fillRect(x1, 0, x2 - x1, ch); }
        for (let x = 0; x < cw; x += 2) { const t = pos - span / 2 + x / cw * span; const k = Math.floor(t * fps); if (k < 0 || k >= w.peak.length) continue; const h = w.peak[k] * ch * 0.95; g.fillStyle = bandColor(w.lo[k] / mx.lo, w.mi[k] / mx.mi, w.hi[k] / mx.hi); g.fillRect(x, mid - h / 2, 2, h); }
        if (d.bpm) { const bl = 60 / d.bpm; let t = d.beatOffset + Math.ceil((pos - span / 2 - d.beatOffset) / bl) * bl; let n = Math.round((t - d.beatOffset) / bl); for (; t < pos + span / 2; t += bl, n++) { const x = (t - pos + span / 2) / span * cw; g.fillStyle = n % 4 === 0 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.18)'; g.fillRect(x, 0, n % 4 === 0 ? 2 : 1, ch); } }
        d.cues.forEach((c, k) => { if (c == null) return; const x = (c - pos + span / 2) / span * cw; if (x < 0 || x > cw) return; g.fillStyle = HC[k]; g.fillRect(x, 0, 3, ch); g.fillRect(x, 0, 12, 10); });
      }
      g.fillStyle = '#fff'; g.fillRect(cw / 2 - 1, 0, 2, ch);
      // overview
      const og = ovw.getContext('2d'); if (ovw.width !== ovw.clientWidth * devicePixelRatio) ui.drawOverview();
      og.clearRect(0, 0, ovw.width, ovw.height); if (ui.ovImg) og.drawImage(ui.ovImg, 0, 0);
      if (d.duration) { const x = pos / d.duration * ovw.width; og.fillStyle = 'rgba(0,0,0,.45)'; og.fillRect(0, 0, x, ovw.height); og.fillStyle = '#fff'; og.fillRect(x - 1, 0, 2, ovw.height); }
      q('.el').textContent = fmt(pos); q('.rm').textContent = '-' + fmt((d.duration - pos) / d.rate);
    };
    // eventos
    q('.play').onclick = () => { if (!d.buffer) return toast('Carga una canción primero'); const on = d.toggle(); audit((on ? 'play' : 'pausa') + ' deck ' + L, 'ok', d.track?.title); ui.render(); updateHarm(); };
    q('.cue').onclick = () => { if (!d.buffer) return; d.cue(); ui.render(); audit('cue deck ' + L, 'ok', fmt(d.cuePoint)); };
    q('.sync').onclick = () => { const ok = d.sync(eng.decks[1 - i]); q('.sync').classList.toggle('on', ok); setTimeout(() => q('.sync').classList.remove('on'), 600); q('.tmp').value = (d.rate - 1) / ui.range; ui.render(); audit('sync deck ' + L, ok ? 'ok' : 'error', ok ? d.effBpm.toFixed(1) + ' BPM' : 'falta BPM'); if (!ok) toast('Faltan BPM en algún deck'); };
    q('.kl').onclick = () => { d.setKeylock(!d.keylock); settings.set('keylock' + i, d.keylock); ui.render(); toast(d.keylock ? 'Key lock: el tono se mantiene al cambiar tempo' : 'Key lock apagado: el tempo cambia el tono (como vinil)'); audit('key lock deck ' + L, 'ok', d.keylock ? 'on' : 'off'); };
    d.setKeylock(settings.get('keylock' + i, true));
    const tmp = q('.tmp'); tmp.oninput = () => { d.setRate(1 + tmp.value * ui.range); ui.render(); };
    tmp.ondblclick = () => { tmp.value = 0; tmp.oninput(); };
    q('.trng').onclick = () => { ui.range = ui.range === 0.08 ? 0.16 : ui.range === 0.16 ? 0.5 : 0.08; q('.trng').textContent = 'Tempo ±' + Math.round(ui.range * 100) + '% · toca para cambiar'; tmp.oninput(); };
    root.querySelectorAll('.hc').forEach(b => b.onclick = () => { if (!d.buffer) return; const k = +b.dataset.k; const r = d.hotcue(k, ui.delMode ? 'del' : 'go'); ui.render(); audit('hot cue ' + (k + 1) + ' deck ' + L, 'ok', r); if (d.track) { d.track.cues = d.cues.slice(); idb.put('tracks', d.track); } });
    q('.del').onclick = () => { ui.delMode = !ui.delMode; ui.render(); if (ui.delMode) toast('Toca un hot cue para borrarlo'); };
    root.querySelectorAll('.lp').forEach(b => b.onclick = () => { if (!d.buffer) return; const r = d.setLoop(+b.dataset.b); ui.render(); audit('loop ' + b.dataset.b + ' beats deck ' + L, 'ok', r ? 'activado' : 'salida'); });
    q('.vol').oninput = e => d.vol.gain.setTargetAtTime(+e.target.value, eng.t(), 0.01);
    q('.trim').oninput = e => d.trim.gain.setTargetAtTime(+e.target.value, eng.t(), 0.01);
    q('.flt').oninput = e => d.setFilter(+e.target.value); q('.flt').ondblclick = e => { e.target.value = 0; d.setFilter(0); };
    q('.eqh').oninput = e => d.setEQ3('high', +e.target.value); q('.eqm').oninput = e => d.setEQ3('mid', +e.target.value); q('.eql').oninput = e => d.setEQ3('low', +e.target.value);
    q('.fx').onchange = e => { d.setFX(e.target.value, +q('.fxw').value, ui.echoBeats); audit('FX deck ' + L, 'ok', e.target.value); };
    q('.fxw').oninput = e => d.setFX(d.fx, +e.target.value, ui.echoBeats);
    root.querySelectorAll('.eb').forEach(b => b.onclick = () => { ui.echoBeats = +b.dataset.b; d.setFX(d.fx, d.fxWet, ui.echoBeats); toast('Echo: ' + b.textContent + ' beat'); });
    q('.brk').onclick = () => { d.brake(); audit('freno deck ' + L, 'ok'); setTimeout(ui.render, 1300); };
    q('.scr').onclick = () => { d.scratch(); audit('scratch deck ' + L, 'ok'); };
    ovw.onclick = e => { if (!d.buffer) return; const r = ovw.getBoundingClientRect(); d.seek((e.clientX - r.left) / r.width * d.duration); };
    // arrastre en la onda = pitch bend (empujar/frenar)
    let sx = null; zoom.onpointerdown = e => { sx = e.clientX; zoom.setPointerCapture(e.pointerId); };
    zoom.onpointermove = e => { if (sx == null || !d.playing) return; const dx = e.clientX - sx; d.nudge(1 + Math.max(-0.3, Math.min(0.3, -dx / 300))); };
    zoom.onpointerup = zoom.onpointercancel = () => { if (sx != null && d.playing) { d.nudge(1); } sx = null; };
    // Jog wheel: girar = empujar/frenar (tocando) o buscar (en pausa)
    const jog = q('.jog'), vu = q('.vu'); let ja = null, jlast = 0;
    const ang = e => { const r = jog.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2); };
    jog.onpointerdown = e => { if (!d.buffer) return; ja = ang(e); jlast = performance.now(); jog.setPointerCapture(e.pointerId); ui.touch = true; };
    jog.onpointermove = e => { if (ja == null) return; const a = ang(e); let da = a - ja; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; ja = a; const now = performance.now(), dt = Math.max(8, now - jlast); jlast = now;
      if (d.playing) d.nudge(1 + Math.max(-0.4, Math.min(0.4, da / (dt / 1000) / 12))); else d.seek(Math.max(0, Math.min(d.duration, d.position() + da / (2 * Math.PI) * 1.8))); };
    jog.onpointerup = jog.onpointercancel = () => { if (ja != null && d.playing) d.nudge(1); ja = null; ui.touch = false; };
    ui.vuPk = 0; ui.vuHold = 0;
    ui.drawJog = () => {
      const S = Math.round(jog.clientWidth * devicePixelRatio); if (!S) return;
      if (jog.width !== S) { jog.width = jog.height = S; ui.plate = makePlatter(S, i ? '#ff2bd6' : '#00e5ff'); }
      const g = jog.getContext('2d'), pos = d.position(), c = S / 2; g.clearRect(0, 0, S, S);
      g.save(); g.translate(c, c); g.rotate(pos * 2 * Math.PI * 33.333 / 60); g.drawImage(ui.plate, -c, -c); g.restore();
      const col = i ? '#ff2bd6' : '#00e5ff'; g.lineWidth = S * 0.045; g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(c, c, c - g.lineWidth, 0, 2 * Math.PI); g.stroke();
      if (d.duration) { g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = S * 0.06; g.beginPath(); g.arc(c, c, c - g.lineWidth, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * pos / d.duration); g.stroke(); g.shadowBlur = 0; }
      if (ui.touch) { g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(c, c, c * 0.86, 0, 2 * Math.PI); g.fill(); }
    };
    ui.drawVU = () => {
      const W = Math.round(vu.clientWidth * devicePixelRatio), H = Math.round(vu.clientHeight * devicePixelRatio); if (!W || !H) return; if (vu.width !== W) { vu.width = W; vu.height = H; }
      const lv = d.level(); ui.vuPk = Math.max(lv, ui.vuPk * 0.86); if (lv >= ui.vuHold) { ui.vuHold = lv; ui.vuHT = 30; } else if (--ui.vuHT < 0) ui.vuHold *= 0.95;
      const db = x => Math.max(0, Math.min(1, (20 * Math.log10(x + 1e-6) + 48) / 48)); const g = vu.getContext('2d'); g.clearRect(0, 0, W, H);
      const N = 14, sh = H / N; const on = Math.round(db(ui.vuPk) * N), hold = Math.min(N - 1, Math.round(db(ui.vuHold) * N));
      for (let k = 0; k < N; k++) { const y = H - (k + 1) * sh; const col = k >= N - 2 ? '#ff3b5c' : k >= N - 5 ? '#ffd23f' : '#39ff88'; g.fillStyle = k < on || k === hold && ui.vuHold > 0.01 ? col : 'rgba(255,255,255,.07)'; g.fillRect(0, y + 1, W, sh - 2); }
    };
    root.querySelectorAll('.kn input').forEach(knobify);
    // Buscar y cargar justo arriba del deck
    const dq = q('.dq'), dres = q('.dres');
    ui.showRes = () => {
      const qs = dq.value.trim().toLowerCase(), other = eng.decks[1 - i].track; const cam = other?.camelot;
      let list = tracks.filter(t => !qs || [t.title, t.artist, t.album, t.genre, t.camelot, t.key, String(Math.round(t.bpm || 0)), t.name].join(' ').toLowerCase().includes(qs));
      const score = t => { const c = cam && t.camelot ? camelotCompatible(cam, t.camelot) : ''; return (c === 'perfecta' || c.startsWith?.('compatible') ? 0 : c === 'energía (+2)' ? 1 : 2) + (recentPlayed.includes(t.id) ? 3 : 0); };
      if (!qs && cam) list.sort((a, b) => score(a) - score(b));
      list = list.slice(0, 30); dres.innerHTML = '';
      if (!list.length) dres.innerHTML = `<p class="muted small center">${tracks.length ? 'Sin resultados' : 'Aún no hay canciones: toca 📱 Del cel'}</p>`;
      for (const t of list) {
        const c = cam && t.camelot ? camelotCompatible(cam, t.camelot) : null; const col = c === 'perfecta' || (c && c.startsWith('compatible')) ? 'var(--g)' : c === 'energía (+2)' ? 'var(--y)' : c ? 'var(--r)' : 'var(--line)';
        const r = el('button', { class: 'dr' }, `<b>${t.video ? '<span class="vid">VIDEO</span>' : ''}${esc(t.title)}</b><small><span class="dot" style="background:${col}"></span>${esc(t.artist || '')}${t.bpm ? ' · ' + t.bpm.toFixed(0) + ' BPM' : ''}${t.camelot ? ' · ' + t.camelot : ''}${t.dur ? ' · ' + fmt(t.dur) : ''}</small>`);
        r.onpointerdown = e => e.preventDefault(); r.onclick = () => { dres.classList.add('hidden'); dq.value = ''; dq.blur(); loadToDeck(i, t); };
        dres.append(r);
      }
      dres.classList.remove('hidden');
    };
    dq.oninput = ui.showRes; dq.onfocus = ui.showRes; dq.onblur = () => setTimeout(() => dres.classList.add('hidden'), 150);
    dq.onkeydown = e => { if (e.key === 'Enter') { const f = dres.querySelector('.dr'); if (f) f.click(); } if (e.key === 'Escape') dq.blur(); };
    q('.dfile').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return; const added = await importFiles(fs); if (added && added.length) { await loadToDeck(i, added[0]); if (added.length > 1) toast(`${added[0].title} en ${L} · ${added.length - 1} más en la biblioteca`); } };
    d.onEnd = () => { ui.render(); audit('fin de pista deck ' + L, 'ok', d.track?.title); };
    deckUI.push(ui); ui.render();
  }
}
// Plato pre-renderizado (se rota con drawImage: barato)
function makePlatter(S, col) {
  const o = document.createElement('canvas'); o.width = o.height = S; const g = o.getContext('2d'), c = S / 2;
  const rg = g.createRadialGradient(c, c, S * 0.05, c, c, c); rg.addColorStop(0, '#2a2640'); rg.addColorStop(0.55, '#121022'); rg.addColorStop(1, '#07060f'); g.fillStyle = rg; g.beginPath(); g.arc(c, c, c * 0.9, 0, 2 * Math.PI); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1; for (let r = c * 0.36; r < c * 0.88; r += Math.max(2, S / 70)) { g.beginPath(); g.arc(c, c, r, 0, 2 * Math.PI); g.stroke(); }
  const sg = g.createConicGradient ? g.createConicGradient(0, c, c) : null; if (sg) { sg.addColorStop(0, 'rgba(255,255,255,.10)'); sg.addColorStop(0.12, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,.07)'); sg.addColorStop(0.62, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(255,255,255,.10)'); g.fillStyle = sg; g.beginPath(); g.arc(c, c, c * 0.9, 0, 2 * Math.PI); g.fill(); }
  g.fillStyle = col; g.shadowColor = col; g.shadowBlur = S * 0.08; g.beginPath(); g.arc(c, c, c * 0.3, 0, 2 * Math.PI); g.fill(); g.shadowBlur = 0;
  g.fillStyle = '#07060f'; g.beginPath(); g.arc(c, c, c * 0.05, 0, 2 * Math.PI); g.fill();
  g.fillStyle = '#fff'; g.fillRect(c - S * 0.012, c * 0.12, S * 0.024, c * 0.3); // marca de giro
  return o;
}
// Perilla giratoria ligera sobre un input range (MIDI y eventos siguen en el input)
function knobify(inp) {
  if (inp._knob) return; const k = document.createElement('div'); k.className = 'knob'; k.dataset.midi = inp.dataset.midi; k.innerHTML = '<i></i><b></b>'; inp.after(k); inp._knob = k; inp.classList.add('knobsrc');
  const mn = +inp.min, mx = +inp.max, def = inp.dataset.def !== undefined ? +inp.dataset.def : mn, P = v => (v - mn) / (mx - mn);
  const upd = () => { const p = P(+inp.value), p0 = P(def); k.style.setProperty('--a', (p * 270 - 135) + 'deg'); k.style.setProperty('--s', Math.min(p, p0) * 270 + 'deg'); k.style.setProperty('--e', Math.max(p, p0) * 270 + 'deg'); k.querySelector('b').textContent = Math.abs(mx - mn) > 10 ? (+inp.value > 0 ? '+' : '') + (+inp.value).toFixed(0) : (+inp.value).toFixed(2); };
  inp.addEventListener('input', upd); upd();
  let y0 = null, v0 = 0, lastTap = 0;
  k.addEventListener('pointerdown', e => { if (document.body.classList.contains('learning')) return; e.preventDefault(); const now = Date.now(); if (now - lastTap < 300) { inp.value = def; inp.dispatchEvent(new Event('input')); } lastTap = now; y0 = e.clientY; v0 = +inp.value; k.setPointerCapture(e.pointerId); k.classList.add('on'); });
  k.addEventListener('pointermove', e => { if (y0 == null) return; const v = Math.max(mn, Math.min(mx, v0 + (y0 - e.clientY) / 160 * (mx - mn))); if (v !== +inp.value) { inp.value = v; inp.dispatchEvent(new Event('input')); } });
  const end = () => { y0 = null; k.classList.remove('on'); }; k.addEventListener('pointerup', end); k.addEventListener('pointercancel', end);
}
const _mx = new WeakMap();
function maxBands(w) { let m = _mx.get(w); if (m) return m; m = { lo: 1e-6, mi: 1e-6, hi: 1e-6 }; for (let k = 0; k < w.lo.length; k++) { if (w.lo[k] > m.lo) m.lo = w.lo[k]; if (w.mi[k] > m.mi) m.mi = w.mi[k]; if (w.hi[k] > m.hi) m.hi = w.hi[k]; } m.lo *= 0.8; m.mi *= 0.8; m.hi *= 0.8; _mx.set(w, m); return m; }
function bandColor(l, m, h) { const r = Math.min(255, 60 + l * 230), g = Math.min(255, 40 + m * 200), b = Math.min(255, 80 + h * 230); return `rgb(${r | 0},${g | 0},${b | 0})`; }

// ---------------- Auto‑mix ----------------
let mixing = null;
function activeDeck() { const [a, b] = eng.decks; if (a.playing && !b.playing) return 0; if (b.playing && !a.playing) return 1; if (a.playing && b.playing) return eng.xf <= 0.5 ? 0 : 1; return -1; }
function pickNext(exclude) {
  while (queue.length) { const id = queue.shift(); saveQueue(); const t = tracks.find(x => x.id === id); if (t) return t; }
  const cur = eng.decks.map(d => d.track?.id); const ref = eng.decks.find(d => d.playing)?.track;
  const pool = tracks.filter(t => !cur.includes(t.id) && t.analyzed && !t.err && !recentPlayed.includes(t.id));
  if (!pool.length) return tracks.find(t => !cur.includes(t.id)) || null;
  if (ref?.camelot) { const nb = camelotNeighbors(ref.camelot); const good = pool.filter(t => nb.includes(t.camelot)); if (good.length) return good[0]; }
  return pool[0];
}
const recentPlayed = [];
let preloading = false;
async function automixTick() {
  if (!eng) return;
  const on = $('#automix').checked; if (!on) { mixing = null; return; }
  const ai = activeDeck(); if (ai < 0 || mixing) return;
  const a = eng.decks[ai], bi = 1 - ai, b = eng.decks[bi];
  if (!a.buffer) return;
  if ((!b.track || b._used) && !preloading) {
    const nx = pickNext(); if (!nx) { $('#mixMsg').textContent = 'Auto‑mix: no hay siguiente canción'; return; }
    preloading = true; $('#mixMsg').textContent = 'Auto‑mix: preparando ' + nx.title + ' en ' + 'AB'[bi];
    try { const buf = await decodeTrack(nx); if (!nx.analyzed || !nx.bpm) await analyzeTrack(nx, buf); if (nx.lufs === undefined) measureLoudness(nx, buf); b.load(buf, nx, { bpm: nx.bpm, offset: nx.offset, key: nx.camelot, cues: nx.cues, normDb: trackNorm(nx) }); b._used = false; deckUI[bi].render(); deckUI[bi].drawOverview(); updateHarm(); }
    catch (e) { audit('automix cargar', 'error', e.message); }
    preloading = false; return;
  }
  if (!b.buffer || b.playing) return;
  const beats = +$('#mixBeats').value; const ebpm = a.bpm ? a.effBpm : 120; const mixDur = beats * 60 / ebpm;
  const remaining = (a.duration - a.position()) / a.rate;
  $('#mixMsg').textContent = `Auto‑mix: ${'AB'[bi]} entra en ${fmt(Math.max(0, remaining - mixDur))}`;
  if (remaining > mixDur + 0.25) return;
  // iniciar mezcla sincronizada al beat
  const ctx = eng.ctx;
  b.exitLoop(); b.seek(b.bpm ? b.beatOffset : 0);
  if (a.bpm && b.bpm && Math.abs(a.effBpm / b.bpm - 1) < 0.12) b.setRate(a.effBpm / b.bpm); else b.setRate(1);
  let when = ctx.currentTime + 0.05;
  if (a.bpm) { const bl = 60 / a.effBpm; const p = a.position(); const ph = ((p - a.beatOffset) / a.beatLen()) % 1; const toNext = (1 - (ph < 0 ? ph + 1 : ph)) * bl; when = ctx.currentTime + (toNext < 0.05 ? toNext + bl : toNext); }
  b.play(when); b._used = true;
  const x0 = eng.xf, x1 = bi === 1 ? 1 : 0, t0 = performance.now() + (when - ctx.currentTime) * 1000;
  b.setEQ3('low', -26);
  mixing = { from: ai, to: bi, t0, dur: mixDur * 1000, x0, x1, bassSwap: false };
  audit('automix', 'ok', `${a.track?.title} → ${b.track?.title} (${beats} beats)`);
  deckUI[bi].render();
  const step = () => {
    if (!mixing) return; const k = Math.min(1, Math.max(0, (performance.now() - mixing.t0) / mixing.dur));
    const x = mixing.x0 + (mixing.x1 - mixing.x0) * k; eng.setCrossfader(x); $('#xf').value = x;
    if (k >= 0.5 && !mixing.bassSwap) { mixing.bassSwap = true; b.setEQ3('low', 0); a.setEQ3('low', -26); }
    if (k >= 1) { a.stop(); a.setEQ3('low', 0); a._used = true; recentPlayed.unshift(a.track?.id); recentPlayed.length = Math.min(recentPlayed.length, 20); mixing = null; deckUI.forEach(u => u.render()); updateHarm(); $('#mixMsg').textContent = 'Auto‑mix: listo'; return; }
    setTimeout(step, 30);
  };
  step();
}

// ---------------- Pads (personalizables, bancos de 8) ----------------
const BANKN = ['A · público', 'B · efectos DJ'];
function buildPads() {
  const box = $('#pads'); box.innerHTML = '';
  sampler.pads.forEach((pd, i) => {
    if (i % 8 === 0) box.append(el('div', { class: 'bank' }, 'Banco ' + (BANKN[i / 8] || String.fromCharCode(65 + i / 8) + ' · propios')));
    const p = el('div', { class: 'pad', style: `--pc:${pd.color || PAD_COLORS[i % 16]}`, 'data-midi': 'pad' + i, 'data-i': i }, `<b class="em">⏳</b><span>…</span><i class="gear">⚙</i><i class="lic"></i>`);
    p.addEventListener('pointerdown', e => { if (e.target.classList.contains('gear')) return; e.preventDefault(); firePad(i, 1, 'toque'); });
    p.querySelector('.gear').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); editPad(i); });
    box.append(p); refreshPad(i);
  });
  const add = el('label', { class: 'pad padd', title: 'Agregar pads desde audio o video del teléfono' }, `<b class="em">＋</b><span>Agregar pad</span><input type="file" accept="audio/*,video/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.mp4,.webm,.mov" multiple hidden>`);
  add.querySelector('input').onchange = e => addPads([...e.target.files]).finally(() => { e.target.value = ''; });
  box.append(add);
}
async function addPads(files) {
  let ok = 0;
  for (const f of files) {
    toast('Creando pad: ' + f.name);
    try { const r = await sampler.addFromFile(f); ok++; audit('agregar pad', 'ok', `${f.name} · ${r.pad.buffer.duration.toFixed(1)} s${r.cut ? ' (recortado a 60 s)' : ''} · nivel ${(20 * Math.log10(r.pad.norm)).toFixed(1)} dB`); if (r.cut) toast('Pad recortado a 60 s: ajusta inicio/fin'); }
    catch (e) { audit('agregar pad', 'error', f.name + ': ' + e.message); toast('No se pudo crear el pad: ' + e.message); }
  }
  buildPads(); if (ok === 1) editPad(sampler.pads.length - 1);
}
function refreshPad(i) { const p = sampler.pads[i], n = $$('.pad')[i]; if (!p || !n) return; n.style.setProperty('--pc', p.color || PAD_COLORS[i % 16]); n.querySelector('.em').textContent = p.err ? '⚠️' : p.buffer ? p.emoji : '⏳'; n.querySelector('span').textContent = p.name; n.querySelector('.lic').textContent = p.license === 'cc0' ? 'CC0' : p.license === 'cc' ? 'CC' : '⚠ lic.'; }
function firePad(i, vel = 1, via = 'toque') {
  const ok = sampler.trigger(i, vel); const n = $$('.pad')[i];
  if (!n) return; n.classList.add('hit'); setTimeout(() => n.classList.remove('hit'), 120);
  audit('pad ' + (i + 1), ok ? 'ok' : 'error', (sampler.pads[i]?.name || '') + ' · ' + via);
}
function editPad(i) {
  const p = sampler.pads[i], box = $('#padEdit'); if (!p) return box.classList.add('hidden'); box.classList.remove('hidden');
  const D = p.buffer ? p.buffer.duration : 0, isB = sampler.pads[i] && BUILTIN_IDS.includes(p.uid);
  const sl = (k, label, min, max, st) => `<label>${label} <b class="v-${k}">${p[k]}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${st}" value="${p[k]}"></label>`;
  box.innerHTML = `<div class="row between"><h3>Pad ${i + 1}</h3><button class="btn sm" id="peX">Cerrar</button></div>
    <div class="row"><input id="peName" value="${esc(p.name)}" maxlength="22" placeholder="Nombre"><input type="color" id="peColor" value="${p.color || PAD_COLORS[i % 16]}" title="Color"></div>
    <div class="row wrap" style="margin-top:6px"><button class="btn sm" id="peL" title="Mover a la izquierda">◀</button><button class="btn sm" id="peR" title="Mover a la derecha">▶</button><button class="btn sm" id="peTest">▶ Probar</button>
      <label class="btn sm neon">Cambiar sonido<input type="file" id="peFile" accept="audio/*,video/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.mp4,.webm" hidden></label>${isB ? '<button class="btn sm" id="peReset">Sonido original</button>' : ''}<button class="btn sm danger" id="peDel">🗑 Borrar</button></div>
    <div id="peLic" class="small" style="margin:6px 0"></div>
    <div class="knobs"><label>Inicio <b id="peSv">${(p.start || 0).toFixed(2)} s</b><input type="range" id="peS" min="0" max="${D.toFixed(2)}" step="0.01" value="${p.start || 0}"></label><label>Fin <b id="peEv">${(p.end || D).toFixed(2)} s</b><input type="range" id="peE" min="0" max="${D.toFixed(2)}" step="0.01" value="${p.end || D}"></label></div>
    <div class="knobs">${sl('gain', 'Volumen', 0, 1.5, 0.01)}${sl('reverb', 'Reverb', 0, 1, 0.01)}${sl('delay', 'Delay', 0, 0.9, 0.01)}${sl('delayTime', 'Tiempo delay (s)', 0.05, 1, 0.01)}${sl('low', 'Graves dB', -24, 12, 0.5)}${sl('mid', 'Medios dB', -24, 12, 0.5)}${sl('high', 'Agudos dB', -24, 12, 0.5)}</div>
    <label class="chk"><input type="checkbox" id="peChoke" ${p.choke ? 'checked' : ''}> Cortar el anterior al volver a tocar</label>
    <p class="muted tiny">Duración ${D.toFixed(2)} s · nivel automático ${(20 * Math.log10(p.norm || 1)).toFixed(1)} dB (pads propios a -14 LUFS) · todo pasa por el limitador.</p>`;
  const lic = () => { $('#peLic').innerHTML = p.license === 'cc0' ? '<span class="badge ok">Licencia CC0 ✓</span>' : p.license === 'cc' ? '<span class="badge warn">Creative Commons (revisa atribución)</span>' : '<span class="badge bad">Licencia sin verificar: úsalo solo si es tuyo o tienes permiso</span>'; };
  lic();
  box.querySelectorAll('input[type=range][data-k]').forEach(r => r.oninput = () => { p[r.dataset.k] = +r.value; box.querySelector('.v-' + r.dataset.k).textContent = r.value; sampler.apply(i); sampler.save(); });
  const trim = () => { const s0 = +$('#peS').value, e0 = +$('#peE').value; sampler.setTrim(i, Math.min(s0, e0 - 0.02), Math.max(e0, s0 + 0.02)); $('#peSv').textContent = (p.start || 0).toFixed(2) + ' s'; $('#peEv').textContent = (p.end || D).toFixed(2) + ' s'; };
  $('#peS').oninput = trim; $('#peE').oninput = trim; $('#peS').onchange = $('#peE').onchange = () => { audit('recortar pad ' + (i + 1), 'ok', `${(p.start || 0).toFixed(2)}–${(p.end || D).toFixed(2)} s`); firePad(i, 1, 'prueba'); };
  $('#peName').onchange = e => { p.name = e.target.value.trim() || p.name; sampler.save(); refreshPad(i); audit('renombrar pad ' + (i + 1), 'ok', p.name); };
  $('#peColor').oninput = e => { p.color = e.target.value; sampler.save(); refreshPad(i); };
  $('#peChoke').onchange = e => { p.choke = e.target.checked; sampler.save(); };
  $('#peX').onclick = () => box.classList.add('hidden');
  $('#peTest').onclick = () => firePad(i, 1, 'prueba');
  $('#peL').onclick = () => { if (sampler.move(i, -1)) { buildPads(); editPad(i - 1); } };
  $('#peR').onclick = () => { if (sampler.move(i, 1)) { buildPads(); editPad(i + 1); } };
  $('#peDel').onclick = async () => { if (!confirm('¿Borrar el pad "' + p.name + '"?')) return; await sampler.remove(i); audit('borrar pad', 'ok', p.name); buildPads(); box.classList.add('hidden'); };
  if ($('#peReset')) $('#peReset').onclick = async () => { await sampler.resetPad(i); refreshPad(i); editPad(i); audit('pad ' + (i + 1) + ' original', 'ok'); };
  $('#peFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; $('#peLic').textContent = 'Cargando (con reintentos)…';
    try { const r = await sampler.loadCustom(i, f); refreshPad(i); editPad(i); audit('cargar pad ' + (i + 1), 'ok', f.name + ' · licencia ' + r.license); }
    catch (err) { $('#peLic').innerHTML = '<span class="badge bad">No se pudo cargar tras 3 intentos: ' + esc(err.message) + '</span>'; audit('cargar pad ' + (i + 1), 'error', f.name + ': ' + err.message); }
  };
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------------- EQ maestro ----------------
const EQ_PRESETS = {
  'Plano': EQ_DEFAULT.map(b => b.g),
  'Graves+': [6, 5, 3, 1, 0, 0, 0, 0, 0, 0],
  'Cumbia': [3, 2, 1, 0, -1, 1, 2, 2, 1, 1],
  'Reggaetón': [7, 6, 3, 0, -1, -1, 0, 1, 2, 2],
  'Electrónica': [5, 4, 1, 0, -2, -1, 1, 3, 4, 4],
  'Voz clara': [-3, -2, -1, 0, 1, 3, 4, 3, 1, 0],
  'Fiesta (V)': [5, 4, 2, 0, -2, -2, 0, 2, 4, 5],
};
let eqBands = settings.get('eqBands', EQ_DEFAULT.map(b => ({ ...b }))), eqSel = 0;
function buildEQ() {
  const box = $('#eqBands'); box.innerHTML = '';
  eqBands.forEach((b, i) => {
    const d = el('div', { class: 'b' + (i === eqSel ? ' sel' : '') }, `<small class="g">${b.g > 0 ? '+' : ''}${b.g}</small><input type="range" min="-15" max="15" step="0.5" value="${b.g}" data-midi="eq${i}"><small>${b.f >= 1000 ? (b.f / 1000).toFixed(b.f % 1000 ? 1 : 0) + 'k' : Math.round(b.f)}</small>`);
    const r = d.querySelector('input'); r.oninput = () => { b.g = +r.value; d.querySelector('.g').textContent = (b.g > 0 ? '+' : '') + b.g; eng.setEQBand(i, b); saveEQ(); if (eqSel === i) eqEdit(); };
    d.onclick = () => { eqSel = i; $$('.eqbands .b').forEach((x, k) => x.classList.toggle('sel', k === i)); eqEdit(); };
    box.append(d);
  });
  eng.setEQ(eqBands); eqEdit(); presetList();
}
function eqEdit() {
  const b = eqBands[eqSel], i = eqSel, box = $('#eqEdit');
  box.innerHTML = `<label>Banda ${i + 1} · Frecuencia <b>${Math.round(b.f)} Hz</b><input type="range" id="eqF" min="0" max="1" step="0.001" value="${Math.log(b.f / 20) / Math.log(1000)}"></label>
    <label>Ganancia <b>${b.g} dB</b><input type="range" id="eqG" min="-15" max="15" step="0.5" value="${b.g}"></label>
    <label>Q (ancho) <b>${b.q}</b><input type="range" id="eqQ" min="0.2" max="10" step="0.1" value="${b.q}"></label>
    <label>Tipo<select id="eqT"><option value="peaking">Campana</option><option value="lowshelf">Shelf graves</option><option value="highshelf">Shelf agudos</option><option value="lowpass">Pasa-bajos</option><option value="highpass">Pasa-altos</option><option value="notch">Notch</option></select></label>`;
  $('#eqT').value = b.t;
  const upd = () => { eng.setEQBand(i, b); saveEQ(); drawEQ(); };
  $('#eqF').oninput = e => { b.f = Math.round(20 * Math.pow(1000, +e.target.value)); box.querySelector('label b').textContent = b.f + ' Hz'; upd(); $$('.eqbands .b small:last-child')[i].textContent = b.f >= 1000 ? (b.f / 1000).toFixed(1) + 'k' : b.f; };
  $('#eqG').oninput = e => { b.g = +e.target.value; $$('.eqbands input')[i].value = b.g; $$('.eqbands .g')[i].textContent = (b.g > 0 ? '+' : '') + b.g; upd(); };
  $('#eqQ').oninput = e => { b.q = +e.target.value; upd(); };
  $('#eqT').onchange = e => { b.t = e.target.value; upd(); };
  drawEQ();
}
function saveEQ() { settings.set('eqBands', eqBands); drawEQ(); clearTimeout(saveEQ.t); saveEQ.t = setTimeout(drawEQ, 150); }
function drawEQ() {
  const cv = $('#eqCv'); const w = cv.clientWidth * devicePixelRatio || 700, h = (cv.clientHeight || 70) * devicePixelRatio; cv.width = w; cv.height = h; const g = cv.getContext('2d');
  const N = 200, fr = new Float32Array(N); for (let i = 0; i < N; i++) fr[i] = 20 * Math.pow(1000, i / (N - 1));
  const tot = new Float32Array(N).fill(0), mag = new Float32Array(N), ph = new Float32Array(N);
  eng.eq.forEach(f => { f.getFrequencyResponse(fr, mag, ph); for (let i = 0; i < N; i++) tot[i] += 20 * Math.log10(mag[i] || 1e-6); });
  g.strokeStyle = '#2c2550'; g.lineWidth = 1; [-12, -6, 0, 6, 12].forEach(db => { const y = h / 2 - db / 15 * h / 2; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); });
  g.strokeStyle = '#00e5ff'; g.lineWidth = 2 * devicePixelRatio; g.shadowColor = '#00e5ff'; g.shadowBlur = 8; g.beginPath();
  for (let i = 0; i < N; i++) { const x = i / (N - 1) * w, y = h / 2 - Math.max(-15, Math.min(15, tot[i])) / 15 * h / 2; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.shadowBlur = 0;
}
function presetList() {
  const user = settings.get('eqPresets', {}); const s = $('#eqPreset');
  s.innerHTML = '<option value="">Presets…</option>' + Object.keys(EQ_PRESETS).map(k => `<option value="b:${k}">${k}</option>`).join('') + Object.keys(user).map(k => `<option value="u:${esc(k)}">★ ${esc(k)}</option>`).join('');
}
function applyPreset(v) {
  const user = settings.get('eqPresets', {});
  if (v.startsWith('b:')) { const gs = EQ_PRESETS[v.slice(2)]; eqBands = EQ_DEFAULT.map((b, i) => ({ ...b, g: gs[i] })); }
  else if (v.startsWith('u:')) eqBands = JSON.parse(JSON.stringify(user[v.slice(2)]));
  saveEQ(); buildEQ(); audit('preset EQ', 'ok', v.slice(2));
}

// ---------------- Pantalla completa + horizontal ----------------
async function lockLandscape() { if (window.DJMiliAndroid) { window.DJMiliAndroid.setOrientation('landscape'); return true; } try { await screen.orientation.lock('landscape'); audit('bloquear horizontal', 'ok'); return true; } catch (e) { return false; } }
async function goLandscape() {
  if (window.DJMiliAndroid) { const on = window.DJMiliAndroid.toggleLandscape(); toast(on ? 'Horizontal fijo' : 'Giro automático'); audit('pantalla horizontal (app)', 'ok', on ? 'fijo' : 'auto'); return; }
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); try { screen.orientation.unlock(); } catch (e) {} return; }
    await (document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) || Promise.reject(new Error('sin pantalla completa')));
    audit('pantalla completa', 'ok');
  } catch (e) { audit('pantalla completa', 'error', e.message); }
  if (!(await lockLandscape())) toast('Gira el teléfono: este navegador no deja fijar la orientación');
}
const installed = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

// ---------------- Bitácora ----------------
async function renderLog() {
  const all = await auditAll(); const last = all.slice(-150).reverse();
  $('#logTbl').innerHTML = `<p class="muted tiny">${all.length} registros</p><table><tr><th>Hora</th><th>Usuario</th><th>Acción</th><th>Resultado</th></tr>${last.map(e => `<tr><td>${new Date(e.timestamp).toLocaleString('es-MX', { hour12: false })}</td><td>${esc(e.usuario)}</td><td>${esc(e.accion)}<br><span class="muted">${esc(e.detalle || '')}</span></td><td class="${e.resultado}">${esc(e.resultado)}</td></tr>`).join('')}</table>`;
}
function download(name, text, type) { if (window.DJMiliAndroid) { try { const r = window.DJMiliAndroid.saveText(name, type || 'text/plain', String(text)); toast(r || 'Guardado en Descargas'); return; } catch (e) {} } const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); }
async function exportLog(kind) {
  const all = (await auditAll()).map(({ timestamp, usuario, accion, resultado, detalle }) => ({ timestamp, usuario, accion, resultado, detalle }));
  if (kind === 'json') download('bitacora-djmili.json', JSON.stringify(all, null, 2), 'application/json');
  else { const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"'; download('bitacora-djmili.csv', '\ufefftimestamp,usuario,accion,resultado,detalle\n' + all.map(e => [e.timestamp, e.usuario, e.accion, e.resultado, e.detalle].map(q).join(',')).join('\n'), 'text/csv'); }
  audit('exportar bitácora ' + kind.toUpperCase(), 'ok', all.length + ' registros');
}

// ---------------- Permisos ----------------
async function renderPerms() {
  const rows = [];
  const q = async n => { try { return (await navigator.permissions.query({ name: n })).state; } catch (e) { return 'n/d'; } };
  const persisted = await navigator.storage?.persisted?.();
  const est = await navigator.storage?.estimate?.();
  rows.push(['Almacenamiento persistente', persisted ? 'concedido' : 'no', !persisted ? 'persist' : null]);
  if (est) rows.push(['Espacio usado', (est.usage / 1048576).toFixed(1) + ' MB de ' + (est.quota / 1073741824).toFixed(1) + ' GB', null]);
  rows.push(['Micrófono', await q('microphone'), null]);
  rows.push(['MIDI', navigator.requestMIDIAccess ? await q('midi') : 'no soportado', null]);
  rows.push(['Abrir carpetas (File System Access)', 'showDirectoryPicker' in window ? 'disponible' : 'no en este navegador (usa 📁 Carpeta)', null]);
  rows.push(['Audio', eng ? eng.ctx.sampleRate + ' Hz · latencia ' + Math.round((eng.ctx.baseLatency || 0) * 1000) + ' ms' : '—', null]);
  $('#perms').innerHTML = rows.map(([a, b, act]) => `<div><span>${a}</span><span class="muted small">${esc(b)} ${act ? `<button class="btn sm" data-act="${act}">Pedir</button>` : ''}</span></div>`).join('');
  $('#perms').querySelectorAll('[data-act=persist]').forEach(b => b.onclick = async () => { const ok = await navigator.storage.persist(); audit('permiso almacenamiento', ok ? 'ok' : 'error'); renderPerms(); });
}

// ---------------- MIDI ----------------
function midiTarget(id) { return document.querySelector(`[data-midi="${id}"]`); }
function flash(n) { if (!n) return; n.classList.add('midi-flash'); clearTimeout(n._ft); n._ft = setTimeout(() => n.classList.remove('midi-flash'), 160); }
function onMidi(ev) {
  if (ev.learned) { document.body.classList.remove('learning'); toast('Aprendido: ' + ev.learned + ' ← ' + ev.key); audit('MIDI learn', 'ok', ev.learned + ' = ' + ev.key); renderMidiMap(); flash(midiTarget(ev.learned)); return; }
  const n = midiTarget(ev.target); if (!n) return;
  if (/^pad\d+$/.test(ev.target)) { if (ev.type === 'note' || (ev.type === 'cc' && ev.val > 0)) firePad(+ev.target.slice(3), Math.max(0.2, ev.val), 'MIDI'); return; }
  if (n.type === 'range') { if (ev.type === 'cc' || ev.type === 'pb') { const mn = +n.min, mx = +n.max; n.value = mn + ev.val * (mx - mn); n.dispatchEvent(new Event('input')); flash(n); } else if (ev.type === 'note') { n.value = (+n.min + +n.max) / 2; n.dispatchEvent(new Event('input')); flash(n); } return; }
  if (n.type === 'checkbox') { if (ev.type !== 'noteoff' && ev.val > 0) { n.checked = !n.checked; n.dispatchEvent(new Event('change')); flash(n.parentElement); } return; }
  if (ev.type === 'note' || (ev.type === 'cc' && ev.val > 0.5)) { n.click(); flash(n); }
}
function renderMidiMap() { const m = midi.map; const ks = Object.keys(m); $('#midiMap').innerHTML = ks.length ? ks.map(k => `${esc(m[k])} ← ${esc(k)}`).join('<br>') : 'Pads: notas 36‑99 (automático)'; }
let learnArmed = false;
function armLearn() {
  if (!midi.access) return toast('Primero activa MIDI');
  learnArmed = true; document.body.classList.add('learning'); toast('Toca un control de la app…');
  const pick = e => { const t = e.target.closest('[data-midi]'); if (!t) return; e.preventDefault(); e.stopPropagation(); document.removeEventListener('pointerdown', pick, true); learnArmed = false; midi.learn(t.dataset.midi); toast('Ahora mueve/toca el control MIDI para: ' + t.dataset.midi); };
  setTimeout(() => document.addEventListener('pointerdown', pick, true), 50);
}

// ---------------- YouTube ----------------
async function ytSearch() {
  const q = $('#ytQ').value.trim(); if (!q) return;
  const id = parseYouTubeId(q); if (id && /youtu|^[\w-]{11}$/.test(q)) { ytPlay(id, q); return; }
  $('#ytMsg').textContent = 'Buscando…'; $('#ytList').innerHTML = '';
  try {
    const r = await searchYouTube(q); $('#ytMsg').textContent = r.items.length + ' resultados' + (r.cached ? ' (de caché, 48 h)' : ' · ' + r.source);
    audit('buscar YouTube', 'ok', q + (r.cached ? ' (caché)' : ''));
    for (const it of r.items) {
      const row = el('div', { class: 'it' }, `<img loading="lazy" src="${esc(it.thumb || '')}" alt=""><div class="t"><b>${esc(it.title)}</b><small>${esc(it.channel || '')}${it.dur ? ' · ' + fmt(it.dur) : ''}</small></div>`);
      const p = el('button', { class: 'btn neon' }, '▶'), s = el('a', { class: 'btn', href: 'https://open.spotify.com/search/' + encodeURIComponent(it.title), target: '_blank', rel: 'noopener' }, 'Spotify');
      p.onclick = () => ytPlay(it.id, it.title); row.append(p, s); $('#ytList').append(row);
    }
  } catch (e) { $('#ytMsg').textContent = e.message; audit('buscar YouTube', 'error', e.message); }
}
function ytPlay(id, title) {
  const w = $('#ytPlayer'); w.classList.remove('hidden');
  w.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  audit('play YouTube', 'ok', title || id); w.scrollIntoView({ behavior: 'smooth' });
}

// ---------------- Modo fiesta ----------------
let partyOn = false;
function party(on) {
  partyOn = on; $('#party').classList.toggle('hidden', !on);
  if (on) { document.documentElement.requestFullscreen?.().catch(() => {}); audit('modo fiesta', 'ok'); partyLoop(); } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
let pLast = 0, pAvg = 0, pFlash = 0, pHue = 280;
function partyLoop(t = 0) {
  if (!partyOn) return; requestAnimationFrame(partyLoop);
  if (t - pLast < 33) return; pLast = t; // ~30 fps, solo dibujo: no toca el hilo de audio
  const cv = $('#partyCv'); const w = cv.clientWidth, h = cv.clientHeight; if (cv.width !== w) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d'); const b = eng.bass(), lv = eng.level();
  pAvg = pAvg * 0.92 + b * 0.08; if (b > pAvg * 1.25 && b > 0.25 && t - pFlash > 220) { pFlash = t; pHue = (pHue + 47) % 360; }
  const k = Math.max(0, 1 - (t - pFlash) / 400);
  g.fillStyle = `rgba(0,0,0,${0.35 - k * 0.2})`; g.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * (0.3 + k * 0.5));
  rg.addColorStop(0, `hsla(${pHue},100%,60%,${0.25 + k * 0.6})`); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { const a = t / 1500 + i * Math.PI / 3; g.strokeStyle = `hsla(${(pHue + i * 60) % 360},100%,60%,${0.25 + lv * 0.6})`; g.lineWidth = 6 + k * 18; g.beginPath(); g.moveTo(cx, h); g.lineTo(cx + Math.cos(a) * w, h - Math.abs(Math.sin(a)) * h * 1.2); g.stroke(); }
  const d = eng.decks.find(x => x.playing); $('#partyInfo').textContent = d?.track ? d.track.title + (d.bpm ? ' · ' + d.effBpm.toFixed(0) + ' BPM' : '') : 'DJ MILI';
}

// ---------------- Pestañas, enlaces y bucle ----------------
let curTab = 'mix';
// Todo vive en una sola pantalla: "showTab" solo desplaza a la sección (o abre el menú)
const SECT = { mix: '#deck0', pads: '#padsCard', eq: '#eqCard', lib: '#libCard' };
function showTab(t) { if (t === 'more') return openPanel('#menuPanel'); if (t === 'yt') return openPanel('#ytPanel'); const e = $(SECT[t] || '#deck0'); if (e && t !== 'mix') e.scrollIntoView({ block: 'start' }); if (t === 'eq') drawEQ(); }
function openPanel(sel) { $(sel).classList.remove('hidden'); if (sel === '#menuPanel') { curTab = 'more'; renderLog(); renderPerms(); } if (sel === '#playerPanel') { curTab = 'player'; renderPlayer(); } }
function closePanel(sel) { $(sel).classList.add('hidden'); curTab = 'mix'; }
// ---------------- Reproductor (música y video) ----------------
let player;
function applyWide() {
  const on = $('#wideOn').checked, amount = +$('#wideAmt').value, headphones = $('#wideHp').checked, mst = $('#wideMaster').checked;
  settings.set('wide', { on, amount, headphones, mst });
  player?.wide?.set({ on, amount, headphones }); eng.wide.set({ on: on && mst, amount, headphones });
}
function renderPlayer(msg) {
  if (!player) return; const ts = tracks, t = player.cur, v = player.v;
  $('#plT').textContent = t ? t.title : 'Nada sonando'; $('#plA').textContent = msg || (t ? [t.artist, t.bpm ? t.bpm.toFixed(0) + ' BPM' : '', t.camelot].filter(Boolean).join(' · ') : 'Agrega canciones o videos abajo');
  $('#plPlay').textContent = v.paused ? '▶' : '❚❚'; $('#plShuf').classList.toggle('neon', player.shuffle);
  $('#plRep').textContent = player.repeat === 'one' ? '🔂' : '🔁'; $('#plRep').classList.toggle('neon', player.repeat !== 'off'); $('#plRep').title = { off: 'Sin repetir', all: 'Repetir lista', one: 'Repetir una' }[player.repeat];
  $('#plRate').textContent = player.ctx ? player.ctx.sampleRate + ' Hz' : (eng.ctx.sampleRate + ' Hz');
  $('#plHD').textContent = player.hdText() || 'HD depende del archivo: FLAC/WAV conservan todo; un MP3/AAC no gana calidad por subir la frecuencia.';
  const q = $('#plQueue'); q.innerHTML = ''; $('#plCount').textContent = '(' + player.list.length + ')';
  player.list.forEach((id, i) => { const tr = ts.find(x => x.id === id); if (!tr) return;
    const it = el('div', { class: 'it' + (i === player.idx ? ' cur' : '') }, `<div class="t"><b>${i === player.idx ? '▶ ' : ''}${tr.video ? '<span class="vid">VIDEO</span>' : ''}${esc(tr.title)}</b><small>${esc(tr.artist || '')} ${tr.dur ? fmt(tr.dur) : ''}</small></div>`);
    it.querySelector('.t').onclick = () => player.play(i); const x = el('button', { class: 'btn sm' }, '✕'); x.onclick = () => player.remove(i); it.append(x); q.append(it); });
  const pls = settings.get('playlists', []); $('#plFromList').innerHTML = '<option value="">+ Desde lista…</option>' + pls.map((p, i) => `<option value="${i}">${esc(p.name)} (${p.ids.length})</option>`).join('');
  const showVid = !!(t && v.videoWidth); v.classList.toggle('hidden', !showVid); $('#plArt').classList.toggle('hidden', showVid); $('#plArt').classList.toggle('spin', !v.paused);
}
function renderPlRes() {
  const qs = $('#plQ').value.trim().toLowerCase(), box = $('#plRes'); box.innerHTML = ''; if (!qs) return;
  tracks.filter(t => [t.title, t.artist, t.name].join(' ').toLowerCase().includes(qs)).slice(0, 12).forEach(t => {
    const it = el('div', { class: 'it' }, `<div class="t"><b>${t.video ? '<span class="vid">VIDEO</span>' : ''}${esc(t.title)}</b><small>${esc(t.artist || '')}</small></div>`);
    const a = el('button', { class: 'btn sm' }, '+'), pn = el('button', { class: 'btn sm neon' }, '▶'); a.onclick = () => { player.add([t.id]); toast('Agregada: ' + t.title); }; pn.onclick = () => player.add([t.id], true); it.append(pn, a); box.append(it); });
}
function bindPlayer() {
  player = new Player({ video: $('#pv'), getBlob, tracks: () => tracks, settings, audit, onState: m => renderPlayer(m) });
  window.__djm.player = player;
  const w = settings.get('wide', { on: false, amount: 0.5, headphones: true, mst: false }); $('#wideOn').checked = w.on; $('#wideAmt').value = w.amount; $('#wideHp').checked = w.headphones; $('#wideMaster').checked = w.mst;
  player.onCtx = () => applyWide(); applyWide();
  ['#wideOn', '#wideHp', '#wideMaster'].forEach(s => $(s).onchange = () => { applyWide(); audit('envolvente', 'ok', `${$('#wideOn').checked ? 'on' : 'off'} ${$('#wideAmt').value}${$('#wideMaster').checked ? ' +mezcla' : ''}`); });
  $('#wideAmt').oninput = applyWide;
  $('#plBtn').onclick = () => openPanel('#playerPanel'); $('#plClose').onclick = () => closePanel('#playerPanel');
  $('#plPlay').onclick = () => player.toggle(); $('#plNext').onclick = () => player.next(); $('#plPrev').onclick = () => player.prev();
  $('#plShuf').onclick = () => { player.shuffle = !player.shuffle; player.order = null; player.save(); renderPlayer(); };
  $('#plRep').onclick = () => { player.repeat = { off: 'all', all: 'one', one: 'off' }[player.repeat]; player.save(); renderPlayer(); };
  $('#plVol').value = settings.get('plVol', 0.9); $('#plVol').oninput = e => { settings.set('plVol', +e.target.value); if (player.vol) player.vol.gain.setTargetAtTime(+e.target.value, player.ctx.currentTime + 0.01, 0.02); };
  const v = player.v, sk = $('#plSeek'); let dragging = false;
  v.addEventListener('timeupdate', () => { if (!dragging && v.duration) sk.value = v.currentTime / v.duration * 1000; $('#plCur').textContent = fmt(v.currentTime); $('#plDur').textContent = fmt(v.duration); });
  v.addEventListener('loadedmetadata', () => renderPlayer());
  sk.oninput = () => { dragging = true; $('#plCur').textContent = fmt(sk.value / 1000 * (v.duration || 0)); }; sk.onchange = () => { if (v.duration) v.currentTime = sk.value / 1000 * v.duration; dragging = false; };
  $('#plAddAll').onclick = () => { player.add(tracks.map(t => t.id)); toast('Biblioteca agregada a la lista'); };
  $('#plFromList').onchange = e => { const pl = settings.get('playlists', [])[+e.target.value]; if (pl) player.add(pl.ids); e.target.value = ''; };
  $('#plClear').onclick = () => player.clear();
  $('#plQ').oninput = renderPlRes;
  $('#plFile').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; const added = await importFiles(fs); if (added?.length) player.add(added.map(t => t.id), true); };
}
function bindUI() {
  bindPlayer();
  $('#hdOn').checked = settings.get('hd', true); $('#hdOn').onchange = e => { settings.set('hd', e.target.checked); toast('Se aplica al volver a abrir la app'); audit('calidad HD', 'ok', e.target.checked ? '48 kHz' : 'nativa'); };
  $('#hdInfo').textContent = `Mezcla DJ: ${eng.ctx.sampleRate} Hz, proceso float 32 bits, latencia ${Math.round(((eng.ctx.baseLatency || 0) + (eng.ctx.outputLatency || 0)) * 1000)} ms. HD depende del archivo de origen.`;
  $('#ytBtn').onclick = () => openPanel('#ytPanel'); $('#ytClose').onclick = () => { closePanel('#ytPanel'); };
  $('#menuBtn').onclick = () => openPanel('#menuPanel'); $('#menuClose').onclick = () => closePanel('#menuPanel');
  $('#sheetX').onclick = () => $('#sheet').classList.add('hidden'); $('#sheet').onclick = e => { if (e.target.id === 'sheet') $('#sheet').classList.add('hidden'); };
  $('#micQuick').onclick = () => $('#micBtn').click();
  $('#audioOnly').checked = settings.get('audioOnly', false); $('#audioOnly').onchange = e => settings.set('audioOnly', e.target.checked);
  $$('#libChips .chip').forEach(c => c.onclick = () => { $$('#libChips .chip').forEach(x => x.classList.toggle('on', x === c)); $$('#libCard .sub').forEach(s => s.classList.toggle('hidden', s.id !== 's-' + c.dataset.sub)); });
  $('#xf').oninput = e => eng.setCrossfader(+e.target.value);
  $('#automix').onchange = e => { audit('automix ' + (e.target.checked ? 'on' : 'off'), 'ok'); if (e.target.checked && activeDeck() < 0) toast('Dale play a un deck y el Auto‑mix sigue solo'); };
  $('#fileIn').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
  $('#dirIn').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
  if ('showDirectoryPicker' in window) { $('#fsBtn').hidden = false; $('#fsBtn').onclick = async () => { try { const dir = await window.showDirectoryPicker(); const fs = []; for await (const h of dir.values()) if (h.kind === 'file') fs.push(await h.getFile()); audit('permiso carpeta', 'ok', dir.name); importFiles(fs); } catch (e) { if (e.name !== 'AbortError') audit('permiso carpeta', 'error', e.message); } }; }
  $('#q').oninput = renderLib; $('#harmOnly').onchange = renderLib;
  $('#ytGo').onclick = ytSearch; $('#ytQ').onkeydown = e => { if (e.key === 'Enter') ytSearch(); };
  $('#plNew').onclick = () => { const n = $('#plName').value.trim(); if (!n) return; const p = settings.get('playlists', []); p.push({ name: n, ids: [] }); settings.set('playlists', p); $('#plName').value = ''; renderPlaylists(); audit('crear lista', 'ok', n); };
  $('#qClear').onclick = () => { queue = []; saveQueue(); };
  $('#eqByp').onchange = e => { eng.setEQBypass(e.target.checked); drawEQ(); };
  $('#eqPreset').onchange = e => e.target.value && applyPreset(e.target.value);
  $('#eqSave').onclick = () => { const n = prompt('Nombre del preset'); if (!n) return; const u = settings.get('eqPresets', {}); u[n] = JSON.parse(JSON.stringify(eqBands)); settings.set('eqPresets', u); presetList(); audit('guardar preset EQ', 'ok', n); toast('Preset guardado'); };
  $('#eqDel').onclick = () => { const v = $('#eqPreset').value; if (!v.startsWith('u:')) return toast('Elige un preset tuyo (★)'); const u = settings.get('eqPresets', {}); delete u[v.slice(2)]; settings.set('eqPresets', u); presetList(); };
  $('#eqFlat').onclick = () => applyPreset('b:Plano');
  $('#fullBtn').onclick = goLandscape;
  $('#padStop').onclick = () => { sampler.stopAll(); audit('parar pads', 'ok'); };
  $('#padReset').onclick = async () => { if (!confirm('¿Volver a los 16 pads de fábrica? Se borran los pads propios.')) return; await sampler.resetAll(); buildPads(); audit('pads de fábrica', 'ok'); toast('Pads de fábrica restaurados'); };
  addEventListener('resize', () => { clearTimeout(drawEQ.rt); drawEQ.rt = setTimeout(() => { drawEQ(); deckUI.forEach(u => u.drawOverview()); }, 200); });
  $('#padVol').value = settings.get('padVol', 0.9); sampler.bus.gain.value = +$('#padVol').value; $('#padVol').oninput = e => { sampler.bus.gain.setTargetAtTime(+e.target.value, eng.t(), 0.01); settings.set('padVol', +e.target.value); };
  $('#partyBtn').onclick = () => party(true); $('#partyX').onclick = () => party(false);
  // micro
  $('#micBtn').onclick = async () => {
    if (eng.mic) { eng.micOff(); $('#micBtn').textContent = 'Prender micro'; audit('micrófono off', 'ok'); return; }
    try { eng.duckOn = $('#duck').checked; setTimeout(() => $('#micQuick').classList.toggle('neon', !!eng.mic), 500); await eng.micOn({ echo: +$('#micEcho').value, echoTime: +$('#micEchoT').value, gain: +$('#micGain').value }); $('#micBtn').textContent = 'Apagar micro'; audit('micrófono on', 'ok'); }
    catch (e) { toast('Micro: ' + e.message); audit('micrófono on', 'error', e.message); }
  };
  $('#micGain').oninput = e => eng.micSet({ gain: +e.target.value }); $('#micEcho').oninput = e => eng.micSet({ echo: +e.target.value }); $('#micEchoT').oninput = e => eng.micSet({ echoTime: +e.target.value });
  // midi
  midi = new Midi(onMidi); window.__djm.midi = midi; renderMidiMap();
  midi.onMsg = m => { $('#midiMon').textContent = `${m.device} · ${m.type} ch${m.ch} #${m.num} = ${Math.round(m.val * 127)}`; };
  midi.onState = devs => { $('#midiDev').textContent = devs.length ? 'Conectado: ' + devs.join(', ') : 'Sin controlador conectado'; };
  $('#midiBtn').onclick = async () => { try { const d = await midi.enable(); audit('activar MIDI', 'ok', d.join(', ') || 'sin dispositivos'); } catch (e) { $('#midiDev').textContent = e.message; audit('activar MIDI', 'error', e.message); } };
  $('#learnBtn').onclick = armLearn; $('#midiClear').onclick = () => { midi.clear(); renderMidiMap(); };
  // log
  $('#logCsv').onclick = () => exportLog('csv'); $('#logJson').onclick = () => exportLog('json');
  $('#logClr').onclick = async () => { if (!confirm('¿Borrar toda la bitácora?')) return; await idb.clear('audit'); audit('borrar bitácora', 'ok'); renderLog(); };
  onAudit(() => { if (curTab === 'more') { clearTimeout(window._lr); window._lr = setTimeout(renderLog, 300); } });
  auditTrim(5000);
  // usuario / PIN
  $('#userName').value = settings.get('user', 'Alfredo'); $('#userName').onchange = e => { settings.set('user', e.target.value.trim() || 'Alfredo'); audit('cambiar usuario', 'ok', e.target.value); };
  $('#pinSet').onclick = async () => { const p = $('#pinNew').value; if (!/^\d{4,8}$/.test(p)) return toast('El PIN debe ser de 4 a 8 dígitos'); const salt = [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join(''); settings.set('pinSalt', salt); settings.set('pinHash', await sha(salt + p)); $('#pinNew').value = ''; toast('PIN puesto'); audit('poner PIN', 'ok'); };
  $('#pinOff').onclick = () => { settings.set('pinHash', null); toast('PIN quitado'); audit('quitar PIN', 'ok'); };
  $('#lockNow').onclick = () => { if (!settings.get('pinHash', null)) return toast('Primero pon un PIN'); audit('bloquear', 'ok'); checkLock(); };
  // ajustes
  $('#ytKey').value = settings.get('ytkey', ''); $('#ytKey').onchange = e => settings.set('ytkey', e.target.value.trim());
  $('#xfCurve').value = settings.get('xfCurve', 'smooth'); eng.xfCurve = $('#xfCurve').value; $('#xfCurve').onchange = e => { eng.xfCurve = e.target.value; settings.set('xfCurve', eng.xfCurve); eng.setCrossfader(eng.xf); };
  $('#normalize').checked = normOn(); $('#normalize').onchange = e => { settings.set('normalize', e.target.checked); eng.decks.forEach((d, i) => { if (d.track) { d.setNorm(trackNorm(d.track)); deckUI[i].render(); } }); audit('volumen parejo ' + (e.target.checked ? 'on' : 'off'), 'ok'); };
  $('#saveCopies').checked = settings.get('saveCopies', true); $('#saveCopies').onchange = e => settings.set('saveCopies', e.target.checked);
  $('#cacheClr').onclick = async () => { await idb.clear('cache'); toast('Caché limpia'); };
  $('#demoBtn').onclick = async () => { for (const t of tracks.filter(t => t.demo)) { await idb.del('tracks', t.id); } tracks = tracks.filter(t => !t.demo); await createDemos(); renderLib(); analyzePending(); };
  cachePurge();
  // teclado (por si conecta uno)
  document.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; const k = '12345678'.indexOf(e.key); if (k >= 0) firePad(k, 1, 'teclado'); if (e.key === ' ') { e.preventDefault(); $('#deck0 .play').click(); } });
}
let lastF = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (t - lastF < 30) return; lastF = t;
  const lv = eng.level(); $('#meter i').style.width = Math.min(100, lv * 110) + '%';
  const gr = eng.gr || 0; const gb = $('#grBadge'); gb.textContent = gr < -0.1 ? 'LIM ' + gr.toFixed(1) : 'LIM'; gb.classList.toggle('act', gr < -0.1);
  if (!partyOn && curTab === 'mix') deckUI.forEach(u => { if (u.visible !== false) { u.draw(); u.drawJog(); u.drawVU(); } });
}
window.__djm.api = { measureLoudness, trackNorm, loadToDeck: (i, id) => loadToDeck(i, tracks.find(t => t.id === id)), tracks: () => tracks, firePad, showTab, applyPreset, deckUI, makeAudioOnly: id => makeAudioOnly(tracks.find(t => t.id === id)), deleteTrack: id => deleteTrack(tracks.find(t => t.id === id)), decodeTrack: id => decodeTrack(tracks.find(t => t.id === id)) };
boot();
