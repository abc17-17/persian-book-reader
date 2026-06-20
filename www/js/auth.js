// auth.js — مدیریت ورود با گوگل (OAuth) با استفاده از پلاگین native (برای کار صحیح در WebView)

const Auth = (() => {

  let accessToken = null;

  // آیا داخل اپ نصب‌شده (Capacitor) هستیم یا توی مرورگر معمولی؟
  function isNativePlatform() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  async function login() {
    if (isNativePlatform()) {
      return loginNative();
    }
    return loginWeb();
  }

  // ===== ورود از طریق پلاگین native (داخل APK) =====
  async function loginNative() {
    const { GoogleAuth } = window.Capacitor.Plugins;

    const user = await GoogleAuth.signIn();
    accessToken = user.authentication.accessToken;

    localStorage.setItem('auth_token', accessToken);
    localStorage.setItem('auth_logged_in', 'true');
    localStorage.setItem('user_name', user.name || '');
    localStorage.setItem('user_picture', user.imageUrl || '');

    updateAvatar(user.name, user.imageUrl);
    return user;
  }

  // ===== ورود از طریق مرورگر معمولی (برای تست در دسکتاپ/مرورگر) =====
  async function loginWeb() {
    const CLIENT_ID = '171444408122-3ov9197blrtdt2jpqma4lg0kp7r3chhh.apps.googleusercontent.com';
    const SCOPES = 'https://www.googleapis.com/auth/drive.file email profile';

    await loadGisScript();

    return new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          accessToken = response.access_token;
          localStorage.setItem('auth_token', accessToken);
          localStorage.setItem('auth_logged_in', 'true');

          const info = await fetchUserInfo();
          resolve(info);
        },
        error_callback: (err) => reject(new Error(err.message || 'ورود لغو شد'))
      });
      tokenClient.requestAccessToken();
    });
  }

  function loadGisScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = () => reject(new Error('بارگذاری سرویس ورود گوگل ناموفق بود.'));
      document.head.appendChild(script);
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
      updateAvatar(data.name, data.picture);
      return data;
    } catch (e) {
      return null;
    }
  }

  function updateAvatar(name, picture) {
    const avatarEl = document.getElementById('user-avatar');
    if (!avatarEl) return;
    if (picture) {
      avatarEl.innerHTML = `<img src="${picture}" alt="${name || ''}" />`;
    } else if (name) {
      avatarEl.textContent = name.charAt(0);
    }
  }

  async function isLoggedIn() {
    const loggedIn = localStorage.getItem('auth_logged_in') === 'true';
    if (!loggedIn) return false;

    accessToken = localStorage.getItem('auth_token');
    updateAvatar(localStorage.getItem('user_name'), localStorage.getItem('user_picture'));
    return true;
  }

  function getAccessToken() {
    return accessToken;
  }

  async function logout() {
    try {
      if (isNativePlatform()) {
        const { GoogleAuth } = window.Capacitor.Plugins;
        await GoogleAuth.signOut();
      }
    } catch (e) {
      // اگر خروج با خطا مواجه شد، همچنان وضعیت محلی را پاک می‌کنیم
    }
    accessToken = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_logged_in');
    localStorage.removeItem('user_name');
    localStorage.removeItem('user_picture');
  }

  return { login, logout, isLoggedIn, getAccessToken };
})();
