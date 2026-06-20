// app.js — مدیریت کلی اپلیکیشن و جابه‌جایی بین صفحات

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

document.addEventListener('DOMContentLoaded', async () => {
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

  // دکمه افزودن کتاب (هدر کتابخانه)
  document.getElementById('btn-add-book').addEventListener('click', () => {
    showScreen('screen-processing');
  });

  document.getElementById('btn-add-book-empty').addEventListener('click', () => {
    showScreen('screen-processing');
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
});
