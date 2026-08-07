const LocalStore = (() => {
  const DB_NAME = 'book_reader_db', DB_VERSION = 3;
  // نکته: annotations store بعد از اینکه بعضی نصب‌ها احتمالاً از قبل روی نسخه‌ی ۱
  // ساخته شده بودن به کد اضافه شد. IndexedDB فقط وقتی onupgradeneeded رو صدا می‌زنه
  // که نسخه‌ی درخواستی از نسخه‌ی موجود بیشتر باشه — پس بدون این ارتقا، نصب‌های قدیمی‌تر
  // هیچ‌وقت این store رو واقعاً نمی‌ساختن و ذخیره‌سازی annotation بی‌صدا شکست می‌خورد.
  //
  // نسخه‌ی ۳: دو store برای واردکردنِ قابل‌ازسرگیریِ PDF، عمداً از هم جدا —
  // import_pdfs فقط یک‌بار نوشته می‌شه (بایتِ خامِ PDF، ممکنه ده‌ها مگابایت باشه)،
  // import_progress بعدِ هر صفحه بازنویسی می‌شه (فقط متن، سبک). اگه این دو تو یه
  // رکورد بودن، هر چک‌پوینتِ ریز یعنی بازنویسِ کاملِ PDF خام هم فقط برای آپدیتِ چندخط.
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
        if (!db.objectStoreNames.contains('import_pdfs')) db.createObjectStore('import_pdfs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('import_progress')) db.createObjectStore('import_progress', { keyPath: 'id' });
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
    getAnnotation: (id) => get('annotations', id),
    getAnnotationsForBook: (bid) => getByIndex('annotations', 'bookId', bid),
    deleteAnnotation: (id) => remove('annotations', id),
    // ===== واردکردنِ قابل‌ازسرگیریِ PDF (فاز ۱) =====
    saveImportPdf: (rec) => put('import_pdfs', rec),
    getImportPdf: (id) => get('import_pdfs', id),
    deleteImportPdf: (id) => remove('import_pdfs', id),
    saveImportProgress: (rec) => put('import_progress', rec),
    getImportProgress: (id) => get('import_progress', id),
    getAllImportProgress: () => getAll('import_progress'),
    deleteImportProgress: (id) => remove('import_progress', id),
  };
})();
