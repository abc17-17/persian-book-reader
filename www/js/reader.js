const Reader = (() => {
  let currentBook = null;
  let sections = [];       // هر section یه فصل یا بخش منطقی است
  let currentSection = 0;
  let settings = loadSettings();
  let touchStartX = 0, touchStartY = 0;
  let barsVisible = false, barsTimeout = null;

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('reader_settings')) || defaultSettings(); }
    catch (e) { return defaultSettings(); }
  }
  function defaultSettings() { return { fontFamily: 'IranSans', fontSize: 18, lineHeight: 1.9, theme: 'sepia' }; }
  function saveSettings() { localStorage.setItem('reader_settings', JSON.stringify(settings)); }

  // ===== باز کردن کتاب =====
  async function open(bookId) {
    const book = await LocalStore.getBook(bookId);
    if (!book) { alert('کتاب پیدا نشد'); return; }
    currentBook = book;
    sections = buildSections(book.content || '');
    currentSection = book.progress ? Math.min(Math.floor((book.progress/100)*sections.length), sections.length-1) : 0;
    document.getElementById('reader-title').textContent = book.title;
    applySettings();
    renderSection();
    bindEvents();
  }

  // ===== ساخت بخش‌ها از HTML =====
  // هر h2 شروع یه بخش جدید است
  // اگه کتاب اصلاً h2 نداشت، هر N کاراکتر یه بخش
  function buildSections(html) {
    if (!html.trim()) return [''];

    // parse HTML
    const div = document.createElement('div');
    div.innerHTML = html;
    const nodes = Array.from(div.childNodes);

    // اگه هیچ h2ای نداشتیم → همه رو یه بخش بگیر
    const hasHeadings = div.querySelector('h1, h2') !== null;
    if (!hasHeadings) {
      // تقسیم بر اساس تعداد: هر ۱۵ پاراگراف یه بخش
      const paras = Array.from(div.querySelectorAll('p, aside'));
      if (paras.length === 0) return [html];
      const CHUNK = 15;
      const result = [];
      for (let i = 0; i < paras.length; i += CHUNK) {
        result.push(paras.slice(i, i+CHUNK).map(p => p.outerHTML).join('\n'));
      }
      return result;
    }

    // تقسیم بر اساس h1/h2
    const sections = [];
    let current = [];
    for (const node of nodes) {
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      if ((tag === 'h1' || tag === 'h2') && current.length > 0) {
        sections.push(current.join('\n'));
        current = [];
      }
      if (node.outerHTML) current.push(node.outerHTML);
      else if (node.textContent && node.textContent.trim()) current.push(`<p>${node.textContent.trim()}</p>`);
    }
    if (current.length > 0) sections.push(current.join('\n'));
    return sections.length > 0 ? sections : [html];
  }

  // ===== رندر بخش فعلی =====
  function renderSection() {
    const content = document.getElementById('reader-content');
    content.innerHTML = sections[currentSection] || '';
    content.scrollTop = 0;
    updateIndicator();
    saveProgress();
  }

  function updateIndicator() {
    const el = document.getElementById('reader-page-indicator');
    if (el) el.textContent = `${currentSection+1} / ${sections.length}`;
    const prog = document.getElementById('reader-progress-text');
    if (prog) {
      const pct = sections.length > 1 ? Math.round((currentSection/(sections.length-1))*100) : 100;
      prog.textContent = `${pct}٪ خوانده شده`;
    }
  }

  async function saveProgress() {
    if (!currentBook) return;
    const pct = sections.length > 1 ? Math.round((currentSection/(sections.length-1))*100) : 100;
    currentBook.progress = pct;
    await LocalStore.saveBook(currentBook);
  }

  // ===== ناوبری =====
  function nextPage() {
    if (currentSection < sections.length-1) { currentSection++; renderSection(); animatePage('left'); }
  }
  function prevPage() {
    if (currentSection > 0) { currentSection--; renderSection(); animatePage('right'); }
  }
  function animatePage(dir) {
    const c = document.getElementById('reader-content');
    c.classList.remove('slide-left','slide-right');
    void c.offsetWidth;
    c.classList.add('slide-'+dir);
  }

  // ===== رویدادها =====
  function bindEvents() {
    const content = document.getElementById('reader-content');
    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchend', onTouchEnd, { passive: true });
    content.addEventListener('click', onContentClick);

    document.getElementById('btn-reader-menu').onclick = () => { hideBars(); showSettingsPanel(); };
    document.getElementById('btn-back-from-reader').onclick = () => { Reader.close(); showScreen('screen-library'); Library.render(); };
    document.getElementById('btn-prev-page').onclick = prevPage;
    document.getElementById('btn-next-page').onclick = nextPage;

    if (window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.addListener('backButton', onBackButton);
    }
  }

  function onBackButton() {
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') hideSettingsPanel();
    else { Reader.close(); showScreen('screen-library'); Library.render(); }
  }

  function onTouchStart(e) { touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY; }
  function onTouchEnd(e) {
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(dy) > Math.abs(dx) * 0.8 || Math.abs(dx) < 40) return;
    if (dx < 0) nextPage(); else prevPage();
  }

  function onContentClick(e) {
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') { hideSettingsPanel(); return; }
    const w = window.innerWidth, x = e.clientX;
    if (x < w*0.2) { prevPage(); return; }
    if (x > w*0.8) { nextPage(); return; }
    toggleBars();
  }

  // ===== نوارهای بالا/پایین =====
  function toggleBars() { if (barsVisible) hideBars(); else showBars(); }
  function showBars() {
    ['reader-top-bar','reader-bottom-bar'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.add('visible'); });
    barsVisible = true; clearTimeout(barsTimeout);
    barsTimeout = setTimeout(hideBars, 3000);
  }
  function hideBars() {
    ['reader-top-bar','reader-bottom-bar'].forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('visible'); });
    barsVisible = false; clearTimeout(barsTimeout);
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
    panel.querySelector('#rs-fd').onclick = () => { if(settings.fontSize>12){settings.fontSize--;fv.textContent=settings.fontSize;applySettings();saveSettings();} };
    panel.querySelector('#rs-fi').onclick = () => { if(settings.fontSize<32){settings.fontSize++;fv.textContent=settings.fontSize;applySettings();saveSettings();} };
    const lv = panel.querySelector('#rs-lv');
    panel.querySelector('#rs-ld').onclick = () => { if(settings.lineHeight>1.2){settings.lineHeight=Math.round((settings.lineHeight-0.1)*10)/10;lv.textContent=settings.lineHeight.toFixed(1);applySettings();saveSettings();} };
    panel.querySelector('#rs-li').onclick = () => { if(settings.lineHeight<3.0){settings.lineHeight=Math.round((settings.lineHeight+0.1)*10)/10;lv.textContent=settings.lineHeight.toFixed(1);applySettings();saveSettings();} };
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
  const FONTS = {
    IranSans:  "'Iran Sans','IranSans',Tahoma,sans-serif",
    Vazirmatn: "'Vazirmatn',Tahoma,sans-serif",
    NotoNaskh: "'Noto Naskh Arabic',serif"
  };
  const THEMES = {
    dark:  { bg:'#1c1a17', text:'#e8e2d4', bar:'rgba(28,26,23,0.96)',    border:'#3a352e', icon:'#e8e2d4' },
    sepia: { bg:'#f4efe4', text:'#3b2f1e', bar:'rgba(237,229,212,0.96)', border:'#c9b99a', icon:'#3b2f1e' },
    light: { bg:'#ffffff', text:'#1a1a18', bar:'rgba(245,245,245,0.96)', border:'#e0e0e0', icon:'#1a1a18' }
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
    ['reader-top-bar','reader-bottom-bar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.background  = theme.bar;
        el.style.borderColor = theme.border;
        el.style.color       = theme.icon;
        el.querySelectorAll('svg').forEach(s => s.style.stroke = theme.icon);
      }
    });
    const panel = document.getElementById('reader-settings-panel');
    if (panel) { panel.style.background=theme.bar; panel.style.color=theme.text; panel.style.borderColor=theme.border; }
  }

  // ===== بستن =====
  function close() {
    hideSettingsPanel(); hideBars();
    if (window.Capacitor?.Plugins?.App) window.Capacitor.Plugins.App.removeAllListeners('backButton');
    currentBook = null; sections = []; currentSection = 0;
    const content = document.getElementById('reader-content');
    if (content) { content.innerHTML=''; content.removeAttribute('style'); }
    const screen = document.getElementById('screen-reader');
    if (screen) screen.removeAttribute('style');
  }

  return { open, close, prevPage, nextPage };
})();
