// Service worker: la app y sus librerías funcionan sin conexión. Las fotos de dissetodiseo.com se guardan al verlas.
// Al publicar una versión nueva solo cambia VERSION: los presupuestos y el aprendizaje (IndexedDB) no se tocan.
const VERSION = 'v0.4.1';
const SHELL = `shell-${VERSION}`, IMG = 'img-disset';
const FILES = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/catalog.js', 'js/matcher.js', 'js/reader.js', 'js/ocr.js', 'js/layout.js', 'js/mascot.js', 'js/crosssell.js',
  'data/catalogo.app.json', 'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/lang/spa-traineddata-gz.wasm',
  'fonts/inter-latin-400-normal.woff2', 'fonts/inter-latin-500-normal.woff2', 'fonts/inter-latin-600-normal.woff2', 'fonts/inter-latin-700-normal.woff2'];

self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (/(^|\.)dissetodiseo\.com$/.test(url.hostname) && e.request.destination === 'image') {
    e.respondWith(caches.open(IMG).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }
      catch { return Response.error(); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
