/* Camada offline-first: IndexedDB puro + fila de sincronização (outbox).
 *
 * Stores:
 *  - kv:             pares chave/valor (caches de conversas, metadados)
 *  - trips:          roteiros do turista (fonte da verdade local, key = client_uid)
 *  - favorites:      snapshot dos anúncios favoritados (key = listing_id)
 *  - listings:       cache da exploração (key = id)
 *  - establishments: cache da exploração (key = id)
 *  - outbox:         operações pendentes de envio {method, path, body}
 *
 * Toda mutação offline entra no outbox e é reenviada quando a conexão volta.
 * As rotas do servidor são idempotentes (client_uid), então repetir é seguro.
 */
'use strict';

const CaparaoDB = (() => {
  const DB_NAME = 'caparao-db';
  const DB_VERSION = 1;
  const STORES = ['kv', 'trips', 'favorites', 'listings', 'establishments'];
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function reqAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function store(name, mode = 'readonly') {
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
  }

  const get = async (name, key) => reqAsPromise((await store(name)).get(key));
  const put = async (name, key, value) => reqAsPromise((await store(name, 'readwrite')).put(value, key));
  const del = async (name, key) => reqAsPromise((await store(name, 'readwrite')).delete(key));
  const clear = async (name) => reqAsPromise((await store(name, 'readwrite')).clear());
  const all = async (name) => reqAsPromise((await store(name)).getAll());
  const allEntries = async (name) => {
    const s = await store(name);
    const [keys, values] = await Promise.all([reqAsPromise(s.getAllKeys()), reqAsPromise(s.getAll())]);
    return keys.map((k, i) => [k, values[i]]);
  };

  // ─── Outbox ────────────────────────────────────────────────────────────────
  let flushing = false;
  const listeners = new Set();
  const notify = async () => {
    const pending = (await all('outbox')).length;
    listeners.forEach(fn => fn(pending));
  };

  // Enfileira uma operação. Ops para o mesmo path+method são coalescidas
  // (a última versão do roteiro substitui as anteriores na fila).
  async function enqueue(op) {
    const entries = await allEntries('outbox');
    for (const [key, existing] of entries) {
      if (existing.path === op.path && existing.method === op.method) await del('outbox', key);
    }
    await put('outbox', Date.now() + Math.random(), { ...op, queuedAt: Date.now() });
    await notify();
    return flush();
  }

  // Reenvia a fila em ordem. Para no primeiro erro de rede (tenta de novo
  // no próximo 'online'); erros 4xx são permanentes e descartam a operação.
  async function flush() {
    if (flushing || !navigator.onLine) return false;
    flushing = true;
    let allSent = true;
    try {
      const entries = (await allEntries('outbox')).sort((a, b) => a[0] - b[0]);
      for (const [key, op] of entries) {
        try {
          const res = await fetch(op.path, {
            method: op.method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: op.body ? JSON.stringify(op.body) : undefined,
          });
          if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401)) {
            await del('outbox', key);
          } else {
            allSent = false;
            break; // 5xx ou 401: tenta mais tarde
          }
        } catch {
          allSent = false;
          break; // sem rede: tenta no próximo 'online'
        }
      }
    } finally {
      flushing = false;
      await notify();
    }
    return allSent;
  }

  const pendingCount = async () => (await all('outbox')).length;
  const onPendingChange = fn => { listeners.add(fn); pendingCount().then(fn); };

  window.addEventListener('online', flush);

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `uid-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  return { get, put, del, clear, all, allEntries, enqueue, flush, pendingCount, onPendingChange, uid };
})();
