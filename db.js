// IndexedDB: almacenamiento local. NO es un sistema de seguridad.
const DB_NAME = 'disset-odiseo';
const DB_VERSION = 1;
const STORES = {
  products: { keyPath: 'id' },
  variants: { keyPath: 'id' },
  quotes: { keyPath: 'id' },          // borradores locales (máx. 60)
  corrections: { keyPath: 'key' },    // ref leída → variante elegida
  learning: { keyPath: 'key' },       // añadidos/descartados por contexto
  outbox: { keyPath: 'id' },          // cola de sincronización
  meta: { keyPath: 'key' },
};
export const MAX_QUOTES = 60;

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
  bulkPut: (store, vals) => tx(store, 'readwrite', s => { vals.forEach(v => s.put(v)); }),
  async meta(key, val) {
    if (val === undefined) return (await this.get('meta', key))?.value;
    return this.put('meta', { key, value: val });
  },
};

export async function saveQuote(q) {
  q.updatedAt = new Date().toISOString();
  await db.put('quotes', q);
  const all = (await db.all('quotes')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const old of all.slice(MAX_QUOTES)) await db.del('quotes', old.id);
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
