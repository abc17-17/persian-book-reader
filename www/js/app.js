function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

window.addEventListener('error', (e) => alert('خطا: ' + (e.message || 'خطای ناشناخته')));
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason);
  alert('خطا: ' + msg);
});

document.addEventListener('DOMContentLoaded', async () => {
  BookImport.init();

  const isLoggedIn = await Auth.isLoggedIn();
  if (isLoggedIn) { showScreen('screen-library'); Library.render(); }
  else showScreen('screen-login');

  // ===== ورود با گوگل =====
  document.getElementById('btn-google-login').addEventListener('click', async () => {
    try {
      await Auth.login();
      showScreen('screen-library');
      Library.render();
    } catch (err) {
      alert('ورود ناموفق بود: ' + err.message);
    }
  });

  // ===== کتابخانه =====
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

  document.getElementById('btn-back-from-processing').addEventListener('click', () => {
    showScreen('screen-library');
    Library.render();
  });

  document.getElementById('btn-account').addEventListener('click', async () => {
    if (confirm('خروج از حساب کاربری؟')) {
      await Auth.logout();
      showScreen('screen-login');
    }
  });

  // ===== تنظیمات =====
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('gemini-key-input').value = OCR.getApiKey();
    document.getElementById('key-saved-msg').textContent = '';
    showScreen('screen-settings');
  });

  document.getElementById('btn-back-from-settings').addEventListener('click', () => {
    showScreen('screen-library');
    Library.render();
  });

  // اعتبارسنجی و ذخیره API key (کد تو)
  document.getElementById('btn-save-key').addEventListener('click', async () => {
    const key = document.getElementById('gemini-key-input').value.trim();
    const msg = document.getElementById('key-saved-msg');

    if (!key) {
      OCR.saveApiKey('');
      msg.textContent = 'کلید پاک شد';
      msg.style.color = 'inherit';
      setTimeout(() => { msg.textContent = ''; }, 2000);
      return;
    }

    msg.textContent = 'در حال بررسی اعتبار...';
    msg.style.color = 'var(--text-dim)';

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (response.ok) {
        OCR.saveApiKey(key);
        msg.textContent = 'کلید معتبر است و ذخیره شد ✓';
        msg.style.color = '#4caf50';
      } else {
        msg.textContent = '❌ کلید نامعتبر است';
        msg.style.color = '#f44336';
      }
    } catch (error) {
      msg.textContent = '❌ خطا در ارتباط با سرور';
      msg.style.color = '#f44336';
    }

    setTimeout(() => { msg.textContent = ''; msg.style.color = 'inherit'; }, 3000);
  });

  // ===== reader =====
  document.getElementById('btn-back-from-reader').addEventListener('click', () => {
    Reader.close();
    showScreen('screen-library');
    Library.render();
  });

  document.getElementById('btn-prev-page').addEventListener('click', () => Reader.prevPage());
  document.getElementById('btn-next-page').addEventListener('click', () => Reader.nextPage());
});
