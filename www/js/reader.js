const Reader = (() => {
  let currentBook = null;
  let totalColumns = 0;
  let currentColumn = 0;
  let pageWidth = 0; // عرض دقیق هر صفحه
  let settings = loadSettings();
  let touchStartX = 0, touchStartY = 0;
  let barsVisible = false, barsTimeout = null;

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('reader_settings')) || defaultSettings(); }
    catch (e) { return defaultSettings(); }
  }
  function defaultSettings() {
    return { fontFamily: 'IranSans', fontSize: 18, lineHeight: 1.9, theme: 'sepia' };
  }
  function saveSettings() { localStorage.setItem('reader_settings', JSON.stringify(settings)); }

  // ===== باز کردن کتاب =====
  async function open(bookId) {
    const book = await LocalStore.getBook(bookId);
    if (!book) { alert('کتاب پیدا نشد'); return; }
    currentBook = book;
    applySettings();

    const content = document.getElementById('reader-content');
    content.innerHTML = book.content || '';

    // صبر برای layout کامل
    await waitForStableScrollWidth(content);
    calculateColumns();

    if (book.progress && book.progress > 0 && totalColumns > 1) {
      currentColumn = Math.min(
        Math.round((book.progress / 100) * (totalColumns - 1)),
        totalColumns - 1
      );
      const offset = -(currentColumn * pageWidth);
      content.style.transition = '';
      content.style.transform = `translateX(${offset}px)`;
    } else {
      currentColumn = 0;
      content.style.transform = 'translateX(0)';
    }

    // تشخیص: نمایش ۲۰۰ کاراکتر اول محتوای ذخیره‌شده
    const preview = (book.content || '').substring(0, 200);
    alert(`contentLength: ${(book.content||'').length}\nfirst 200 chars:\n${preview}`);

    document.getElementById('reader-title').textContent = book.title;
    updateIndicator();
    bindEvents();
  }

  // صبر تا scrollWidth ثابت بشه — نشونه اینه که layout کامل شده
  function waitForStableScrollWidth(element) {
    return new Promise(resolve => {
      let prev = 0, stable = 0;
      const MAX_FRAMES = 60; // حداکثر 1 ثانیه
      let frame = 0;
      const check = () => {
        frame++;
        const cur = element.scrollWidth;
        if (cur > 0 && cur === prev) {
          stable++;
          if (stable >= 5) { resolve(); return; } // 5 frame ثابت = layout کامل
        } else {
          stable = 0;
          prev = cur;
        }
        if (frame >= MAX_FRAMES) { resolve(); return; } // timeout
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  // ===== محاسبه تعداد صفحات =====
  // با overflow:hidden، scrollWidth = clientWidth و قابل استفاده نیست
  // باید transform رو موقتاً حذف کنیم تا scrollWidth واقعی بگیریم
  function calculateColumns() {
    const content = document.getElementById('reader-content');
    if (!content) return;

    const containerW = content.getBoundingClientRect().width;
    const PADDING = 24;
    const GAP = 48;
    pageWidth = containerW - PADDING - PADDING + GAP;

    // موقتاً transform رو حذف می‌کنیم تا scrollWidth واقعی بگیریم
    const savedTransform = content.style.transform;
    content.style.transform = 'translateX(0)';

    // force reflow
    void content.offsetWidth;

    const sw = content.scrollWidth;
    totalColumns = Math.max(1, Math.round(sw / pageWidth));

    // transform رو برگردون
    content.style.transform = savedTransform;
  }

  // ===== ناوبری =====
  function nextPage() {
    if (currentColumn >= totalColumns - 1) return;
    currentColumn++;
    scrollToColumn(currentColumn);
  }

  function prevPage() {
    if (currentColumn <= 0) return;
    currentColumn--;
    scrollToColumn(currentColumn);
  }

  function scrollToColumn(col) {
    const content = document.getElementById('reader-content');
    if (!content) return;
    // با overflow:hidden دیگه scrollTo کار نمی‌کنه
    // از transform استفاده می‌کنیم
    const offset = -(col * pageWidth);
    content.style.transition = 'transform 0.3s ease';
    content.style.transform = `translateX(${offset}px)`;
    setTimeout(() => { content.style.transition = ''; }, 350);
    updateIndicator();
    saveProgress();
  }

  function updateIndicator() {
    const pageStr = `${currentColumn + 1} / ${totalColumns}`;
    const el = document.getElementById('reader-page-indicator');
    if (el) el.textContent = pageStr;
    const fixed = document.getElementById('reader-page-fixed');
    if (fixed) fixed.textContent = pageStr;
    const prog = document.getElementById('reader-progress-text');
    if (prog) prog.textContent = pageStr;
  }

  async function saveProgress() {
    if (!currentBook) return;
    const pct = totalColumns > 1 ? Math.round((currentColumn / (totalColumns - 1)) * 100) : 100;
    // فقط progress رو آپدیت کن، بدون لمس کردن content
    // (ذخیره کل book با content ممکنه حافظه رو پر کنه یا content رو پاک کنه)
    const bookToSave = {
      id: currentBook.id,
      title: currentBook.title,
      progress: pct,
      addedAt: currentBook.addedAt,
      sourceType: currentBook.sourceType,
      totalPages: currentBook.totalPages,
      failedPages: currentBook.failedPages,
      content: currentBook.content // حفظ content
    };
    currentBook.progress = pct;
    await LocalStore.saveBook(bookToSave);
  }

  // ===== رویدادها =====
  function bindEvents() {
    const content = document.getElementById('reader-content');
    const screen = document.getElementById('screen-reader');

    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchend', onTouchEnd, { passive: false });
    screen.addEventListener('click', onScreenClick);
    document.getElementById('btn-reader-menu').onclick = (e) => { e.stopPropagation(); hideBars(); showSettingsPanel(); };
    document.getElementById('btn-back-from-reader').onclick = (e) => { e.stopPropagation(); Reader.close(); showScreen('screen-library'); Library.render(); };
    document.getElementById('btn-prev-page').onclick = (e) => { e.stopPropagation(); prevPage(); };
    document.getElementById('btn-next-page').onclick = (e) => { e.stopPropagation(); nextPage(); };

    if (window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.addListener('backButton', onBackButton);
    }
  }

  function onBackButton() {
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') hideSettingsPanel();
    else { Reader.close(); showScreen('screen-library'); Library.render(); }
  }

  function onTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }

  function onTouchEnd(e) {
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(dy) > Math.abs(dx) * 0.8 || Math.abs(dx) < 40) return;
    e.preventDefault(); // جلوگیری از scroll طبیعی مرورگر
    if (dx < 0) nextPage();
    else prevPage();
  }

  function onScreenClick(e) {
    if (e.target.closest('#reader-top-bar') || e.target.closest('#reader-bottom-bar')) return;
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') { hideSettingsPanel(); return; }
    const w = window.innerWidth, x = e.clientX;
    if (x < w * 0.2) { nextPage(); return; }
    if (x > w * 0.8) { prevPage(); return; }
    toggleBars();
  }

  // ===== نوارهای بالا/پایین =====
  function toggleBars() { if (barsVisible) hideBars(); else showBars(); }
  function showBars() {
    ['reader-top-bar', 'reader-bottom-bar'].forEach(id => document.getElementById(id)?.classList.add('visible'));
    barsVisible = true;
    clearTimeout(barsTimeout);
    barsTimeout = setTimeout(hideBars, 3000);
  }
  function hideBars() {
    ['reader-top-bar', 'reader-bottom-bar'].forEach(id => document.getElementById(id)?.classList.remove('visible'));
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
    const p = document.getElementById('reader-settings-panel');
    if (p) p.style.display = 'none';
    setTimeout(async () => {
      const content = document.getElementById('reader-content');
      await waitForStableScrollWidth(content);
      calculateColumns();
      updateIndicator();
    }, 100);
  }

  function buildSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'reader-settings-panel';
    panel.className = 'reader-settings-panel';
    panel.innerHTML = `
      <div class="rs-header">
        <span style="font-size:14px;font-weight:600;">تنظیمات نمایش</span>
        <button id="rs-close" style="background:none;border:none;font-size:18px;cursor:pointer;padding:4px 8px;color:inherit;">✕</button>
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
          <button class="rs-btn" id="rs-fd" style="font-size:20px;line-height:1;padding:2px 14px;">−</button>
          <span id="rs-fv" style="min-width:32px;text-align:center;">${settings.fontSize}</span>
          <button class="rs-btn" id="rs-fi" style="font-size:20px;line-height:1;padding:2px 14px;">+</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">فاصله خطوط</span>
        <div class="rs-options">
          <button class="rs-btn" id="rs-ld" style="font-size:20px;line-height:1;padding:2px 14px;">−</button>
          <span id="rs-lv" style="min-width:32px;text-align:center;">${settings.lineHeight.toFixed(1)}</span>
          <button class="rs-btn" id="rs-li" style="font-size:20px;line-height:1;padding:2px 14px;">+</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">تم</span>
        <div class="rs-options">
          <button class="rs-btn theme-btn ${settings.theme==='dark'?'active':''}" data-theme="dark">🌙 تاریک</button>
          <button class="rs-btn theme-btn ${settings.theme==='sepia'?'active':''}" data-theme="sepia">📜 سپیا</button>
          <button class="rs-btn theme-btn ${settings.theme==='light'?'active':''}" data-theme="light">☀️ روشن</button>
        </div>
      </div>`;

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
    const fv = panel.querySelector('#rs-fv');
    panel.querySelector('#rs-fd').onclick = () => { if (settings.fontSize > 12) { settings.fontSize--; fv.textContent = settings.fontSize; applySettings(); saveSettings(); } };
    panel.querySelector('#rs-fi').onclick = () => { if (settings.fontSize < 32) { settings.fontSize++; fv.textContent = settings.fontSize; applySettings(); saveSettings(); } };
    const lv = panel.querySelector('#rs-lv');
    panel.querySelector('#rs-ld').onclick = () => { if (settings.lineHeight > 1.2) { settings.lineHeight = Math.round((settings.lineHeight-0.1)*10)/10; lv.textContent=settings.lineHeight.toFixed(1); applySettings(); saveSettings(); } };
    panel.querySelector('#rs-li').onclick = () => { if (settings.lineHeight < 3.0) { settings.lineHeight = Math.round((settings.lineHeight+0.1)*10)/10; lv.textContent=settings.lineHeight.toFixed(1); applySettings(); saveSettings(); } };
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

  const FONTS = {
    IranSans:  "'Iran Sans','IranSans',Tahoma,sans-serif",
    Vazirmatn: "'Vazirmatn',Tahoma,sans-serif",
    NotoNaskh: "'Noto Naskh Arabic',serif"
  };
  const THEMES = {
    dark:  { bg: '#1c1a17', text: '#e8e2d4', bar: 'rgba(28,26,23,0.96)',    border: '#3a352e', icon: '#e8e2d4' },
    sepia: { bg: '#f4efe4', text: '#3b2f1e', bar: 'rgba(237,229,212,0.96)', border: '#c9b99a', icon: '#3b2f1e' },
    light: { bg: '#ffffff', text: '#1a1a18', bar: 'rgba(245,245,245,0.96)', border: '#e0e0e0', icon: '#1a1a18' }
  };

  function applySettings() {
    const content = document.getElementById('reader-content');
    const screen  = document.getElementById('screen-reader');
    const theme   = THEMES[settings.theme] || THEMES.sepia;
    if (content) {
      content.style.fontFamily = FONTS[settings.fontFamily] || FONTS.IranSans;
      content.style.fontSize   = settings.fontSize + 'px';
      content.style.lineHeight = settings.lineHeight;
      content.style.background = theme.bg;
      content.style.color      = theme.text;
    }
    if (screen) screen.style.background = theme.bg;
    ['reader-top-bar', 'reader-bottom-bar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.background  = theme.bar;
        el.style.borderColor = theme.border;
        el.style.color       = theme.icon;
        el.querySelectorAll('svg').forEach(s => s.style.stroke = theme.icon);
      }
    });
    const fixed = document.getElementById('reader-page-fixed');
    if (fixed) fixed.style.color = theme.text;
    const panel = document.getElementById('reader-settings-panel');
    if (panel) { panel.style.background=theme.bar; panel.style.color=theme.text; panel.style.borderColor=theme.border; }
  }

  function close() {
    hideSettingsPanel(); hideBars();
    if (window.Capacitor?.Plugins?.App) window.Capacitor.Plugins.App.removeAllListeners('backButton');
    currentBook = null; totalColumns = 0; currentColumn = 0; pageWidth = 0; isProgrammaticScroll = false;
    const content = document.getElementById('reader-content');
    const screen = document.getElementById('screen-reader');
    if (content) { content.innerHTML = ''; content.style.transform = ''; content.removeAttribute('style'); }
    if (screen) screen.removeAttribute('style');
  }

  return { open, close, prevPage, nextPage };
})();
