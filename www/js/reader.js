// reader.js — reader کامل با صفحه‌بندی، swipe، فونت و تنظیمات نمایش

const Reader = (() => {

  let currentBook = null;
  let pages = [];
  let currentPageIndex = 0;
  let settings = loadSettings();
  let touchStartX = 0;
  let touchStartY = 0;
  let settingsVisible = false;

  // ===== تنظیمات پیش‌فرض =====
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem('reader_settings')) || defaultSettings();
    } catch (e) {
      return defaultSettings();
    }
  }

  function defaultSettings() {
    return {
      fontFamily: 'IranSans',
      fontSize: 18,
      lineHeight: 2.0,
      theme: 'dark'
    };
  }

  function saveSettings() {
    localStorage.setItem('reader_settings', JSON.stringify(settings));
  }

  // ===== باز کردن کتاب =====
  async function open(bookId) {
    const book = await LocalStore.getBook(bookId);
    if (!book) { alert('کتاب پیدا نشد'); return; }

    currentBook = book;
    pages = buildPages(book.content || '');
    currentPageIndex = book.progress ? Math.floor((book.progress / 100) * pages.length) : 0;
    if (currentPageIndex >= pages.length) currentPageIndex = 0;

    document.getElementById('reader-title').textContent = book.title;
    applySettings();
    renderPage();
    bindEvents();
  }

  // ===== ساخت صفحات از متن خام =====
  // هر پاراگراف (خط غیرخالی) یه واحده؛ هر N پاراگراف یه صفحه
  function buildPages(content) {
    const paragraphs = content
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const PARAS_PER_PAGE = 8;
    const result = [];
    for (let i = 0; i < paragraphs.length; i += PARAS_PER_PAGE) {
      result.push(paragraphs.slice(i, i + PARAS_PER_PAGE));
    }
    return result.length > 0 ? result : [['']];
  }

  // ===== رندر صفحه فعلی =====
  function renderPage() {
    const content = document.getElementById('reader-content');
    const pageParas = pages[currentPageIndex] || [];

    content.innerHTML = pageParas
      .map(p => `<p>${escapeHtml(p)}</p>`)
      .join('');

    updatePageIndicator();
    saveProgress();
  }

  function updatePageIndicator() {
    const el = document.getElementById('reader-page-indicator');
    if (el) {
      el.textContent = `${currentPageIndex + 1} / ${pages.length}`;
    }
  }

  async function saveProgress() {
    if (!currentBook) return;
    const progress = pages.length > 1
      ? Math.round((currentPageIndex / (pages.length - 1)) * 100)
      : 100;
    currentBook.progress = progress;
    await LocalStore.saveBook(currentBook);
  }

  // ===== ناوبری =====
  function nextPage() {
    if (currentPageIndex < pages.length - 1) {
      currentPageIndex++;
      renderPage();
      animatePage('left');
    }
  }

  function prevPage() {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      renderPage();
      animatePage('right');
    }
  }

  function animatePage(direction) {
    const content = document.getElementById('reader-content');
    content.classList.remove('slide-left', 'slide-right');
    void content.offsetWidth;
    content.classList.add('slide-' + direction);
  }

  // ===== رویدادها =====
  function bindEvents() {
    const content = document.getElementById('reader-content');

    // swipe
    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchend', onTouchEnd, { passive: true });

    // کلیک روی لبه‌ها
    content.addEventListener('click', onContentClick);

    // دکمه تنظیمات
    const menuBtn = document.getElementById('btn-reader-menu');
    if (menuBtn) {
      menuBtn.onclick = toggleSettings;
    }
  }

  function onTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }

  function onTouchEnd(e) {
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // اسکرول عمودی نباشه
    if (Math.abs(dx) < 40) return; // swipe کوتاه نباشه

    if (dx < 0) nextPage();  // swipe به چپ = صفحه بعد
    else prevPage();           // swipe به راست = صفحه قبل
  }

  function onContentClick(e) {
    const w = window.innerWidth;
    const x = e.clientX;
    if (x < w * 0.25) prevPage();
    else if (x > w * 0.75) nextPage();
    else toggleSettings();
  }

  // ===== پانل تنظیمات =====
  function toggleSettings() {
    if (settingsVisible) hideSettings();
    else showSettings();
  }

  function showSettings() {
    let panel = document.getElementById('reader-settings-panel');
    if (!panel) {
      panel = buildSettingsPanel();
      document.getElementById('screen-reader').appendChild(panel);
    }
    panel.style.display = 'flex';
    settingsVisible = true;
  }

  function hideSettings() {
    const panel = document.getElementById('reader-settings-panel');
    if (panel) panel.style.display = 'none';
    settingsVisible = false;
  }

  function buildSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'reader-settings-panel';
    panel.className = 'reader-settings-panel';
    panel.innerHTML = `
      <div class="rs-row">
        <span class="rs-label">فونت</span>
        <div class="rs-options">
          <button class="rs-btn font-btn ${settings.fontFamily === 'IranSans' ? 'active' : ''}"
            data-font="IranSans" style="font-family:'Iran Sans'">ایران‌سنس</button>
          <button class="rs-btn font-btn ${settings.fontFamily === 'Vazirmatn' ? 'active' : ''}"
            data-font="Vazirmatn" style="font-family:'Vazirmatn'">وزیرمتن</button>
          <button class="rs-btn font-btn ${settings.fontFamily === 'NotoNaskh' ? 'active' : ''}"
            data-font="NotoNaskh" style="font-family:'Noto Naskh Arabic'">نسخ</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">اندازه متن</span>
        <div class="rs-options">
          <button class="rs-btn" id="rs-font-dec">-</button>
          <span id="rs-font-size-val" style="min-width:36px;text-align:center">${settings.fontSize}</span>
          <button class="rs-btn" id="rs-font-inc">+</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">فاصله خطوط</span>
        <div class="rs-options">
          <button class="rs-btn" id="rs-lh-dec">-</button>
          <span id="rs-lh-val" style="min-width:36px;text-align:center">${settings.lineHeight.toFixed(1)}</span>
          <button class="rs-btn" id="rs-lh-inc">+</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">تم</span>
        <div class="rs-options">
          <button class="rs-btn theme-btn ${settings.theme === 'dark' ? 'active' : ''}" data-theme="dark">تاریک</button>
          <button class="rs-btn theme-btn ${settings.theme === 'sepia' ? 'active' : ''}" data-theme="sepia">سپیا</button>
          <button class="rs-btn theme-btn ${settings.theme === 'light' ? 'active' : ''}" data-theme="light">روشن</button>
        </div>
      </div>
    `;

    // فونت
    panel.querySelectorAll('.font-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.fontFamily = btn.dataset.font;
        panel.querySelectorAll('.font-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applySettings();
        saveSettings();
      });
    });

    // اندازه فونت
    panel.querySelector('#rs-font-dec').addEventListener('click', () => {
      if (settings.fontSize > 12) {
        settings.fontSize -= 1;
        panel.querySelector('#rs-font-size-val').textContent = settings.fontSize;
        applySettings(); saveSettings();
      }
    });
    panel.querySelector('#rs-font-inc').addEventListener('click', () => {
      if (settings.fontSize < 32) {
        settings.fontSize += 1;
        panel.querySelector('#rs-font-size-val').textContent = settings.fontSize;
        applySettings(); saveSettings();
      }
    });

    // فاصله خطوط
    panel.querySelector('#rs-lh-dec').addEventListener('click', () => {
      if (settings.lineHeight > 1.2) {
        settings.lineHeight = Math.round((settings.lineHeight - 0.1) * 10) / 10;
        panel.querySelector('#rs-lh-val').textContent = settings.lineHeight.toFixed(1);
        applySettings(); saveSettings();
      }
    });
    panel.querySelector('#rs-lh-inc').addEventListener('click', () => {
      if (settings.lineHeight < 3.0) {
        settings.lineHeight = Math.round((settings.lineHeight + 0.1) * 10) / 10;
        panel.querySelector('#rs-lh-val').textContent = settings.lineHeight.toFixed(1);
        applySettings(); saveSettings();
      }
    });

    // تم
    panel.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.theme = btn.dataset.theme;
        panel.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applySettings(); saveSettings();
      });
    });

    return panel;
  }

  // ===== اعمال تنظیمات روی reader =====
  const FONT_MAP = {
    IranSans: "'Iran Sans', 'IranSans', Tahoma, sans-serif",
    Vazirmatn: "'Vazirmatn', Tahoma, sans-serif",
    NotoNaskh: "'Noto Naskh Arabic', serif"
  };

  const THEMES = {
    dark:  { bg: '#1c1a17', text: '#e8e2d4', topbar: '#1c1a17', border: '#3a352e' },
    sepia: { bg: '#f4efe4', text: '#3b2f1e', topbar: '#ede5d4', border: '#c9b99a' },
    light: { bg: '#ffffff', text: '#1a1a18', topbar: '#f5f5f5', border: '#e0e0e0' }
  };

  function applySettings() {
    const content = document.getElementById('reader-content');
    const screen = document.getElementById('screen-reader');
    const topbar = screen ? screen.querySelector('.reader-topbar') : null;
    const theme = THEMES[settings.theme] || THEMES.dark;

    if (content) {
      content.style.fontFamily = FONT_MAP[settings.fontFamily] || FONT_MAP.IranSans;
      content.style.fontSize = settings.fontSize + 'px';
      content.style.lineHeight = settings.lineHeight;
      content.style.background = theme.bg;
      content.style.color = theme.text;
    }

    if (screen) {
      screen.style.background = theme.bg;
    }

    if (topbar) {
      topbar.style.background = theme.topbar;
      topbar.style.borderColor = theme.border;
      topbar.style.color = theme.text;
    }
  }

  // ===== بستن reader =====
  function close() {
    hideSettings();
    currentBook = null;
    pages = [];
    currentPageIndex = 0;
    settingsVisible = false;
    // پاک کردن event listener ها
    const content = document.getElementById('reader-content');
    if (content) {
      const newContent = content.cloneNode(false);
      content.parentNode.replaceChild(newContent, content);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  return { open, close };
})();
