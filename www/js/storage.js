const LocalStore = (() => {
  const DB_NAME = 'book_reader_db', DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('annotations')) {
          const s = db.createObjectStore('annotations', { keyPath: 'id' });
          s.createIndex('bookId', 'bookId', { unique: false });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  async function put(store, val) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val);
      tx.oncomplete = () => res(val);
      tx.onerror = () => rej(tx.error);
    });
  }

  async function get(store, key) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function getAll(store) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  }

  async function remove(store, key) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  async function getByIndex(store, idx, val) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).index(idx).getAll(val);
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  }

  return {
    saveBook: (b) => put('books', b),
    getBook: (id) => get('books', id),
    getAllBooks: () => getAll('books'),
    deleteBook: (id) => remove('books', id),
    saveAnnotation: (a) => put('annotations', a),
    getAnnotationsForBook: (bid) => getByIndex('annotations', 'bookId', bid),
    deleteAnnotation: (id) => remove('annotations', id),
  };
})();
