const Library = (() => {
  // آیکونِ ساده و اورجینال برای نشونِ واحدِ سینکِ کارت کتاب.
  // گروهِ arrow-up جدا شده تا فقط خودِ فلش (نه کل ابر) تو حالتِ idle پمپاژ کنه.
  const ICON_UPLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 17a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.5 9.5a4 4 0 0 1-.5 7.98"/><g class="arrow-up"><path d="M12 11v7"/><path d="M9 14l3-3 3 3"/></g></svg>';
  
  // آیکون چرخش برای زمان سینک دیتای یادداشت‌ها و هایلایت‌ها
  const ICON_SYNC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';

  async function render() {
    const books = await LocalStore.getAllBooks();
    const grid = document.getElementById('library-grid');
    const empty = document.getElementById('library-empty');
    if (!books || books.length === 0) { grid.style.display='none'; empty.style.display='flex'; return; }
    empty.style.display='none'; grid.style.display='grid'; grid.innerHTML='';
    books.sort((a,b) => (b.addedAt||0)-(a.addedAt||0));
    for (const book of books) {
      const card = document.createElement('div');
      card.className = 'book-card';

      // بررسی وضعیت جهت نمایش آیکون مناسب با اولویت آپلود فایل
      const needsBookUpload = !book.driveFileId;
      const anns = await LocalStore.getAnnotationsForBook(book.id);
      const needsNotesSync = !needsBookUpload && anns.length > 0 && (book.annotationsUpdatedAt || 0) > (book.annotationsSyncedAt || 0);
      
      let badge = '';
      if (needsBookUpload) {
        badge = `<span class="drive-badge" title="آپلود فایل کتاب روی درایو — لمس کن">${ICON_UPLOAD}</span>`;
      } else if (needsNotesSync) {
        badge = `<span class="drive-badge" title="سینک یادداشت‌ها و هایلایت‌ها — لمس کن">${ICON_SYNC}</span>`;
      }

      card.innerHTML = `
        <div class="book-cover">
          ${badge}
          <span>${esc(book.title)}</span>
          <div class="book-progress"><div class="book-progress-fill" style="width:${book.progress||0}%"></div></div>
        </div>
        <div class="book-title">${esc(book.title)}</div>`;

      let pressTimer = null;
      let longPressFired = false;
      card.addEventListener('touchstart', (e) => {
        if (e.target.closest('.drive-badge')) return; // بج خودش handler جدا داره، تداخل نکنه
        longPressFired = false;
        pressTimer = setTimeout(() => { longPressFired = true; showBookMenu(book); }, 700);
      }, { passive: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach(evt =>
        card.addEventListener(evt, () => clearTimeout(pressTimer))
      );
      card.addEventListener('click', () => {
        if (longPressFired) { longPressFired = false; return; } // این کلیک ادامه‌ی long-press بود، کتاب رو باز نکن
        Reader.open(book.id); showScreen('screen-reader');
      });

      const badgeEl = card.querySelector('.drive-badge');
      if (badgeEl) {
        badgeEl.addEventListener('click', (e) => {
          e.stopPropagation(); // نذار کلیک به کارت برسه و کتاب رو باز کنه
          syncOneBookCombined(book, badgeEl);
        });
      }

      grid.appendChild(card);
    }
  }
  function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
  function closeAllPanels() {
    let removed = false;
    ['drive-download-panel', 'book-menu-panel', 'book-details-panel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.remove(); removed = true; }
    });
    return removed;
  }

  // ===== بکاپ گرفتن از یک کتاب مشخص، جدا از سینک دسته‌جمعی =====
  // ===== سینکِ ترکیبی یک کتابِ خاص — با لمسِ بَجِ واحد رو همون کارت =====
  async function syncOneBookCombined(book, badgeEl) {
    if (!(await Auth.isLoggedIn())) { alert('برای سینک با Drive باید وارد حساب گوگل باشید.'); return; }

    // خودحفاظتی: قبل از فرضِ «نیاز به آپلود»، چک کن شاید این کتاب از قبل رو Drive باشه
    if (!book.driveFileId) {
      try {
        const remoteBooks = await DriveSync.listRemoteBooks();
        const match = remoteBooks.find(f => f.bookId === book.id);
        if (match) {
          book.driveFileId = match.driveFileId;
          book.driveSyncedAt = Date.now();
          await LocalStore.saveBook(book);
        }
      } catch (e) { /* چک نشد، با فرضِ نیاز به آپلود ادامه بده */ }
    }

    const needsBookUpload = !book.driveFileId;
    const anns = await LocalStore.getAnnotationsForBook(book.id);
    const needsNotesSync = !needsBookUpload && anns.length > 0 && (book.annotationsUpdatedAt || 0) > (book.annotationsSyncedAt || 0);
    const shouldUploadNotesNow = needsBookUpload ? anns.length > 0 : needsNotesSync;

    if (!needsBookUpload && !needsNotesSync) { badgeEl.remove(); return; } 

    let message;
    if (needsBookUpload) {
      message = anns.length > 0
        ? `«${book.title}» و یادداشت‌هاش تو Google Drive پشتیبان‌گیری بشه؟`
        : `«${book.title}» تو Google Drive پشتیبان‌گیری بشه؟`;
    } else {
      message = `هایلایت/یادداشت‌های «${book.title}» تو Google Drive بکاپ بشه؟`;
    }
    if (!confirm(message)) return;

    const statusEl = document.getElementById('sync-status');
    badgeEl.classList.add('processing'); // فعال‌سازی انیمیشن چرخش سریع
    statusEl.style.display = 'block';
    try {
      if (needsBookUpload) {
        statusEl.textContent = `در حال آپلود: ${book.title}`;
        await DriveSync.uploadBook(book);
      }
      if (shouldUploadNotesNow) {
        statusEl.textContent = `در حال بکاپِ یادداشت‌ها: ${book.title}`;
        await DriveSync.uploadAnnotations(book.id, book.title, anns);
        book.annotationsSyncedAt = Date.now();
        await LocalStore.saveBook(book);
      }
      statusEl.textContent = 'بکاپ کامل شد ✓';
      badgeEl.remove(); // هر دو حالتی که لازم بود انجام شد، دیگه بَجی لازم نیست
      setTimeout(() => { statusEl.style.display = 'none'; }, 1500);
    } catch (err) {
      statusEl.style.display = 'none';
      badgeEl.classList.remove('processing'); // برگشت به idle
      alert(`بکاپِ «${book.title}» ناموفق بود: ` + err.message);
    }
  }

  // ===== بررسی وضعیت سینک با Drive و اجرا فقط با تأیید کاربر =====
  async function checkAndSync() {
    const statusEl = document.getElementById('sync-status');
    if (!(await Auth.isLoggedIn())) { alert('برای سینک با Drive باید وارد حساب گوگل باشید.'); return; }

    statusEl.style.display = 'block';
    statusEl.textContent = 'در حال بررسی Google Drive...';
    try {
      const { needsUpload, needsDownload, needsRepair } = await DriveSync.checkSyncStatus();

      const allBooks = await LocalStore.getAllBooks();
      const withAnnotations = [];
      for (const b of allBooks) {
        const anns = await LocalStore.getAnnotationsForBook(b.id);
        if (anns.length > 0) withAnnotations.push({ book: b, annotations: anns });
      }

      if (needsRepair.length > 0) {
        statusEl.textContent = 'در حال تصحیح اطلاعات محلی...';
        for (const { book, remote } of needsRepair) {
          book.driveFileId = remote.driveFileId;
          book.driveSyncedAt = Date.now();
          await LocalStore.saveBook(book);
        }
        render();
      }

      if (needsUpload.length === 0 && needsDownload.length === 0 && withAnnotations.length === 0) {
        statusEl.textContent = needsRepair.length > 0 ? `${needsRepair.length} کتاب تصحیح شد ✓` : 'همه‌چیز به‌روزه ✓';
        setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
        return;
      }

      if (needsUpload.length > 0) {
        const ok = confirm(`${needsUpload.length} کتاب روی این گوشی هنوز پشتیبان‌گیری نشده. الان آپلود بشن؟`);
        if (ok) {
          let uploadFailed = false;
          for (let i = 0; i < needsUpload.length; i++) {
            statusEl.style.display = 'block';
            statusEl.textContent = `آپلود ${i + 1} از ${needsUpload.length}: ${needsUpload[i].title}`;
            try {
              await DriveSync.uploadBook(needsUpload[i]);
            } catch (err) {
              statusEl.style.display = 'none';
              alert(`آپلود «${needsUpload[i].title}» ناموفق بود: ${err.message}\n(کتاب‌های قبلی این دور با موفقیت آپلود شدن، دوباره که بزنید فقط از همینجا ادامه پیدا می‌کنه)`);
              uploadFailed = true;
              break;
            }
          }
          render();
          if (!uploadFailed) {
            statusEl.style.display = 'block';
            statusEl.textContent = 'آپلود تمام شد ✓';
            setTimeout(() => { statusEl.style.display = 'none'; }, 1500);
          }
        }
      }

      if (needsDownload.length > 0) {
        statusEl.style.display = 'none';
        showDownloadPicker(needsDownload);
      }

      if (withAnnotations.length > 0) {
        const okNotes = confirm(`هایلایت/یادداشت‌های ${withAnnotations.length} کتاب رو Drive بکاپ بشه؟`);
        if (okNotes) {
          let noteFailCount = 0;
          for (let i = 0; i < withAnnotations.length; i++) {
            const { book, annotations } = withAnnotations[i];
            statusEl.style.display = 'block';
            statusEl.textContent = `بکاپِ یادداشت‌ها ${i + 1} از ${withAnnotations.length}: ${book.title}`;
            try {
              await DriveSync.uploadAnnotations(book.id, book.title, annotations);
              book.annotationsSyncedAt = Date.now();
              await LocalStore.saveBook(book);
            }
            catch (err) { noteFailCount++; }
          }
          statusEl.style.display = 'block';
          statusEl.textContent = noteFailCount === 0 ? 'بکاپِ یادداشت‌ها کامل شد ✓' : `بکاپِ یادداشت‌ها: ${withAnnotations.length - noteFailCount} موفق، ${noteFailCount} ناموفق`;
          render();
          setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
        }
      }
    } catch (err) {
      statusEl.style.display = 'none';
      alert('خطا در سینک: ' + err.message);
    }
  }

  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined) return 'حجم نامشخص';
    if (bytes < 1024) return bytes + ' بایت';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' کیلوبایت';
    return (bytes / 1024 / 1024).toFixed(1) + ' مگابایت';
  }

  function showDownloadPicker(remoteBooks) {
    closeAllPanels();

    const panel = document.createElement('div');
    panel.id = 'drive-download-panel';
    panel.className = 'bottom-sheet';
    panel.innerHTML = `
      <div class="bs-header">
        <span class="bs-title">کتاب‌های موجود در Drive (${remoteBooks.length})</span>
        <button class="bs-close" id="ddp-close">✕</button>
      </div>
      <div class="bs-list" id="ddp-list"></div>
      <button id="ddp-download-all" class="btn-secondary" style="width:100%;">دانلود همه</button>
    `;
    document.getElementById('screen-library').appendChild(panel);
    panel.addEventListener('click', (e) => e.stopPropagation());

    const list = panel.querySelector('#ddp-list');
    remoteBooks.forEach(rb => {
      const row = document.createElement('div');
      row.className = 'drive-row';
      row.innerHTML = `
        <div class="drive-row-info">
          <div class="drive-row-title">${esc(rb.name)}</div>
          <div class="drive-row-size">${formatBytes(rb.size)}</div>
        </div>
        <button class="rs-btn">دانلود</button>`;
      row.querySelector('button').onclick = () => downloadOneFromPicker(rb, row, panel);
      list.appendChild(row);
    });

    panel.querySelector('#ddp-close').onclick = () => panel.remove();
    panel.querySelector('#ddp-download-all').onclick = async () => {
      for (const row of Array.from(list.querySelectorAll('.drive-row'))) {
        const btn = row.querySelector('button');
        if (btn && !btn.disabled) await btn.onclick();
      }
    };

    panel.classList.add('visible');
  }

  async function downloadOneFromPicker(remoteBookInfo, rowEl, panel) {
    const btn = rowEl.querySelector('button');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const book = await DriveSync.downloadBook(remoteBookInfo.driveFileId);
      await LocalStore.saveBook(book);
      try {
        const annFiles = await DriveSync.listRemoteAnnotationFiles();
        const match = annFiles.find(f => f.bookId === book.id);
        if (match) {
          const annotations = await DriveSync.downloadAnnotations(match.driveFileId);
          for (const ann of annotations) await LocalStore.saveAnnotation(ann);
          
          // به‌روزرسانی مهر زمانی سینک یادداشت‌ها بعد از دانلود موفق
          book.annotationsSyncedAt = Date.now();
          await LocalStore.saveBook(book);
        }
      } catch (annErr) { /* یادداشت‌ها برنگشت، مهم نیست؛ خودِ کتاب سرجاشه */ }
      rowEl.remove();
      render();
      if (panel.querySelector('#ddp-list').children.length === 0) {
        setTimeout(() => panel.remove(), 400);
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'دانلود';
      alert(`دانلود «${remoteBookInfo.name}» ناموفق بود: ` + err.message);
    }
  }

  function showBookMenu(book) {
    closeAllPanels();

    const panel = document.createElement('div');
    panel.id = 'book-menu-panel';
    panel.className = 'bottom-sheet';
    panel.innerHTML = `
      <div class="bs-header">
        <span class="bs-title">${esc(book.title)}</span>
        <button class="bs-close" id="bm-close">✕</button>
      </div>
      <button class="menu-item" id="bm-details">جزئیات</button>
      <button class="menu-item menu-item-danger" id="bm-delete">حذف از کتابخانه</button>
    `;
    document.getElementById('screen-library').appendChild(panel);
    panel.addEventListener('click', (e) => e.stopPropagation());

    panel.querySelector('#bm-close').onclick = () => panel.remove();
    panel.querySelector('#bm-details').onclick = () => { panel.remove(); showBookDetails(book); };
    panel.querySelector('#bm-delete').onclick = () => { panel.remove(); confirmDeleteBook(book); };

    panel.classList.add('visible');
  }

  function showBookDetails(book) {
    closeAllPanels();

    const sizeBytes = new Blob([book.content || '']).size;
    const pageInfo = (book.sourceType === 'pdf-ocr' && book.totalPages) ? `${book.totalPages} صفحه` : '—';
    const driveInfo = book.driveFileId
      ? 'بله' + (book.driveSyncedAt ? ' — ' + new Date(book.driveSyncedAt).toLocaleDateString('fa-IR') : '')
      : 'خیر';
    const translatorRow = book.translator
      ? `<div class="details-row"><span class="details-label">مترجم</span><span class="details-value">${esc(book.translator)}</span></div>`
      : '';

    const panel = document.createElement('div');
    panel.id = 'book-details-panel';
    panel.className = 'bottom-sheet';
    panel.innerHTML = `
      <div class="bs-header">
        <span class="bs-title">جزئیات کتاب</span>
        <button class="bs-close" id="bd-close">✕</button>
      </div>
      <div class="details-list">
        <div class="details-row"><span class="details-label">عنوان</span><span class="details-value">${esc(book.title)}</span></div>
        <div class="details-row"><span class="details-label">نویسنده</span><span class="details-value">${esc(book.author || 'نامشخص')}</span></div>
        ${translatorRow}
        <div class="details-row"><span class="details-label">تعداد صفحه</span><span class="details-value">${pageInfo}</span></div>
        <div class="details-row"><span class="details-label">حجم</span><span class="details-value">${formatBytes(sizeBytes)}</span></div>
        <div class="details-row"><span class="details-label">پشتیبان Drive</span><span class="details-value">${driveInfo}</span></div>
      </div>
    `;
    document.getElementById('screen-library').appendChild(panel);
    panel.addEventListener('click', (e) => e.stopPropagation());
    panel.querySelector('#bd-close').onclick = () => panel.remove();
    panel.classList.add('visible');
  }

  async function confirmDeleteBook(book) {
    const driveNote = book.driveFileId
      ? '\n(نسخه‌ی Drive دست‌نخورده می‌مونه — فقط از این گوشی حذف می‌شه.)'
      : '';
    if (!confirm(`«${book.title}» از کتابخانه‌ی این گوشی حذف بشه؟${driveNote}`)) return;
    await LocalStore.deleteBook(book.id);
    render();
  }

  return { render, checkAndSync, closeAllPanels };
})();
