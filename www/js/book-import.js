const BookImport = (() => {
  let cancelled = false;

  function generateId() { return 'book_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); }

  function init() {
    document.getElementById('file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';
      if (file.name.toLowerCase().endsWith('.pdf')) await handlePdfImport(file);
      else if (file.name.toLowerCase().endsWith('.txt')) await handleTextImport(file);
      else alert('فعلاً فقط فایل‌های PDF و TXT پشتیبانی می‌شوند.');
    });
  }

  async function handleTextImport(file) {
    const text = await file.text();
    const title = file.name.replace(/\.txt$/i, '');
    // تبدیل متن خام به HTML ساده
    const html = text.split('\n').filter(l => l.trim()).map(l => `<p>${escHtml(l.trim())}</p>`).join('\n');
    await LocalStore.saveBook({ id: generateId(), title, content: html, progress: 0, addedAt: Date.now(), sourceType: 'txt' });
    showScreen('screen-library');
    Library.render();
  }

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
      updateStatus('در حال باز کردن فایل PDF...');
      const pdf = await PdfProcessor.loadPdf(arrayBuffer);
      const totalPages = pdf.numPages;
      updateProgress(0, totalPages);

      const pages = [];
      const failed = [];

      for (let i = 1; i <= totalPages; i++) {
        if (cancelled) { updateStatus('پردازش لغو شد.'); return; }
        updateStatus(`استخراج متن صفحه ${i} از ${totalPages}...`);
        try {
          const { base64, mimeType } = await PdfProcessor.renderPageAsImage(pdf, i);
          const html = await OCR.extractTextFromImage(base64, mimeType);
          pages.push(html);
        } catch (err) {
          pages.push('');
          failed.push(i);
        }
        updateProgress(i, totalPages);
      }

      updateStatus('در حال ذخیره‌سازی...');
      const fullContent = pages.join('\n');
      await LocalStore.saveBook({ id: generateId(), title, content: fullContent, progress: 0, addedAt: Date.now(), sourceType: 'pdf-ocr', totalPages, failedPages: failed });

      if (failed.length > 0) {
        updateStatus(`پردازش کامل شد. ${failed.length} صفحه با مشکل مواجه شدند.`);
        await new Promise(r => setTimeout(r, 2500));
      }
      showScreen('screen-library');
      Library.render();
    } catch (err) {
      updateStatus('خطا: ' + err.message);
    }
  }

  function renderProcessingUI(title) {
    const wrap = document.getElementById('processing-wrap');
    wrap.innerHTML = `
      <div class="processing-icon">📖</div>
      <h3 style="font-size:15px;font-weight:600;">${escHtml(title)}</h3>
      <p class="processing-hint" id="processing-status">در حال آماده‌سازی...</p>
      <div class="progress-bar-track"><div class="progress-bar-fill" id="progress-bar-fill" style="width:0%"></div></div>
      <p class="processing-hint" id="progress-text" style="font-size:12px;"></p>
      <button id="btn-cancel-processing" class="btn-secondary" style="margin-top:1rem;">لغو</button>
    `;
    document.getElementById('btn-cancel-processing').onclick = () => { cancelled = true; };
  }

  function updateStatus(text) { const el = document.getElementById('processing-status'); if (el) el.textContent = text; }
  function updateProgress(cur, tot) {
    const pct = tot > 0 ? Math.round((cur/tot)*100) : 0;
    const f = document.getElementById('progress-bar-fill'); if (f) f.style.width = pct + '%';
    const t = document.getElementById('progress-text'); if (t) t.textContent = `${cur} از ${tot} صفحه (${pct}٪)`;
  }
  function resetProcessingScreen() { document.getElementById('processing-wrap').innerHTML = '<p class="processing-hint">فایل PDF یا TXT خود را انتخاب کنید</p>'; }
  function escHtml(s) { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; }

  return { init, resetProcessingScreen };
})();
