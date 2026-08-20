// =========================================================
// FORGE · IndexedDB wrapper
// =========================================================
// Simple promise-based wrapper around IndexedDB. No dependencies.
// All app data lives here. Nothing leaves the device unless
// the user explicitly exports.
// =========================================================

const DB_NAME = 'forge';
const DB_VERSION = 2;

// Object stores. Add new stores here + bump DB_VERSION when needed.
export const STORES = {
  exercises:                { keyPath: 'id' },
  routines:                 { keyPath: 'id' },
  sessions:                 { keyPath: 'id' },
  bodyMeasurements:         { keyPath: 'id' },
  dailyActivity:            { keyPath: 'date' }, // one entry per YYYY-MM-DD
  goals:                    { keyPath: 'id' },
  settings:                 { keyPath: 'key' },  // key/value store
  meta:                     { keyPath: 'key' },  // key/value store
  // Added in v2 (Phase 2d · calorie tracking)
  foods:                    { keyPath: 'id' },   // personal food library
  mealLog:                  { keyPath: 'id' },   // individual meal entries
  dailyCalorieAdjustments:  { keyPath: 'date' }, // manual exercise-cal overrides per day
};

let _dbPromise = null;

export function openDb() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, config] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: config.keyPath });
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return _dbPromise;
}

function tx(db, storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function req2promise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// -------- CRUD --------

export async function put(storeName, value) {
  const db = await openDb();
  return req2promise(tx(db, storeName, 'readwrite').put(value));
}

export async function get(storeName, key) {
  const db = await openDb();
  return req2promise(tx(db, storeName).get(key));
}

export async function getAll(storeName) {
  const db = await openDb();
  return req2promise(tx(db, storeName).getAll());
}

export async function count(storeName) {
  const db = await openDb();
  return req2promise(tx(db, storeName).count());
}

export async function remove(storeName, key) {
  const db = await openDb();
  return req2promise(tx(db, storeName, 'readwrite').delete(key));
}

export async function clear(storeName) {
  const db = await openDb();
  return req2promise(tx(db, storeName, 'readwrite').clear());
}

export async function clearAll() {
  const db = await openDb();
  const promises = Object.keys(STORES).map((name) =>
    req2promise(db.transaction(name, 'readwrite').objectStore(name).clear())
  );
  return Promise.all(promises);
}

// -------- Bulk operations (faster than N put calls) --------

export async function putMany(storeName, values) {
  if (!values || values.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    for (const v of values) store.put(v);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// -------- Convenience settings helpers --------

export async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}

// -------- Storage estimation (for showing usage) --------

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  return navigator.storage.estimate();
}
