// app.js — مدیریت کلی اپلیکیشن و جابه‌جایی بین صفحات

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// نمایش خطاهای ناگهانی به جای کرش بی‌صدای اپ (مفید برای عیب‌یابی روی گوشی)
window.addEventListener('error', (event) => {
  alert('خطا: ' + (event.message || 'یک خطای ناشناخته رخ داد'));
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = (reason && reason.message) ? reason.message : String(reason);
  alert('خطا: ' + msg);
});

document.addEventListener('DOMContentLoaded', async () => {
  BookImport.init();

  // بررسی اینکه قبلاً کاربر وارد شده یا نه
  const isLoggedIn = await Auth.isLoggedIn();

  if (isLoggedIn) {
    showScreen('screen-library');
    Library.render();
  } else {
    showScreen('screen-login');
  }

  // دکمه ورود با گوگل
  document.getElementById('btn-google-login').addEventListener('click', async () => {
    try {
      await Auth.login();
      showScreen('screen-library');
      Library.render();
    } catch (err) {
      alert('ورود ناموفق بود: ' + err.message);
    }
  });

  // دکمه افزودن کتاب (هدر کتابخانه) — صفحه پردازش را باز و سپس انتخاب‌گر فایل را فعال می‌کند
  document.getElementById('btn-add-book').addEventListener('click', () => {
    BookImport.resetProcessingScreen();
    showScreen('screen-processing');
    document.getElementById('file-input').click();
  });

  document.getElementById('btn-add-book-empty').addEventListener('click', () => {
    BookImport.resetProcessingScreen();
    showScreen('screen-processing');
    document.getElementById('file-input').click();
  });

  // بازگشت از صفحه پردازش
  document.getElementById('btn-back-from-processing').addEventListener('click', () => {
    showScreen('screen-library');
    Library.render();
  });

  // بازگشت از صفحه خوانش
  document.getElementById('btn-back-from-reader').addEventListener('click', () => {
    Reader.close();
    showScreen('screen-library');
    Library.render();
  });

  // دکمه حساب کاربری (فعلاً خروج از حساب)
  document.getElementById('btn-account').addEventListener('click', async () => {
    const confirmed = confirm('خروج از حساب کاربری؟');
    if (confirmed) {
      await Auth.logout();
      showScreen('screen-login');
    }
  });

  // دکمه تنظیمات
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('gemini-key-input').value = OCR.getApiKey();
    document.getElementById('key-saved-msg').textContent = '';
    showScreen('screen-settings');
  });

  document.getElementById('btn-back-from-settings').addEventListener('click', () => {
    showScreen('screen-library');
    Library.render();
  });

  document.getElementById('btn-save-key').addEventListener('click', () => {
    const key = document.getElementById('gemini-key-input').value.trim();
    OCR.saveApiKey(key);
    const msg = document.getElementById('key-saved-msg');
    msg.textContent = key ? 'ذخیره شد ✓' : 'کلید پاک شد';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });
});
