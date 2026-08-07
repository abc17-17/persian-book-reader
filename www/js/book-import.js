const BookImport = (() => {
  // paused/activeJobId جایگزینِ cancelled شدن — چون با چک‌پوینتِ فاز ۱، توقف دیگه
  // به‌معنیِ از دست رفتنِ کار نیست، فقط یعنی «فعلاً نگه‌دار، بعداً از همینجا ادامه بده».
  let paused = false;
  let activeJobId = null;

  function generateId() { return 'book_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); }
  function generateJobId() { return 'import_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); }

  // ===== استخراج نویسنده/مترجم — روی متنی که OCR از قبل تحویل داده، نه با تغییر پرامپت =====
  // عمداً پرامپت OCR رو دست نمی‌زنیم: تغییر دستورالعمل استخراج متن اصلی کتاب ریسک توهم
  // مدل (اضافه‌کردن/تغییر متن) رو بالا می‌بره. این regex فقط بعد از اتمام OCR، رو متن
  // آماده اجرا می‌شه — هیچ اثری رو محتوای واقعی کتاب نداره، فقط دو فیلد جدا استخراج می‌کنه.
  function cleanExtractedName(raw) {
    if (!raw) return null;
    let s = raw.trim().replace(/^[-\s]+|[-\s]+$/g, '').trim();
    if (s.length < 2 || s.length > 40) return null; // خیلی کوتاه/بلند = احتمالاً match اشتباه
    return s;
  }

  function extractAuthorTranslator(searchText, title) {
    // تگ‌های HTML رو با خط جدید جایگزین می‌کنیم (نه فاصله) تا مرز پاراگراف‌ها حفظ بشه —
    // وگرنه «نویسنده: X» و پاراگراف بعدی به هم می‌چسبن و capture خیلی جلوتر می‌ره.
    const plainText = (searchText || '').replace(/<[^>]+>/g, '\n');

    // کلیدواژه باید اول خط خودش باشه (مثل صفحه‌ی عنوان)، یا بعد از یه خط‌تیره‌ی جداکننده
    // (برای حالتی که نویسنده و مترجم هر دو رو یه خطن) — نه وسط یه جمله‌ی روایی معمولی
    // (مثلاً «...نویسنده‌ای که هویتش...» نباید به‌عنوان اسم نویسنده گرفته بشه).
    const authorRe = /(?:^|\n|-\s*)\s*(?:نویسنده|نوشتهٔ|نوشته‌ی|نوشته|اثر)\s*[:\-]?\s*([^\n،,\-]+)/;
    const translatorRe = /(?:^|\n|-\s*)\s*(?:مترجم|ترجمهٔ|ترجمه‌ی|ترجمه|برگردان)\s*[:\-]?\s*([^\n،,\-]+)/;

    let author = cleanExtractedName((plainText.match(authorRe) || [])[1]);
    let translator = cleanExtractedName((plainText.match(translatorRe) || [])[1]);

    // پشتیبان: الگوی اسم فایل «عنوان-نویسنده-مترجم»، فقط برای فیلدی که تو متن پیدا نشد
    if (!author || !translator) {
      const parts = (title || '').split('-').map(s => s.trim()).filter(Boolean);
      if (!author) author = cleanExtractedName(parts[1]);
      if (!translator) translator = cleanExtractedName(parts[2]);
    }
    return { author, translator };
  }

  // بعد از ذخیره‌ی محلی، با تأیید کاربر یک نسخه هم تو Drive بذار. اگه لاگین نیست یا
  // نخواست، بی‌سروصدا رد می‌شه — کتاب همچنان محلی سالمه، فقط بعداً از دکمه‌ی سینک
  // تو کتابخانه می‌شه دوباره امتحان کرد.
  async function offerBackup(book) {
    if (!(await Auth.isLoggedIn())) return;
    if (!confirm(`«${book.title}» ذخیره شد. همین الان یک نسخه پشتیبان در Google Drive شما هم بذاریم؟`)) return;
    updateStatus('در حال آپلود به Google Drive...');
    try {
      await DriveSync.uploadBook(book);
      updateStatus('پشتیبان‌گیری کامل شد ✓');
      await new Promise(r => setTimeout(r, 900));
    } catch (err) {
      alert('پشتیبان‌گیری ناموفق بود: ' + err.message + '\nکتاب رو می‌تونید بعداً از دکمه‌ی سینک تو کتابخانه دوباره امتحان کنید.');
    }
  }

  function init() {
    document.getElementById('file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      if (file.name.toLowerCase().endsWith('.pdf')) await startNewPdfImport(file);
      else if (file.name.toLowerCase().endsWith('.txt')) await handleTextImport(file);
      else alert('فعلاً فقط فایل‌های PDF و TXT پشتیبانی می‌شوند.');
    });
  }

  async function handleTextImport(file) {
    const text = await file.text();
    const title = file.name.replace(/\.txt$/i, '');
    // تبدیل متن خام به HTML ساده
    const html = text.split('\n').filter(l => l.trim()).map(l => `<p>${escHtml(l.trim())}</p>`).join('\n');
    const { author, translator } = extractAuthorTranslator(html.slice(0, 800), title);
    const book = { id: generateId(), title, content: html, progress: 0, addedAt: Date.now(), sourceType: 'txt', author, translator };
    await LocalStore.saveBook(book);
    await offerBackup(book);
    showScreen('screen-library');
    Library.render();
  }

  // ===== شروعِ واردکردنِ تازه‌ی یک PDF =====
  async function startNewPdfImport(file) {
    if (!OCR.hasApiKey()) {
      alert('برای پردازش PDF ابتدا باید کلید Gemini API را در تنظیمات وارد کنید.');
      showScreen('screen-settings');
      return;
    }
    const jobId = generateJobId();
    const title = file.name.replace(/\.pdf$/i, '');
    renderProcessingUI(title);

    try {
      // نکته‌ی مهم: بایتِ خامِ فایل رو *قبل* از دادنش به pdf.js تو IndexedDB ذخیره
      // می‌کنیم. pdf.js پردازش رو به یه Worker می‌سپاره و ممکنه ArrayBuffer اصلی رو
      // detach کنه (دیگه قابل‌استفاده نمونه) — پس یه کپیِ مستقل باید زودتر از هر
      // parseای امن بشه، وگرنه با یه توقفِ ناخواسته، خودِ فایل خراب ذخیره می‌شه.
      updateStatus('در حال ذخیره‌ی فایل PDF...');
      const arrayBuffer = await file.arrayBuffer();
      await LocalStore.saveImportPdf({ id: jobId, title, pdfData: arrayBuffer, createdAt: Date.now() });

      updateStatus('در حال باز کردن فایل PDF...');
      const pdf = await PdfProcessor.loadPdf(arrayBuffer);
      const totalPages = pdf.numPages;

      await LocalStore.saveImportProgress({
        id: jobId, title, totalPages,
        pagesDone: new Array(totalPages).fill(null),
        failedPages: [], nextPageToProcess: 1,
        updatedAt: Date.now(),
      });

      await runExtractionLoop(jobId, pdf);
    } catch (err) {
      updateStatus('خطا: ' + err.message);
    }
  }

  // ===== ادامه‌ی یک واردکردنِ نصفه‌کاره‌ی قبلی =====
  async function resumeImport(jobId) {
    showScreen('screen-processing');
    const progress = await LocalStore.getImportProgress(jobId);
    if (!progress) { alert('این پردازش دیگه پیدا نشد؛ احتمالاً قبلاً حذف شده.'); Library.render(); return; }

    renderProcessingUI(progress.title);
    updateProgress(progress.nextPageToProcess - 1, progress.totalPages);
    updateStatus('در حال آماده‌سازیِ ادامه...');

    try {
      const pdfRec = await LocalStore.getImportPdf(jobId);
      if (!pdfRec) throw new Error('فایل PDF ذخیره‌شده برای این کتاب پیدا نشد.');
      // همیشه از رکوردِ ذخیره‌شده parse می‌کنیم، نه از یه بافرِ در حافظه — این نسخه
      // هیچ‌وقت دستِ pdf.js نبوده، پس خطرِ detach شدن اینجا مطرح نیست.
      const pdf = await PdfProcessor.loadPdf(pdfRec.pdfData);
      await runExtractionLoop(jobId, pdf);
    } catch (err) {
      updateStatus('خطا: ' + err.message);
    }
  }

  // ===== حلقه‌ی مشترکِ استخراج — هم مسیرِ شروعِ تازه هم مسیرِ ادامه از همین رد می‌شه =====
  async function runExtractionLoop(jobId, pdf) {
    paused = false;
    activeJobId = jobId;

    const progress = await LocalStore.getImportProgress(jobId);
    updateProgress(progress.nextPageToProcess - 1, progress.totalPages);

    for (let i = progress.nextPageToProcess; i <= progress.totalPages; i++) {
      if (paused) {
        updateStatus('پردازش متوقف شد — از کتابخونه می‌تونی ادامه بدی.');
        activeJobId = null;
        return;
      }
      updateStatus(`استخراج متن صفحه ${i} از ${progress.totalPages}...`);
      try {
        const { base64, mimeType } = await PdfProcessor.renderPageAsImage(pdf, i);
        const html = await OCR.extractTextFromImage(base64, mimeType);
        progress.pagesDone[i - 1] = html;
      } catch (err) {
        progress.pagesDone[i - 1] = '';
        progress.failedPages.push(i);
      }

      // چک‌پوینت بعد از *هر* صفحه — نوشتن تو IndexedDB محلی ارزونه، دلیلی نداره
      // منتظرِ چند صفحه بمونیم. بدترین حالتِ یک قطعِ ناگهانی، از دست رفتنِ همین
      // یک صفحه‌ی در حالِ پردازشه، نه بیشتر.
      progress.nextPageToProcess = i + 1;
      progress.updatedAt = Date.now();
      await LocalStore.saveImportProgress(progress);
      updateProgress(i, progress.totalPages);
    }

    activeJobId = null;
    await finalizeImport(jobId, progress);
  }

  // ===== وقتی همه‌ی صفحه‌ها استخراج شدن: تبدیل به یک کتابِ واقعی + پاک‌سازیِ رکوردهای job =====
  async function finalizeImport(jobId, progress) {
    updateStatus('در حال ذخیره‌سازی...');
    const fullContent = progress.pagesDone.join('\n');
    const { author, translator } = extractAuthorTranslator(progress.pagesDone.slice(0, 3).join('\n'), progress.title);
    const book = {
      id: generateId(), title: progress.title, content: fullContent, progress: 0,
      addedAt: Date.now(), sourceType: 'pdf-ocr', totalPages: progress.totalPages,
      failedPages: progress.failedPages, author, translator,
    };
    await LocalStore.saveBook(book);
    await LocalStore.deleteImportPdf(jobId);
    await LocalStore.deleteImportProgress(jobId);

    if (progress.failedPages.length > 0) {
      updateStatus(`پردازش کامل شد. ${progress.failedPages.length} صفحه با مشکل مواجه شدند.`);
      await new Promise(r => setTimeout(r, 2500));
    }

    await offerBackup(book);
    showScreen('screen-library');
    Library.render();
  }

  // ===== توقفِ پردازشِ در حالِ اجرا — از دکمه‌ی «توقف» یا از دیالوگِ دکمه‌ی Back صدا زده می‌شه.
  // پیشرفت قبلاً چک‌پوینت شده، پس اینجا فقط یه فلگ ست می‌کنیم؛ حلقه خودش تو همون تکرارِ
  // فعلی که تموم بشه، تشخیص می‌ده و تمیز خارج می‌شه — چیزی برای پاک‌کردن نیست =====
  function pauseActiveImport() { if (activeJobId) paused = true; }
  function hasActiveImport() { return !!activeJobId; }

  // ===== حذفِ کاملِ یک واردکردنِ نصفه‌کاره — از طاقچه‌ی کتابخونه صدا زده می‌شه =====
  async function deleteImportJob(jobId) {
    await LocalStore.deleteImportPdf(jobId);
    await LocalStore.deleteImportProgress(jobId);
  }

  function renderProcessingUI(title) {
    const wrap = document.getElementById('processing-wrap');
    wrap.innerHTML = `
      <div class="processing-icon">📖</div>
      <h3 style="font-size:15px;font-weight:600;">${escHtml(title)}</h3>
      <p class="processing-hint" id="processing-status">در حال آماده‌سازی...</p>
      <div class="progress-bar-track"><div class="progress-bar-fill" id="progress-bar-fill" style="width:0%"></div></div>
      <p class="processing-hint" id="progress-text" style="font-size:12px;"></p>
      <button id="btn-cancel-processing" class="btn-secondary" style="margin-top:1rem;">توقف</button>
    `;
    document.getElementById('btn-cancel-processing').onclick = () => {
      pauseActiveImport();
      showScreen('screen-library');
      Library.render();
    };
  }

  function updateStatus(text) { const el = document.getElementById('processing-status'); if (el) el.textContent = text; }
  function updateProgress(cur, tot) {
    const pct = tot > 0 ? Math.round((cur/tot)*100) : 0;
    const f = document.getElementById('progress-bar-fill'); if (f) f.style.width = pct + '%';
    const t = document.getElementById('progress-text'); if (t) t.textContent = `${cur} از ${tot} صفحه (${pct}٪)`;
  }
  function resetProcessingScreen() { document.getElementById('processing-wrap').innerHTML = '<p class="processing-hint">فایل PDF یا TXT خود را انتخاب کنید</p>'; }
  function escHtml(s) { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; }

  return { init, resetProcessingScreen, resumeImport, deleteImportJob, pauseActiveImport, hasActiveImport };
})();
