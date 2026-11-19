const C = 'djmili-v4';
const SHELL = ['./', 'index.html', 'css/app.css?v=4', 'js/app.js?v=4', 'js/worklets.js?v=2', 'js/loudness.js', 'js/engine.js', 'js/sampler.js', 'js/bpm.js', 'js/key.js', 'js/encoders.js', 'js/store.js', 'js/midi.js', 'js/search.js', 'js/demo.js', 'js/mp4audio.js', 'js/mp3worker.js', 'vendor/lame.min.js', 'assets/pads/aplausos.mp3', 'assets/pads/risas.mp3', 'assets/pads/ovacion.mp3', 'assets/pads/oooh.mp3', 'assets/pads/hey.mp3', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (u.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
