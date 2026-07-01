// reader.js — نسخه اصلاح‌شده

const Reader = (() => {

  let currentBook = null;
  let pages = [];
  let currentPageIndex = 0;
  let settings = loadSettings();
  let touchStartX = 0;
  let touchStartY = 0;
  let barsVisible = false;
  let barsTimeout = null;

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('reader_settings')) || defaultSettings(); }
    catch (e) { return defaultSettings(); }
  }

  function defaultSettings() {
    return { fontFamily: 'IranSans', fontSize: 18, lineHeight: 2.0, theme: 'sepia' };
  }

  function saveSettings() {
    localStorage.setItem('reader_settings', JSON.stringify(settings));
  }

  // ===== باز کردن کتاب =====
  async function open(bookId) {
    const book = await LocalStore.getBook(bookId);
    if (!book) { alert('کتاب پیدا نشد'); return; }

    currentBook = book;

    // اول محتوا رو رندر کن، بعد بر اساس ارتفاع واقعی صفحه‌بندی کن
    applySettings();

    // ساخت پاراگراف‌ها
    const paragraphs = buildParagraphs(book.content || '');

    // صفحه‌بندی بر اساس ارتفاع واقعی
    pages = paginateByHeight(paragraphs);

    currentPageIndex = book.progress
      ? Math.min(Math.floor((book.progress / 100) * pages.length), pages.length - 1)
      : 0;

    document.getElementById('reader-title').textContent = book.title;
    renderPage();
    bindEvents();
  }

  // ===== ساخت پاراگراف‌ها از متن خام =====
  function buildParagraphs(content) {
    const rawLines = content.split('\n');
    const paragraphs = [];
    let current = '';

    for (let line of rawLines) {
      line = line.trim();
      if (!line) {
        if (current) { paragraphs.push(current); current = ''; }
        continue;
      }
      if (current) {
        const lastChar = current[current.length - 1];
        const endsWithPunct = '.!?؟،؛:».«'.includes(lastChar);
        if (!endsWithPunct) {
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
    return paragraphs.length > 0 ? paragraphs : [''];
  }

  // ===== صفحه‌بندی بر اساس ارتفاع واقعی =====
  function paginateByHeight(paragraphs) {
    const content = document.getElementById('reader-content');
    const availableHeight = content.clientHeight - 80; // فضای امن

    // یه div مخفی برای اندازه‌گیری می‌سازیم
    const measurer = document.createElement('div');
    measurer.style.cssText = `
      position: absolute;
      visibility: hidden;
      width: ${content.clientWidth - 40}px;
      font-family: ${content.style.fontFamily || 'inherit'};
      font-size: ${settings.fontSize}px;
      line-height: ${settings.lineHeight};
      direction: rtl;
      padding: 0;
    `;
    document.body.appendChild(measurer);

    const result = [];
    let pageParas = [];
    let pageHeight = 0;

    for (const para of paragraphs) {
      // اندازه این پاراگراف رو بسنج
      const p = document.createElement('p');
      p.style.marginBottom = '0.8em';
      p.textContent = para;
      measurer.appendChild(p);
      const paraHeight = p.offsetHeight + (settings.fontSize * settings.lineHeight * 0.8);
      measurer.removeChild(p);

      if (pageParas.length > 0 && pageHeight + paraHeight > availableHeight) {
        result.push(pageParas);
        pageParas = [para];
        pageHeight = paraHeight;
      } else {
        pageParas.push(para);
        pageHeight += paraHeight;
      }
    }

    if (pageParas.length > 0) result.push(pageParas);
    document.body.removeChild(measurer);

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
      const pct = pages.length > 1
        ? Math.round((currentPageIndex / (pages.length - 1)) * 100)
        : 100;
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

    document.getElementById('btn-back-from-reader').onclick = () => {
      Reader.close();
      showScreen('screen-library');
      Library.render();
    };

    document.getElementById('btn-prev-page').onclick = prevPage;
    document.getElementById('btn-next-page').onclick = nextPage;

    // Back button فیزیکی اندروید — با Capacitor App plugin
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('backButton', onBackButton);
    }
  }

  function onBackButton() {
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
    // اگه حرکت عمودی بیشتر از افقی بود، نادیده بگیر
    if (Math.abs(dy) > Math.abs(dx) * 0.8) return;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) nextPage();
    else prevPage();
  }

  function onContentClick(e) {
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') {
      hideSettingsPanel();
      return;
    }

    // لمس لبه‌ها برای تغییر صفحه
    const w = window.innerWidth;
    const x = e.clientX;
    if (x < w * 0.2) { prevPage(); return; }
    if (x > w * 0.8) { nextPage(); return; }

    // لمس وسط: نمایش/مخفی کردن نوارها
    toggleBars();
  }

  // ===== نوارهای بالا و پایین =====
  function toggleBars() {
    if (barsVisible) hideBars();
    else showBars();
  }

  function showBars() {
    ['reader-top-bar','reader-bottom-bar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('visible');
    });
    barsVisible = true;
    clearTimeout(barsTimeout);
    barsTimeout = setTimeout(hideBars, 3000);
  }

  function hideBars() {
    ['reader-top-bar','reader-bottom-bar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('visible');
    });
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
          <button class="rs-btn" id="rs-font-dec" style="font-size:20px;line-height:1;padding:2px 14px;">−</button>
          <span id="rs-font-size-val" style="min-width:32px;text-align:center;font-size:14px;">${settings.fontSize}</span>
          <button class="rs-btn" id="rs-font-inc" style="font-size:20px;line-height:1;padding:2px 14px;">+</button>
        </div>
      </div>
      <div class="rs-row">
        <span class="rs-label">فاصله خطوط</span>
        <div class="rs-options">
          <button class="rs-btn" id="rs-lh-dec" style="font-size:20px;line-height:1;padding:2px 14px;">−</button>
          <span id="rs-lh-val" style="min-width:32px;text-align:center;font-size:14px;">${settings.lineHeight.toFixed(1)}</span>
          <button class="rs-btn" id="rs-lh-inc" style="font-size:20px;line-height:1;padding:2px 14px;">+</button>
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

    panel.querySelector('#rs-close').onclick = () => {
      hideSettingsPanel();
      // بعد از بستن تنظیمات، صفحه‌بندی رو دوباره محاسبه کن
      repaginate();
    };

    panel.querySelectorAll('.font-btn').forEach(btn => {
      btn.onclick = () => {
        settings.fontFamily = btn.dataset.font;
        panel.querySelectorAll('.font-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applySettings(); saveSettings();
      };
    });

    const fontDecBtn = panel.querySelector('#rs-font-dec');
    const fontIncBtn = panel.querySelector('#rs-font-inc');
    const fontVal = panel.querySelector('#rs-font-size-val');
    fontDecBtn.onclick = () => {
      if (settings.fontSize > 12) { settings.fontSize--; fontVal.textContent = settings.fontSize; applySettings(); saveSettings(); }
    };
    fontIncBtn.onclick = () => {
      if (settings.fontSize < 32) { settings.fontSize++; fontVal.textContent = settings.fontSize; applySettings(); saveSettings(); }
    };

    const lhDecBtn = panel.querySelector('#rs-lh-dec');
    const lhIncBtn = panel.querySelector('#rs-lh-inc');
    const lhVal = panel.querySelector('#rs-lh-val');
    lhDecBtn.onclick = () => {
      if (settings.lineHeight > 1.2) { settings.lineHeight = Math.round((settings.lineHeight-0.1)*10)/10; lhVal.textContent = settings.lineHeight.toFixed(1); applySettings(); saveSettings(); }
    };
    lhIncBtn.onclick = () => {
      if (settings.lineHeight < 3.0) { settings.lineHeight = Math.round((settings.lineHeight+0.1)*10)/10; lhVal.textContent = settings.lineHeight.toFixed(1); applySettings(); saveSettings(); }
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

  function repaginate() {
    if (!currentBook) return;
    const paragraphs = buildParagraphs(currentBook.content || '');
    const newPages = paginateByHeight(paragraphs);
    // نگه داشتن موقعیت نسبی
    const ratio = pages.length > 1 ? currentPageIndex / (pages.length - 1) : 0;
    pages = newPages;
    currentPageIndex = Math.min(Math.floor(ratio * pages.length), pages.length - 1);
    renderPage();
  }

  // ===== اعمال تنظیمات =====
  const FONT_MAP = {
    IranSans:  "'Iran Sans', 'IranSans', Tahoma, sans-serif",
    Vazirmatn: "'Vazirmatn', Tahoma, sans-serif",
    NotoNaskh: "'Noto Naskh Arabic', serif"
  };

  const THEMES = {
    dark:  { bg:'#1c1a17', text:'#e8e2d4', bar:'rgba(28,26,23,0.96)',   border:'#3a352e', iconColor:'#e8e2d4' },
    sepia: { bg:'#f4efe4', text:'#3b2f1e', bar:'rgba(237,229,212,0.96)', border:'#c9b99a', iconColor:'#3b2f1e' },
    light: { bg:'#ffffff', text:'#1a1a18', bar:'rgba(245,245,245,0.96)', border:'#e0e0e0', iconColor:'#1a1a18' }
  };

  function applySettings() {
    const content = document.getElementById('reader-content');
    const screen  = document.getElementById('screen-reader');
    const theme   = THEMES[settings.theme] || THEMES.sepia;

    if (content) {
      content.style.fontFamily = FONT_MAP[settings.fontFamily] || FONT_MAP.IranSans;
      content.style.fontSize   = settings.fontSize + 'px';
      content.style.lineHeight = settings.lineHeight;
      content.style.background = theme.bg;
      content.style.color      = theme.text;
    }
    if (screen) screen.style.background = theme.bg;

    ['reader-top-bar','reader-bottom-bar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.background  = theme.bar;
        el.style.borderColor = theme.border;
        el.style.color       = theme.iconColor;
        // رنگ SVG آیکون‌ها
        el.querySelectorAll('svg').forEach(svg => {
          svg.style.stroke = theme.iconColor;
        });
      }
    });

    // پانل تنظیمات
    const panel = document.getElementById('reader-settings-panel');
    if (panel) {
      panel.style.background = theme.bar;
      panel.style.color      = theme.text;
      panel.style.borderColor = theme.border;
    }
  }

  // ===== بستن reader =====
  function close() {
    hideSettingsPanel();
    hideBars();

    // حذف listener دکمه Back
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.removeAllListeners('backButton');
    }

    currentBook = null;
    pages = [];
    currentPageIndex = 0;

    const content = document.getElementById('reader-content');
    if (content) {
      content.removeEventListener('touchstart', onTouchStart);
      content.removeEventListener('touchend', onTouchEnd);
      content.removeEventListener('click', onContentClick);
      content.innerHTML = '';
      content.removeAttribute('style');
    }

    const screen = document.getElementById('screen-reader');
    if (screen) screen.removeAttribute('style');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  return { open, close, prevPage, nextPage };
})();
