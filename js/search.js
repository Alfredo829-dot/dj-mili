// Búsqueda online: YouTube vía instancias Piped (gratis, sin llave) o YouTube Data API con llave propia. Caché 48 h.
import { cacheGet, cacheSet, settings } from './store.js';
const PIPED = ['https://api.piped.private.coffee', 'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://pipedapi.r4fo.com'];
async function withTimeout(p, ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); try { return await p(c.signal); } finally { clearTimeout(t); } }
export async function searchYouTube(q) {
  const key = 'yt:' + q.toLowerCase().trim();
  const hit = await cacheGet(key); if (hit) return { items: hit, cached: true };
  let items = null, source = '';
  const apiKey = settings.get('ytkey', '');
  if (apiKey) {
    try {
      const r = await withTimeout(s => fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey)}`, { signal: s }), 8000);
      const j = await r.json(); if (j.items) { items = j.items.map(x => ({ id: x.id.videoId, title: x.snippet.title, channel: x.snippet.channelTitle, thumb: x.snippet.thumbnails?.default?.url })); source = 'YouTube API'; }
    } catch (e) { console.warn('yt api', e); }
  }
  if (!items) for (const base of PIPED) {
    try {
      const r = await withTimeout(s => fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, { signal: s }), 7000);
      if (!r.ok) continue; const j = await r.json(); if (!j.items) continue;
      items = j.items.filter(x => x.url && x.url.includes('v=')).slice(0, 20).map(x => ({ id: x.url.split('v=')[1].split('&')[0], title: x.title, channel: x.uploaderName, thumb: x.thumbnail, dur: x.duration }));
      source = 'Piped'; break;
    } catch (e) { /* siguiente instancia */ }
  }
  if (!items) throw new Error('No respondió ningún buscador gratis. Pega una llave gratis de YouTube Data API en Ajustes o pega el link del video.');
  await cacheSet(key, items);
  return { items, cached: false, source };
}
export function parseYouTubeId(s) { const m = String(s).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/); return m ? m[1] : (/^[\w-]{11}$/.test(s) ? s : null); }
