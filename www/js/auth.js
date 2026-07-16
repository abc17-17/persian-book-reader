const Auth = (() => {
  let accessToken = null;
  let googleAuthInitialized = false;
  const WEB_CLIENT_ID = '171444408122-3ov9197blrtdt2jpqma4lg0kp7r3chhh.apps.googleusercontent.com';

  function isNativePlatform() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // پلاگین GoogleAuth قبل از signIn() یا signOut() باید initialize بشه، وگرنه
  // GoogleSignInClient داخلی‌ش null می‌مونه و signOut() با NullPointerException کرش می‌کنه.
  // قبلاً initialize() فقط داخل loginNative() صدا زده می‌شد — یعنی اگه کاربر از یه
  // session قبلی از قبل لاگین بود (isLoggedIn() این‌بار true برگردونده بدون این‌که
  // loginNative() اجرا بشه) و مستقیم خروج می‌زد، signOut() به یه پلاگین initialize-نشده
  // می‌رسید و کرش می‌کرد. این تابع idempotent‌ه (با flag)، هرجا لازم باشه صداش می‌زنیم.
  async function ensureGoogleAuthInitialized() {
    if (googleAuthInitialized) return;
    if (!isNativePlatform() || !window.Capacitor?.Plugins?.GoogleAuth) return;
    await window.Capacitor.Plugins.GoogleAuth.initialize({
      clientId: WEB_CLIENT_ID,
      scopes: ['email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
      grantOfflineAccess: true
    });
    googleAuthInitialized = true;
  }

  async function login() {
    if (isNativePlatform()) return loginNative();
    return loginWeb();
  }

  async function loginNative() {
    if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.GoogleAuth) {
      throw new Error('پلاگین GoogleAuth در دسترس نیست');
    }
    await ensureGoogleAuthInitialized();
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

  async function loginWeb() {
    await loadGisScript();
    return new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: WEB_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file email profile',
        callback: async (response) => {
          if (response.error) { reject(new Error(response.error)); return; }
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
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      localStorage.setItem('user_name', data.name || '');
      localStorage.setItem('user_picture', data.picture || '');
      updateAvatar(data.name, data.picture);
      return data;
    } catch (e) { return null; }
  }

  function updateAvatar(name, picture) {
    const el = document.getElementById('user-avatar');
    if (!el) return;
    if (picture) el.innerHTML = `<img src="${picture}" alt="${name||''}" />`;
    else if (name) el.textContent = name.charAt(0);
  }

  async function isLoggedIn() {
    if (localStorage.getItem('auth_logged_in') !== 'true') return false;
    accessToken = localStorage.getItem('auth_token');
    updateAvatar(localStorage.getItem('user_name'), localStorage.getItem('user_picture'));
    // best-effort: اگه شکست خورد لاگین محلی رو نگه می‌داریم، فقط بعداً signOut ممکنه دوباره تلاش کنه
    try { await ensureGoogleAuthInitialized(); } catch (e) {}
    return true;
  }

  function getAccessToken() { return accessToken; }

  async function logout() {
    try {
      if (isNativePlatform() && window.Capacitor.Plugins.GoogleAuth) {
        await ensureGoogleAuthInitialized();
        await window.Capacitor.Plugins.GoogleAuth.signOut();
      }
    } catch (e) {}
    accessToken = null;
    ['auth_token','auth_logged_in','user_name','user_picture','drive_folder_id'].forEach(k => localStorage.removeItem(k));
  }

  return { login, logout, isLoggedIn, getAccessToken };
})();
