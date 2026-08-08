const OCR = (() => {
  const MODEL = 'gemini-3.1-flash-lite';
  const MAX_RETRIES = 3;

  const PROMPT = `این تصویر یک صفحه از یک کتاب فارسی اسکن‌شده است.
وظیفه تو: استخراج متن و تبدیل به HTML ساختارمند.

قوانین اجباری:
- پاراگراف‌های معمولی → <p>متن</p>
- سرفصل فصل یا بخش → <h2>عنوان</h2>
- عنوان اصلی کتاب (فقط در صفحه‌ی عنوانِ داخلی با زمینه‌ی ساده‌ی متنی — نه جلدِ گرافیکی) → <h1>عنوان</h1>
- ارجاعِ پانویس در متنِ اصلی → با <sup class="fnref" data-fn="MARKER">MARKER</sup> علامت بزن، دقیقاً همان‌جا که چاپ شده. MARKER همان علامتِ چاپ‌شده است، بدون هیچ تغییری: عددِ فارسی یا لاتین (با یا بدونِ کروشه/پرانتز، چه به‌شکلِ سوپراسکریپتِ کوچک چه هم‌ردیفِ متن)، یا نمادهای ستاره/دوشاخه/دوشاخه‌ی‌دوبل/سکشن (* † ‡ §) و تکرارشان (** ††). تشخیصِ ارجاع از یک عددِ معمولیِ وسطِ جمله (مثل سال یا شماره‌ی یک لیست): ارجاع بی‌فاصله بلافاصله بعدِ یک کلمه می‌چسبد و معمولاً کوچک‌تر/بالاترِ خطِ متن است؛ یک عددِ مستقل با فاصله‌ی طبیعیِ قبل و بعدش ارجاع نیست، دست‌نخورده و بدونِ تگ به‌عنوانِ متنِ عادی بمان.
- متنِ کاملِ پانویس → فقط وقتی متنِ کاملِ یک پانویس همین صفحه چاپ شده باشد: <aside class="fnbody" data-fn="MARKER">متن پانویس</aside>، با MARKER دقیقاً همان علامتِ ارجاعِ متناظرش در متنِ اصلیِ همین صفحه (یکسان و بدون تغییر). جای دقیقِ این تگ در خروجیِ همین صفحه مهم نیست. اگر ارجاعی هست ولی متنِ پانویسش روی همین صفحه چاپ نشده (یادداشتِ پایانی/انتهای فصل)، فقط <sup class="fnref">...</sup> را در متنِ اصلی نگه‌دار و هیچ <aside class="fnbody">ای برایش نساز — هیچ‌وقت محتوای پانویس را حدس نزن یا از خودت نساز.
- جلد یا پشتِ‌جلدِ گرافیکیِ کتاب (طرحِ هنری همراه با نامِ مجموعه/ناشر/بارکد/ISBN، یا فقط عنوان و نامِ نویسنده روی زمینه‌ی تصویری) → فقط بنویس: <!-- blank -->
- اگر بخشی از متن به خطی غیر از فارسی/عربی است (مثلاً سیریلیک یا لاتین) → دقیقاً همان متن را به همان خط کپی کن؛ هیچ‌وقت تلفظش را به خطِ فارسی/عربی برنگردان و هیچ‌وقت ترجمه‌ش نکن
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
