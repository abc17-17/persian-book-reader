const DriveSync = (() => {
  const FOLDER_NAME = 'کتابخوان من - بکاپ';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const MAX_SAFE_BYTES = 4 * 1024 * 1024; // زیر سقف عملی ۵ مگابایت آپلود multipart گوگل نگه می‌داریم

  let folderId = null;

  // ===== درخواست‌های احرازشده به Drive =====
  function authHeader() {
    const token = Auth.getAccessToken();
    if (!token) throw new Error('برای سینک با Drive باید وارد حساب گوگل باشید.');
    return { Authorization: `Bearer ${token}` };
  }

  async function driveFetch(url, options = {}, isRetry = false) {
    let resp;
    try {
      resp = await fetch(url, { ...options, headers: { ...authHeader(), ...(options.headers || {}) } });
    } catch (e) {
      throw new Error('اتصال به Google Drive برقرار نشد. اینترنت را چک کنید.');
    }
    if (resp.status === 401) {
      if (isRetry) {
        throw new Error('نشست گوگل هنوز مشکل داره. از «حساب کاربری» خارج و دوباره وارد شوید.');
      }
      // نشست منقضی شده — به‌جای dead-end کردن، خودمون یه sign-in تازه امتحان می‌کنیم
      // (این معمولاً چون قبلاً روی این گوشی وارد شده سریع/بی‌دردسره) و همین درخواست رو
      // دقیقاً یک‌بار دیگه با token تازه تکرار می‌کنیم.
      try {
        await Auth.login();
      } catch (loginErr) {
        throw new Error('نشست گوگل منقضی شده و ورود دوباره ناموفق بود: ' + loginErr.message);
      }
      return driveFetch(url, options, true);
    }
    if (!resp.ok) {
      let msg = `خطای Drive (کد ${resp.status})`;
      try { const j = await resp.json(); if (j.error?.message) msg = j.error.message; } catch (e) {}
      throw new Error(msg);
    }
    return resp;
  }

  // ===== پیدا کردن یا ساختن پوشه‌ی بکاپ (فقط یک‌بار در کل عمر اپ، بعدش کش می‌شود) =====
  async function ensureFolder() {
    if (folderId) return folderId;
    const cached = localStorage.getItem('drive_folder_id');
    if (cached) { folderId = cached; return folderId; }

    const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`);
    const searchResp = await driveFetch(`${API}/files?q=${q}&fields=files(id,name)`);
    const searchData = await searchResp.json();

    if (searchData.files && searchData.files.length > 0) {
      folderId = searchData.files[0].id;
    } else {
      const createResp = await driveFetch(`${API}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
      });
      const createData = await createResp.json();
      folderId = createData.id;
    }
    localStorage.setItem('drive_folder_id', folderId);
    return folderId;
  }

  function sanitizeFileName(title) {
    return (title || 'کتاب').replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
  }

  // ===== ساخت بدنه‌ی multipart برای آپلود (متادیتا + محتوای JSON کتاب) =====
  function buildMultipartBody(metadata, contentStr) {
    const boundary = 'ktbkhn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${contentStr}\r\n` +
      `--${boundary}--`;
    return { body, boundary };
  }

  // ===== آپلود یک کتاب (ساخت اگه جدیده، آپدیت اگه قبلاً بکاپ شده) =====
  async function uploadBook(book) {
    const contentStr = JSON.stringify(book);

    // اندازه رو قبل از ارسال چک کن — آپلود multipart گوگل برای فایل‌های خیلی بزرگ (>۵MB) قابل‌اعتماد نیست
    const byteSize = new Blob([contentStr]).size;
    if (byteSize > MAX_SAFE_BYTES) {
      throw new Error(`این کتاب برای بکاپ خیلی بزرگه (${(byteSize / 1024 / 1024).toFixed(1)} مگابایت). فعلاً کتاب‌های خیلی بزرگ پشتیبانی نمی‌شن.`);
    }

    const fid = await ensureFolder();
    const isUpdate = !!book.driveFileId;
    const metadata = isUpdate
      ? { name: sanitizeFileName(book.title) + '.json' }
      : { name: sanitizeFileName(book.title) + '.json', parents: [fid], appProperties: { bookId: book.id } };

    const { body, boundary } = buildMultipartBody(metadata, contentStr);
    const url = isUpdate
      ? `${UPLOAD_API}/files/${book.driveFileId}?uploadType=multipart`
      : `${UPLOAD_API}/files?uploadType=multipart`;

    const resp = await driveFetch(url, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    const data = await resp.json();

    book.driveFileId = data.id;
    book.driveSyncedAt = Date.now();
    await LocalStore.saveBook(book);
    return book;
  }

  // ===== لیست فایل‌های داخل پوشه‌ی بکاپ =====
  async function listRemoteBooks() {
    const fid = await ensureFolder();
    const q = encodeURIComponent(`'${fid}' in parents and trashed=false`);
    const resp = await driveFetch(`${API}/files?q=${q}&fields=files(id,name,modifiedTime,appProperties)&pageSize=1000`);
    const data = await resp.json();
    return (data.files || []).map(f => ({
      driveFileId: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
      bookId: f.appProperties && f.appProperties.bookId ? f.appProperties.bookId : null
    }));
  }

  // ===== دانلود محتوای یک کتاب از Drive =====
  async function downloadBook(driveFileId) {
    const resp = await driveFetch(`${API}/files/${driveFileId}?alt=media`);
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('محتوای دریافتی از Drive خراب یا ناقص بود.');
    }
  }

  // ===== مقایسه‌ی وضعیت محلی با Drive؛ چیزی آپلود/دانلود نمی‌کند، فقط گزارش می‌دهد =====
  async function checkSyncStatus() {
    const [localBooks, remoteBooks] = await Promise.all([
      LocalStore.getAllBooks(),
      listRemoteBooks()
    ]);
    const remoteBookIds = new Set(remoteBooks.map(r => r.bookId).filter(Boolean));
    const localBookIds = new Set(localBooks.map(b => b.id));

    const needsUpload = localBooks.filter(b => !b.driveFileId || !remoteBookIds.has(b.id));
    const needsDownload = remoteBooks.filter(r => r.bookId && !localBookIds.has(r.bookId));

    return { needsUpload, needsDownload };
  }

  return { ensureFolder, uploadBook, listRemoteBooks, downloadBook, checkSyncStatus };
})();
