// OCR local con Tesseract.js 5.1.1 y modelo español empaquetado: no sale nada del ordenador.
let workerP = null;

// El modelo va comprimido (gzip) con extensión .wasm solo para que cualquier alojamiento lo sirva como binario.
// Se deja en la caché propia de Tesseract (IndexedDB «keyval-store», clave «./spa.traineddata») y Tesseract
// lo lee de ahí: nunca intenta descargarlo de internet.
function idbKeyval(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('keyval-store');
    r.onupgradeneeded = () => r.result.createObjectStore('keyval');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction('keyval', mode), q = fn(t.objectStore('keyval'));
      t.oncomplete = () => { r.result.close(); res(q?.result); };
      t.onerror = () => rej(t.error);
    };
  });
}
async function modeloEnCache(base) {
  const KEY = './spa.traineddata';
  if (await idbKeyval('readonly', s => s.get(KEY))) return;
  const r = await fetch(base + 'lang/spa-traineddata-gz.wasm');
  if (!r.ok) throw new Error('No se pudo cargar el modelo de OCR');
  const data = new Uint8Array(await r.arrayBuffer());
  await idbKeyval('readwrite', s => s.put(data, KEY));
}

export function ocrWorker(onProgress) {
  if (!workerP) {
    const T = window.Tesseract;
    const base = new URL('vendor/tesseract/', location.href).href;
    workerP = modeloEnCache(base).then(() => T.createWorker('spa', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core/',
      langPath: base + 'lang/',
      gzip: true,
      workerBlobURL: false,
      logger: m => onProgress && m.status === 'recognizing text' && onProgress(m.progress),
    }));
  }
  return workerP;
}

/** Devuelve las líneas de texto reconocidas (de arriba abajo) */
export async function ocrLines(image, onProgress) {
  const w = await ocrWorker(onProgress);
  const { data } = await w.recognize(image);
  return data.text.split('\n').map(s => s.replace(/\s+$/, '')).filter(s => s.trim());
}
