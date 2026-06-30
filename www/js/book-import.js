// book-import.js — مدیریت کامل فرآیند افزودن کتاب: انتخاب فایل، پردازش OCR، ذخیره

const BookImport = (() => {

  let cancelled = false;

  function generateId() {
    return 'book_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  // ===== شروع فرآیند: گرفتن فایل از کاربر =====
  function init() {
    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      fileInput.value = ''; // برای اینکه انتخاب دوباره همان فایل هم کار کند

      if (file.name.toLowerCase().endsWith('.pdf')) {
        await handlePdfImport(file);
      } else if (file.name.toLowerCase().endsWith('.txt')) {
        await handleTextImport(file);
      } else {
        alert('فعلاً فقط فایل‌های PDF و TXT پشتیبانی می‌شوند.');
      }
    });
  }

  // ===== مسیر ساده: فایل متنی خام =====
  async function handleTextImport(file) {
    const text = await file.text();
    const title = file.name.replace(/\.txt$/i, '');

    const book = {
      id: generateId(),
      title,
      content: text,
      progress: 0,
      addedAt: Date.now(),
      sourceType: 'txt'
    };

    await LocalStore.saveBook(book);
    showScreen('screen-library');
    Library.render();
  }

  // ===== مسیر اصلی: PDF اسکن‌شده با OCR =====
  async function handlePdfImport(file) {
    if (!OCR.hasApiKey()) {
      alert('برای پردازش PDF ابتدا باید کلید Gemini API را در تنظیمات وارد کنید.');
      showScreen('screen-settings');
      return;
    }

    cancelled = false;
    const title = file.name.replace(/\.pdf$/i, '');
    renderProcessingUI(title);

    try {
      const arrayBuffer = await file.arrayBuffer();
      updateProcessingStatus('در حال باز کردن فایل PDF...');

      const pdf = await PdfProcessor.loadPdf(arrayBuffer);
      const totalPages = pdf.numPages;

      updateProgressBar(0, totalPages);

      const extractedPages = [];
      let failedPages = [];

      for (let i = 1; i <= totalPages; i++) {
        if (cancelled) {
          updateProcessingStatus('پردازش لغو شد.');
          return;
        }

        updateProcessingStatus(`در حال استخراج متن صفحه ${i} از ${totalPages}...`);

        try {
          const { base64, mimeType } = await PdfProcessor.renderPageAsImage(pdf, i);
          const text = await OCR.extractTextFromImage(base64, mimeType);
          extractedPages.push(text);
        } catch (pageErr) {
          // اگر یک صفحه خاص شکست خورد، آن را خالی می‌گذاریم و ادامه می‌دهیم
          extractedPages.push('');
          failedPages.push(i);
        }

        updateProgressBar(i, totalPages);

        // ذخیره موقت پیشرفت هر ۱۰ صفحه، تا در صورت قطع شدن کار، چیزی از دست نرود
        if (i % 10 === 0) {
          await saveDraftProgress(title, extractedPages, totalPages, i);
        }
      }

      updateProcessingStatus('در حال ذخیره‌سازی نهایی...');

      const fullContent = extractedPages.join('\n\n');

      const book = {
        id: generateId(),
        title,
        content: fullContent,
        progress: 0,
        addedAt: Date.now(),
        sourceType: 'pdf-ocr',
        totalPages,
        failedPages
      };

      await LocalStore.saveBook(book);
      await clearDraftProgress(title);

      if (failedPages.length > 0) {
        updateProcessingStatus(
          `پردازش کامل شد. ${failedPages.length} صفحه با مشکل مواجه شدند (صفحات: ${failedPages.join('، ')}). می‌توانید بعداً این کتاب را ویرایش کنید.`
        );
        await sleep(3000);
      }

      showScreen('screen-library');
      Library.render();

    } catch (err) {
      updateProcessingStatus('خطا: ' + err.message);
    }
  }

  // ===== ذخیره موقت برای جلوگیری از از دست رفتن کار در صورت قطعی =====
  async function saveDraftProgress(title, pages, totalPages, currentPage) {
    try {
      await LocalStore.queueForSync({
        type: 'draft_progress',
        title,
        pages: JSON.stringify(pages),
        totalPages,
        currentPage
      });
    } catch (e) {
      // ذخیره موقت اختیاری است؛ شکست آن نباید کل فرآیند را متوقف کند
    }
  }

  async function clearDraftProgress(title) {
    // در نسخه فعلی، صرفاً برای سادگی نادیده گرفته می‌شود
    // (می‌تواند در نسخه‌های بعدی کامل‌تر شود)
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===== رابط کاربری صفحه پردازش =====
  function renderProcessingUI(title) {
    const wrap = document.getElementById('processing-wrap');
    wrap.innerHTML = `
      <div class="processing-icon">📖</div>
      <h3 style="font-size:15px; font-weight:600;">${escapeHtml(title)}</h3>
      <p class="processing-hint" id="processing-status">در حال آماده‌سازی...</p>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="progress-bar-fill" style="width:0%"></div>
      </div>
      <p class="processing-hint" id="progress-text" style="font-size:12px;"></p>
      <button id="btn-cancel-processing" class="btn-secondary" style="margin-top:1rem;">لغو</button>
    `;
    document.getElementById('btn-cancel-processing').addEventListener('click', () => {
      cancelled = true;
    });
  }

  function updateProcessingStatus(text) {
    const el = document.getElementById('processing-status');
    if (el) el.textContent = text;
  }

  function updateProgressBar(current, total) {
    const fillEl = document.getElementById('progress-bar-fill');
    const textEl = document.getElementById('progress-text');
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    if (fillEl) fillEl.style.width = percent + '%';
    if (textEl) textEl.textContent = `${current} از ${total} صفحه (${percent}٪)`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function resetProcessingScreen() {
    const wrap = document.getElementById('processing-wrap');
    wrap.innerHTML = '<p class="processing-hint">فایل PDF یا EPUB خود را انتخاب کنید</p>';
  }

  return { init, resetProcessingScreen };
})();
