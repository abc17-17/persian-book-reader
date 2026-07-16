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
      const badge = book.driveFileId ? '' : '<span class="drive-badge" title="پشتیبان‌گیری نشده — لمس کن">☁</span>';
      card.innerHTML = `
        <div class="book-cover">
          ${badge}
          <span>${esc(book.title)}</span>
          <div class="book-progress"><div class="book-progress-fill" style="width:${book.progress||0}%"></div></div>
        </div>
        <div class="book-title">${esc(book.title)}</div>`;
      card.addEventListener('click', () => { Reader.open(book.id); showScreen('screen-reader'); });

      const badgeEl = card.querySelector('.drive-badge');
      if (badgeEl) {
        badgeEl.addEventListener('click', (e) => {
          e.stopPropagation(); // نذار کلیک به کارت برسه و کتاب رو باز کنه
          syncOneBook(book, badgeEl);
        });
      }

      grid.appendChild(card);
    });
  }
  function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

  // ===== بکاپ گرفتن از یک کتاب مشخص، جدا از سینک دسته‌جمعی =====
  async function syncOneBook(book, badgeEl) {
    if (!(await Auth.isLoggedIn())) { alert('برای سینک با Drive باید وارد حساب گوگل باشید.'); return; }
    if (!confirm(`«${book.title}» تو Google Drive پشتیبان‌گیری بشه؟`)) return;

    const statusEl = document.getElementById('sync-status');
    statusEl.style.display = 'block';
    statusEl.textContent = `در حال آپلود: ${book.title}`;
    try {
      await DriveSync.uploadBook(book);
      statusEl.textContent = 'پشتیبان‌گیری کامل شد ✓';
      if (badgeEl) badgeEl.remove(); // دیگه لازم نیست کل لیست re-render بشه
      setTimeout(() => { statusEl.style.display = 'none'; }, 1500);
    } catch (err) {
      statusEl.style.display = 'none';
      alert(`پشتیبان‌گیری «${book.title}» ناموفق بود: ` + err.message);
    }
  }

  // ===== بررسی وضعیت سینک با Drive و اجرا فقط با تأیید کاربر (هم آپلود هم دانلود) =====
  async function checkAndSync() {
    const statusEl = document.getElementById('sync-status');
    if (!(await Auth.isLoggedIn())) { alert('برای سینک با Drive باید وارد حساب گوگل باشید.'); return; }

    statusEl.style.display = 'block';
    statusEl.textContent = 'در حال بررسی Google Drive...';
    try {
      const { needsUpload, needsDownload, needsRepair } = await DriveSync.checkSyncStatus();

      // ترمیم خاموش: کتاب‌هایی که با نسخه‌ی قدیمی‌تر دانلود شده بودن و لینک محلی‌شون گم بود.
      // هیچ آپلود/دانلود جدیدی لازم نیست، فقط driveFileId محلی رو به فایل موجود وصل می‌کنیم.
      if (needsRepair.length > 0) {
        statusEl.textContent = 'در حال تصحیح اطلاعات محلی...';
        for (const { book, remote } of needsRepair) {
          book.driveFileId = remote.driveFileId;
          book.driveSyncedAt = Date.now();
          await LocalStore.saveBook(book);
        }
        render();
      }

      if (needsUpload.length === 0 && needsDownload.length === 0) {
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
    } catch (err) {
      statusEl.style.display = 'none';
      alert('خطا در سینک: ' + err.message);
    }
  }

  // ===== پیکر دانلود: نمایش هر کتاب موجود در Drive با حجمش، امکان دانلود تک‌تک یا همه =====
  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined) return 'حجم نامشخص';
    if (bytes < 1024) return bytes + ' بایت';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' کیلوبایت';
    return (bytes / 1024 / 1024).toFixed(1) + ' مگابایت';
  }

  function showDownloadPicker(remoteBooks) {
    const old = document.getElementById('drive-download-panel');
    if (old) old.remove();

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

  return { render, checkAndSync };
})();
