// reader.js — reader با صفحه‌بندی، swipe، فونت و تنظیمات نمایش

const Reader = (() => {

  let currentBook = null;
  let pages = [];
  let currentPageIndex = 0;
  let settings = loadSettings();
  let touchStartX = 0;
  let touchStartY = 0;
  let barsVisible = false;
  let barsTimeout = null;

  // ===== تنظیمات =====
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem('reader_settings')) || defaultSettings();
    } catch (e) { return defaultSettings(); }
  }

  function defaultSettings() {
    return { fontFamily: 'IranSans', fontSize: 18, lineHeight: 2.0, theme: 'dark' };
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
    currentPageIndex = book.progress
      ? Math.min(Math.floor((book.progress / 100) * pages.length), pages.length - 1)
      : 0;

    document.getElementById('reader-title').textContent = book.title;
    applySettings();
    renderPage();
    bindEvents();
  }

  // ===== ساخت صفحات از متن =====
  function buildPages(content) {
    // اتصال خطوط کوتاه به هم برای ساخت پاراگراف واقعی
    const rawLines = content.split('\n');
    const paragraphs = [];
    let current = '';

    for (let line of rawLines) {
      line = line.trim();
      if (!line) {
        if (current) { paragraphs.push(current); current = ''; }
        continue;
      }
      // اگه خط قبلی داریم و خط فعلی به نظر ادامه‌ی جمله‌ست، وصلشون کن
      if (current) {
        const lastChar = current[current.length - 1];
        const endsWithPunct = '.!?؟،؛:'.includes(lastChar);
        if (!endsWithPunct && line.length > 0) {
          current += ' ' + line;
        } else {
          paragraphs.push(current);
          current = line;
        }
      } else {
        current = line;
      }
    }
    if (current) paragraphs.push(current);

    // تقسیم پاراگراف‌ها به صفحات — بر اساس تعداد کاراکتر نه فقط تعداد پاراگراف
    const CHARS_PER_PAGE = 600;
    const result = [];
    let pageParas = [];
    let pageChars = 0;

    for (const para of paragraphs) {
      pageParas.push(para);
      pageChars += para.length;
      if (pageChars >= CHARS_PER_PAGE) {
        result.push(pageParas);
        pageParas = [];
        pageChars = 0;
      }
    }
    if (pageParas.length > 0) result.push(pageParas);

    return result.length > 0 ? result : [['']];
  }

  // ===== رندر صفحه =====
  function renderPage() {
    const content = document.getElementById('reader-content');
    const pageParas = pages[currentPageIndex] || [];
    content.innerHTML = pageParas.map(p => `<p>${escapeHtml(p)}</p>`).join('');
    content.scrollTop = 0;
    updatePageIndicator();
    saveProgress();
  }

  function updatePageIndicator() {
    const el = document.getElementById('reader-page-indicator');
    if (el) el.textContent = `${currentPageIndex + 1} / ${pages.length}`;
    const prog = document.getElementById('reader-progress-text');
    if (prog) {
      const pct = pages.length > 1 ? Math.round((currentPageIndex / (pages.length - 1)) * 100) : 100;
      prog.textContent = `${pct}٪ خوانده شده`;
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

  function animatePage(dir) {
    const content = document.getElementById('reader-content');
    content.classList.remove('slide-left', 'slide-right');
    void content.offsetWidth;
    content.classList.add('slide-' + dir);
  }

  // ===== رویدادها =====
  function bindEvents() {
    const content = document.getElementById('reader-content');
    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchend', onTouchEnd, { passive: true });
    content.addEventListener('click', onContentClick);

    document.getElementById('btn-reader-menu').onclick = () => {
      hideBars();
      showSettingsPanel();
    };

    // دکمه Back فیزیکی اندروید
    document.addEventListener('backbutton', onBackButton, false);
  }

  function onBackButton(e) {
    e.preventDefault();
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') {
      hideSettingsPanel();
    } else {
      Reader.close();
      showScreen('screen-library');
      Library.render();
    }
  }

  function onTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }

  function onTouchEnd(e) {
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(dx) < Math.abs(dy) * 1.5 || Math.abs(dx) < 40) return;
    if (dx < 0) nextPage();
    else prevPage();
  }

  function onContentClick(e) {
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') {
      hideSettingsPanel();
      return;
    }
    toggleBars();
  }

  // ===== نوارهای بالا و پایین =====
  function toggleBars() {
    if (barsVisible) hideBars();
    else showBars();
  }

  function showBars() {
    const top = document.getElementById('reader-top-bar');
    const bot = document.getElementById('reader-bottom-bar');
    if (top) top.classList.add('visible');
    if (bot) bot.classList.add('visible');
    barsVisible = true;
    clearTimeout(barsTimeout);
    barsTimeout = setTimeout(hideBars, 3000);
  }

  function hideBars() {
    const top = document.getElementById('reader-top-bar');
    const bot = document.getElementById('reader-bottom-bar');
    if (top) top.classList.remove('visible');
    if (bot) bot.classList.remove('visible');
    barsVisible = false;
    clearTimeout(barsTimeout);
  }

  // ===== پانل تنظیمات =====
  function showSettingsPanel() {
    let panel = document.getElementById('reader-settings-panel');
    if (!panel) panel = buildSettingsPanel();
    panel.style.display = 'flex';
  }

  function hideSettingsPanel() {
    const panel = document.getElementById('reader-settings-panel');
    if (panel) panel.style.display = 'none';
  }

  function buildSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'reader-settings-panel';
    panel.className = 'reader-settings-panel';
    panel.innerHTML = `
      <div class="rs-header">
        <span style="font-size:14px;font-weight:600;">تنظیمات نمایش</span>
        <button id="rs-close" class="icon-btn" style="width:32px;height:32px;">✕</button>
      </div>
      <div class="rs-row">
        <span class="rs-label">فونت</span>
        <div class="rs-options">
          <button class="rs-btn font-btn ${settings.fontFamily==='IranSans'?'active':''}" data-font="IranSans" style="font-family:'Iran Sans'">ایران‌سنس</button>
          <button class="rs-btn font-btn ${settings.fontFamily==='Vazirmatn'?'active':''}" data-font="Vazirmatn" style="font-family:'Vazirmatn'">وزیرمتن</button>
          <button class="rs-btn font-btn ${settings.fontFamily==='NotoNaskh'?'active':''}" data-font="NotoNaskh" style="font-family:'Noto Naskh Arabic'">نسخ</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">اندازه</span>
        <div class="rs-options">
          <button class="rs-btn" id="rs-font-dec" style="font-size:18px;padding:4px 14px;">−</button>
          <span id="rs-font-size-val" style="min-width:32px;text-align:center">${settings.fontSize}</span>
          <button class="rs-btn" id="rs-font-inc" style="font-size:18px;padding:4px 14px;">+</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">فاصله خطوط</span>
        <div class="rs-options">
          <button class="rs-btn" id="rs-lh-dec" style="font-size:18px;padding:4px 14px;">−</button>
          <span id="rs-lh-val" style="min-width:32px;text-align:center">${settings.lineHeight.toFixed(1)}</span>
          <button class="rs-btn" id="rs-lh-inc" style="font-size:18px;padding:4px 14px;">+</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">تم</span>
        <div class="rs-options">
          <button class="rs-btn theme-btn ${settings.theme==='dark'?'active':''}" data-theme="dark">🌙 تاریک</button>
          <button class="rs-btn theme-btn ${settings.theme==='sepia'?'active':''}" data-theme="sepia">📜 سپیا</button>
          <button class="rs-btn theme-btn ${settings.theme==='light'?'active':''}" data-theme="light">☀️ روشن</button>
        </div>
      </div>
    `;

    document.getElementById('screen-reader').appendChild(panel);

    panel.querySelector('#rs-close').onclick = hideSettingsPanel;

    panel.querySelectorAll('.font-btn').forEach(btn => {
      btn.onclick = () => {
        settings.fontFamily = btn.dataset.font;
        panel.querySelectorAll('.font-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applySettings(); saveSettings();
      };
    });

    panel.querySelector('#rs-font-dec').onclick = () => {
      if (settings.fontSize > 12) { settings.fontSize--; panel.querySelector('#rs-font-size-val').textContent = settings.fontSize; applySettings(); saveSettings(); }
    };
    panel.querySelector('#rs-font-inc').onclick = () => {
      if (settings.fontSize < 32) { settings.fontSize++; panel.querySelector('#rs-font-size-val').textContent = settings.fontSize; applySettings(); saveSettings(); }
    };
    panel.querySelector('#rs-lh-dec').onclick = () => {
      if (settings.lineHeight > 1.2) { settings.lineHeight = Math.round((settings.lineHeight-0.1)*10)/10; panel.querySelector('#rs-lh-val').textContent = settings.lineHeight.toFixed(1); applySettings(); saveSettings(); }
    };
    panel.querySelector('#rs-lh-inc').onclick = () => {
      if (settings.lineHeight < 3.0) { settings.lineHeight = Math.round((settings.lineHeight+0.1)*10)/10; panel.querySelector('#rs-lh-val').textContent = settings.lineHeight.toFixed(1); applySettings(); saveSettings(); }
    };

    panel.querySelectorAll('.theme-btn').forEach(btn => {
      btn.onclick = () => {
        settings.theme = btn.dataset.theme;
        panel.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applySettings(); saveSettings();
      };
    });

    return panel;
  }

  // ===== اعمال تنظیمات =====
  const FONT_MAP = {
    IranSans:   "'Iran Sans', 'IranSans', Tahoma, sans-serif",
    Vazirmatn:  "'Vazirmatn', Tahoma, sans-serif",
    NotoNaskh:  "'Noto Naskh Arabic', serif"
  };

  const THEMES = {
    dark:  { bg:'#1c1a17', text:'#e8e2d4', bar:'rgba(28,26,23,0.95)', border:'#3a352e' },
    sepia: { bg:'#f4efe4', text:'#3b2f1e', bar:'rgba(244,239,228,0.95)', border:'#c9b99a' },
    light: { bg:'#ffffff', text:'#1a1a18', bar:'rgba(255,255,255,0.95)', border:'#e0e0e0' }
  };

  function applySettings() {
    const content = document.getElementById('reader-content');
    const screen  = document.getElementById('screen-reader');
    const theme   = THEMES[settings.theme] || THEMES.dark;

    if (content) {
      content.style.fontFamily  = FONT_MAP[settings.fontFamily] || FONT_MAP.IranSans;
      content.style.fontSize    = settings.fontSize + 'px';
      content.style.lineHeight  = settings.lineHeight;
      content.style.background  = theme.bg;
      content.style.color       = theme.text;
    }
    if (screen) screen.style.background = theme.bg;

    ['reader-top-bar','reader-bottom-bar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.background   = theme.bar;
        el.style.borderColor  = theme.border;
        el.style.color        = theme.text;
      }
    });
  }

  // ===== بستن reader =====
  function close() {
    hideSettingsPanel();
    hideBars();
    document.removeEventListener('backbutton', onBackButton, false);
    currentBook = null;
    pages = [];
    currentPageIndex = 0;
    const content = document.getElementById('reader-content');
    if (content) {
      const fresh = content.cloneNode(false);
      content.parentNode.replaceChild(fresh, content);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  return { open, close, prevPage, nextPage };
})();
