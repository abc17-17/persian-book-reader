// storage.js — مدیریت ذخیره‌سازی محلی روی گوشی (حافظه موقت پیش از سینک با گوگل درایو)
// از IndexedDB استفاده می‌کنیم چون localStorage برای فایل‌های حجیم (PDF/EPUB) مناسب نیست

const LocalStore = (() => {

  const DB_NAME = 'book_reader_db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('annotations')) {
          const store = db.createObjectStore('annotations', { keyPath: 'id' });
          store.createIndex('bookId', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('pending_sync')) {
          db.createObjectStore('pending_sync', { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });

    return dbPromise;
  }

  async function put(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function get(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function getByIndex(storeName, indexName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const index = tx.objectStore(storeName).index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function remove(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ===== توابع اختصاصی برای کتاب‌ها =====

  async function saveBook(book) {
    return put('books', book);
  }

  async function getBook(id) {
    return get('books', id);
  }

  async function getAllBooks() {
    return getAll('books');
  }

  async function deleteBook(id) {
    return remove('books', id);
  }

  // ===== توابع اختصاصی برای هایلایت‌ها و یادداشت‌ها =====

  async function saveAnnotation(annotation) {
    return put('annotations', annotation);
  }

  async function getAnnotationsForBook(bookId) {
    return getByIndex('annotations', 'bookId', bookId);
  }

  async function deleteAnnotation(id) {
    return remove('annotations', id);
  }

  // ===== صف انتظار برای زمانی که اینترنت نیست =====
  // هر تغییری که باید روی گوگل درایو اعمال شود، تا وصل شدن اینترنت اینجا می‌ماند

  async function queueForSync(item) {
    return put('pending_sync', { ...item, queuedAt: Date.now() });
  }

  async function getPendingSyncItems() {
    return getAll('pending_sync');
  }

  async function clearSyncItem(id) {
    return remove('pending_sync', id);
  }

  return {
    saveBook, getBook, getAllBooks, deleteBook,
    saveAnnotation, getAnnotationsForBook, deleteAnnotation,
    queueForSync, getPendingSyncItems, clearSyncItem
  };
})();
