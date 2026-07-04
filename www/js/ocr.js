const OCR = (() => {
  const MODEL = 'gemini-3.1-flash-lite';
  const MAX_RETRIES = 3;

  const PROMPT = `این تصویر یک صفحه از یک کتاب فارسی اسکن‌شده است.
وظیفه تو: استخراج متن و تبدیل به HTML ساختارمند.

قوانین اجباری:
- پاراگراف‌های معمولی → <p>متن</p>
- سرفصل فصل یا بخش → <h2>عنوان</h2>
- عنوان اصلی کتاب (فقط در صفحه عنوان) → <h1>عنوان</h1>
- پانویس‌ها → <aside>متن پانویس</aside>
- شماره صفحه، سرصفحه تکراری، هدر ناشر → حذف کن
- اگر صفحه فقط تصویر یا کاملاً خالی است → فقط بنویس: <!-- blank -->
- هیچ توضیح، مارک‌داون، کد بلاک، یا متن خارج از تگ‌ها اضافه نکن
- فقط همان متنی که در تصویر هست را بنویس، چیزی از خودت اضافه نکن
- خروجی باید فقط تگ‌های HTML خام باشد`;

  function getApiKey() { return localStorage.getItem('gemini_api_key') || ''; }
  function saveApiKey(key) { localStorage.setItem('gemini_api_key', key); }
  function hasApiKey() { return !!getApiKey(); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isValidOutput(text) {
    if (!text || !text.trim()) return false;
    const t = text.trim();
    if (t === '<!-- blank -->') return true;
    return t.includes('<') && t.length >= 10;
  }

  function cleanOutput(text) {
    if (!text) return '';
    let c = text.trim();
    c = c.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');
    const first = c.indexOf('<');
    if (first > 0) c = c.substring(first);
    return c.trim();
  }

  async function extractTextFromImage(base64Image, mimeType) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('کلید Gemini API تنظیم نشده است. لطفاً از صفحه تنظیمات وارد کنید.');
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const body = {
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType, data: base64Image } },
            { text: PROMPT }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
        };

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        const data = await resp.json();

        if (!resp.ok) {
          if (resp.status === 429 && attempt < MAX_RETRIES) { await sleep(attempt * 3000); continue; }
          throw new Error(data.error?.message || `خطای سرور (کد ${resp.status})`);
        }

        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = cleanOutput(raw);

        if (!isValidOutput(cleaned) && attempt < MAX_RETRIES) { await sleep(1500); continue; }
        if (cleaned === '<!-- blank -->') return '';
        return cleaned;

      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) { await sleep(1500 * attempt); continue; }
      }
    }
    throw lastError || new Error('استخراج متن پس از چند تلاش ناموفق بود.');
  }

  return { getApiKey, saveApiKey, hasApiKey, extractTextFromImage };
})();
