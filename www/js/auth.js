// auth.js — مدیریت ورود با گوگل (OAuth) و دسترسی به گوگل درایو

const Auth = (() => {

  // ⚠️ این مقدار را با Client ID که از Google Cloud Console گرفتید جایگزین کنید
  const CLIENT_ID = '171444408122-3ov9197blrtdt2jpqma4lg0kp7r3chhh.apps.googleusercontent.com';

  // دسترسی‌هایی که از کاربر می‌خواهیم:
  // - drive.file: فقط به فایل‌هایی که خودِ این اپ می‌سازد دسترسی دارد (امن‌ترین حالت)
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;

  function loadGisScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = () => reject(new Error('بارگذاری سرویس ورود گوگل ناموفق بود. اتصال اینترنت را بررسی کنید.'));
      document.head.appendChild(script);
    });
  }

  async function login() {
    await loadGisScript();

    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          accessToken = response.access_token;
          tokenExpiry = Date.now() + (response.expires_in * 1000);

          // ذخیره توکن و وضعیت ورود برای دفعات بعد
          localStorage.setItem('auth_token', accessToken);
          localStorage.setItem('auth_token_expiry', String(tokenExpiry));
          localStorage.setItem('auth_logged_in', 'true');

          fetchUserInfo().then(resolve).catch(resolve);
        },
        error_callback: (err) => {
          reject(new Error(err.message || 'ورود لغو شد'));
        }
      });

      tokenClient.requestAccessToken();
    });
  }

  async function fetchUserInfo() {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      localStorage.setItem('user_name', data.name || '');
      localStorage.setItem('user_picture', data.picture || '');

      const avatarEl = document.getElementById('user-avatar');
      if (avatarEl) {
        if (data.picture) {
          avatarEl.innerHTML = `<img src="${data.picture}" alt="${data.name}" />`;
        } else if (data.name) {
          avatarEl.textContent = data.name.charAt(0);
        }
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  async function isLoggedIn() {
    const loggedIn = localStorage.getItem('auth_logged_in') === 'true';
    if (!loggedIn) return false;

    const storedToken = localStorage.getItem('auth_token');
    const storedExpiry = Number(localStorage.getItem('auth_token_expiry') || 0);

    if (storedToken && Date.now() < storedExpiry) {
      accessToken = storedToken;
      tokenExpiry = storedExpiry;
      // به‌روزرسانی آواتار از مقادیر ذخیره‌شده
      const avatarEl = document.getElementById('user-avatar');
      const picture = localStorage.getItem('user_picture');
      const name = localStorage.getItem('user_name');
      if (avatarEl && picture) {
        avatarEl.innerHTML = `<img src="${picture}" alt="${name}" />`;
      } else if (avatarEl && name) {
        avatarEl.textContent = name.charAt(0);
      }
      return true;
    }

    // توکن منقضی شده — تلاش برای دریافت توکن جدید بدون نمایش پنجره ورود
    return false;
  }

  function getAccessToken() {
    return accessToken;
  }

  async function logout() {
    if (accessToken) {
      try {
        google.accounts.oauth2.revoke(accessToken, () => {});
      } catch (e) {}
    }
    accessToken = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_token_expiry');
    localStorage.removeItem('auth_logged_in');
    localStorage.removeItem('user_name');
    localStorage.removeItem('user_picture');
  }

  return { login, logout, isLoggedIn, getAccessToken };
})();
