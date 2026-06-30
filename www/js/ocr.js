// ocr.js — استخراج متن فارسی از تصاویر صفحات کتاب با استفاده از Gemini API

const OCR = (() => {

  const MODEL = 'gemini-3.1-flash-lite';
  const MAX_RETRIES = 3;

  function getApiKey() {
    return localStorage.getItem('gemini_api_key') || '';
  }

  function saveApiKey(key) {
    localStorage.setItem('gemini_api_key', key);
  }

  function hasApiKey() {
    return !!getApiKey();
  }

  // یک تأخیر ساده برای retry (تا فشار به API کم شود)
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // استخراج متن از یک تصویر (base64، بدون پیشوند data:image)
  async function extractTextFromImage(base64Image, mimeType) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('کلید Gemini API تنظیم نشده است. لطفاً از صفحه تنظیمات وارد کنید.');
    }

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const body = {
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              },
              {
                text: 'این تصویر یک صفحه از یک کتاب فارسی اسکن‌شده است. لطفاً تمام متن فارسی موجود در تصویر را دقیقاً استخراج کن. فقط متن خام را بنویس، بدون توضیح، بدون مارک‌داون، بدون عنوان اضافه. ترتیب خطوط را از راست به چپ حفظ کن. اگر صفحه فقط شامل شماره صفحه یا تصویر بدون متن است، رشته خالی برگردان.'
              }
            ]
          }]
        };

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          }
        );

        const data = await resp.json();

        if (!resp.ok) {
          // اگر خطای محدودیت نرخ بود (429)، کمی صبر کن و دوباره تلاش کن
          if (resp.status === 429 && attempt < MAX_RETRIES) {
            await sleep(attempt * 2000);
            continue;
          }
          throw new Error(data.error?.message || `خطای سرور (کد ${resp.status})`);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return text || '';

      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await sleep(1500);
          continue;
        }
      }
    }

    throw lastError || new Error('استخراج متن پس از چند تلاش ناموفق بود.');
  }

  return { getApiKey, saveApiKey, hasApiKey, extractTextFromImage };
})();
