// IndexedDB: almacenamiento local. NO es un sistema de seguridad.
const DB_NAME = 'disset-odiseo';
const DB_VERSION = 1;
const STORES = {
  products: { keyPath: 'id' },
  variants: { keyPath: 'id' },
  quotes: { keyPath: 'id' },          // presupuestos locales (máx. MAX_QUOTES; los abiertos nunca se borran)
  corrections: { keyPath: 'key' },    // ref leída → variante elegida
  learning: { keyPath: 'key' },       // añadidos/descartados por contexto
  outbox: { keyPath: 'id' },          // cola de sincronización
  meta: { keyPath: 'key' },
};
export const MAX_QUOTES = 5000;
const CERRADO = q => q.status === 'aceptado' || q.status === 'perdido';

/** Pide al navegador que no borre estos datos aunque le falte espacio */
export async function protegerAlmacen() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* sin soporte */ }
  try { const e = await navigator.storage?.estimate?.(); return e ? { usado: e.usage, cuota: e.quota } : null; } catch { return null; }
}

let _db;
function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      // Las migraciones solo AÑADEN almacenes: nunca borran datos del usuario.
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
      }
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}

export const db = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  put: (store, val) => tx(store, 'readwrite', s => s.put(val)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  clear: (store) => tx(store, 'readwrite', s => s.clear()),
  count: (store) => tx(store, 'readwrite', s => s.count()),
  bulkPut: (store, vals) => tx(store, 'readwrite', s => { vals.forEach(v => s.put(v)); }),
  async meta(key, val) {
    if (val === undefined) return (await this.get('meta', key))?.value;
    return this.put('meta', { key, value: val });
  },
};

export async function saveQuote(q) {
  q.updatedAt = new Date().toISOString();
  await db.put('quotes', q);
  if ((await db.count('quotes')) <= MAX_QUOTES) return;                 // lo normal: no hay que limpiar nada
  // Por encima del máximo: solo se van los cerrados (aceptados/perdidos) más antiguos. Los abiertos nunca.
  const cerrados = (await db.all('quotes')).filter(CERRADO).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const sobran = (await db.count('quotes')) - MAX_QUOTES;
  for (const old of cerrados.slice(0, sobran)) await db.del('quotes', old.id);
}

export async function exportBackup() {
  const out = { app: 'disset-odiseo', version: 1, exportedAt: new Date().toISOString() };
  for (const s of ['quotes', 'corrections', 'learning']) out[s] = await db.all(s);
  return out;
}

export async function importBackup(data) {
  if (data?.app !== 'disset-odiseo') throw new Error('No es una copia de Disset Odiseo');
  for (const s of ['quotes', 'corrections', 'learning']) {
    if (Array.isArray(data[s])) await db.bulkPut(s, data[s]);
  }
}
