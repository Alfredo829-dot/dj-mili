// Almacenamiento local: IndexedDB (archivos, caché, bitácora) + localStorage (ajustes)
const DB_NAME = 'djmili', DB_VER = 1;
let dbp = null;
export function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache');
      if (!d.objectStoreNames.contains('audit')) d.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    let out; const req = fn(s);
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
export const idb = {
  get: (st, k) => tx(st, 'readonly', s => s.get(k)),
  put: (st, v, k) => tx(st, 'readwrite', s => k === undefined ? s.put(v) : s.put(v, k)),
  del: (st, k) => tx(st, 'readwrite', s => s.delete(k)),
  all: (st) => tx(st, 'readonly', s => s.getAll()),
  clear: (st) => tx(st, 'readwrite', s => s.clear()),
  count: (st) => tx(st, 'readonly', s => s.count()),
};

// Caché con caducidad (48 h por defecto)
export const CACHE_TTL = 48 * 3600 * 1000;
export async function cacheGet(key) {
  try { const v = await idb.get('cache', key); if (v && Date.now() - v.ts < CACHE_TTL) return v.data; if (v) idb.del('cache', key); } catch (e) {}
  return null;
}
export async function cacheSet(key, data) { try { await idb.put('cache', { ts: Date.now(), data }, key); } catch (e) {} }
export async function cachePurge() {
  const d = await db();
  return new Promise(res => {
    const t = d.transaction('cache', 'readwrite'); const s = t.objectStore('cache'); let n = 0;
    s.openCursor().onsuccess = e => { const c = e.target.result; if (!c) return; if (Date.now() - c.value.ts >= CACHE_TTL) { c.delete(); n++; } c.continue(); };
    t.oncomplete = () => res(n);
  });
}

// Ajustes
export const settings = {
  get(k, def) { try { const v = localStorage.getItem('djm.' + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { localStorage.setItem('djm.' + k, JSON.stringify(v)); },
};

// Bitácora de auditoría {timestamp, usuario, acción, resultado}
const listeners = new Set();
export function onAudit(fn) { listeners.add(fn); }
export async function audit(accion, resultado = 'ok', detalle = '') {
  const e = { timestamp: new Date().toISOString(), usuario: settings.get('user', 'Alfredo'), accion, resultado, detalle };
  try { await idb.put('audit', e); } catch (err) { console.warn('audit', err); }
  listeners.forEach(f => { try { f(e); } catch (_) {} });
  return e;
}
export async function auditAll() { return idb.all('audit'); }
export async function auditTrim(max = 5000) {
  const all = await idb.all('audit');
  if (all.length <= max) return;
  const d = await db(); const t = d.transaction('audit', 'readwrite'); const s = t.objectStore('audit');
  all.slice(0, all.length - max).forEach(e => s.delete(e.id));
}
