const Library = (() => {
  async function render() {
    const books = await LocalStore.getAllBooks();
    const grid = document.getElementById('library-grid');
    const empty = document.getElementById('library-empty');
    if (!books || books.length === 0) { grid.style.display='none'; empty.style.display='flex'; return; }
    empty.style.display='none'; grid.style.display='grid'; grid.innerHTML='';
    books.sort((a,b) => (b.addedAt||0)-(a.addedAt||0));
    books.forEach(book => {
      const card = document.createElement('div');
      card.className = 'book-card';
      const badge = book.driveFileId ? '' : '<span class="drive-badge" title="پشتیبان‌گیری نشده">☁</span>';
      card.innerHTML = `
        <div class="book-cover">
          ${badge}
          <span>${esc(book.title)}</span>
          <div class="book-progress"><div class="book-progress-fill" style="width:${book.progress||0}%"></div></div>
        </div>
        <div class="book-title">${esc(book.title)}</div>`;
      card.addEventListener('click', () => { Reader.open(book.id); showScreen('screen-reader'); });
      grid.appendChild(card);
    });
  }
  function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

  // ===== بررسی وضعیت سینک با Drive و اجرا فقط با تأیید کاربر (هم آپلود هم دانلود) =====
  async function checkAndSync() {
    const statusEl = document.getElementById('sync-status');
    if (!(await Auth.isLoggedIn())) { alert('برای سینک با Drive باید وارد حساب گوگل باشید.'); return; }

    statusEl.style.display = 'block';
    statusEl.textContent = 'در حال بررسی Google Drive...';
    try {
      const { needsUpload, needsDownload } = await DriveSync.checkSyncStatus();

      if (needsUpload.length === 0 && needsDownload.length === 0) {
        statusEl.textContent = 'همه‌چیز به‌روزه ✓';
        setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
        return;
      }

      if (needsUpload.length > 0) {
        const ok = confirm(`${needsUpload.length} کتاب روی این گوشی هنوز پشتیبان‌گیری نشده. الان آپلود بشن؟`);
        if (ok) {
          for (let i = 0; i < needsUpload.length; i++) {
            statusEl.textContent = `آپلود ${i + 1} از ${needsUpload.length}: ${needsUpload[i].title}`;
            try {
              await DriveSync.uploadBook(needsUpload[i]);
            } catch (err) {
              throw new Error(`آپلود «${needsUpload[i].title}» ناموفق بود: ${err.message} (کتاب‌های قبلی این دور با موفقیت آپلود شدن، دوباره که بزنید فقط از همینجا ادامه پیدا می‌کنه)`);
            }
          }
        }
      }

      if (needsDownload.length > 0) {
        const ok = confirm(`${needsDownload.length} کتاب تو Google Drive شما هست که روی این گوشی نیست. دانلود بشن؟`);
        if (ok) {
          for (let i = 0; i < needsDownload.length; i++) {
            statusEl.textContent = `دانلود ${i + 1} از ${needsDownload.length}: ${needsDownload[i].name}`;
            try {
              const book = await DriveSync.downloadBook(needsDownload[i].driveFileId);
              await LocalStore.saveBook(book);
            } catch (err) {
              throw new Error(`دانلود «${needsDownload[i].name}» ناموفق بود: ${err.message}`);
            }
          }
        }
      }

      statusEl.textContent = 'سینک تمام شد ✓';
      render();
      setTimeout(() => { statusEl.style.display = 'none'; }, 1800);
    } catch (err) {
      statusEl.style.display = 'none';
      alert('خطا در سینک: ' + err.message);
    }
  }

  return { render, checkAndSync };
})();
