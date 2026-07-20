const Reader = (() => {
  let currentBook = null;
  let totalColumns = 0;
  let currentColumn = 0;
  let pageWidth = 0;
  let settings = loadSettings();
  let touchStartX = 0, touchStartY = 0;
  let barsVisible = false, barsTimeout = null;
  let coreListenersBound = false;   // جلوگیری از bind شدن چندباره‌ی listenerهای لمسی/کلیک روی wrapper/screen
  let debugTriggerBound = false;    // جلوگیری از bind شدن چندباره‌ی long-press دیباگ

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('reader_settings')) || defaultSettings(); }
    catch (e) { return defaultSettings(); }
  }
  function defaultSettings() {
    return { fontFamily: 'IranSans', fontSize: 18, lineHeight: 1.9, theme: 'sepia' };
  }
  function saveSettings() { localStorage.setItem('reader_settings', JSON.stringify(settings)); }

  // ===== اطمینان از بارگذاری کامل فونت قبل از اندازه‌گیری صفحه‌بندی =====
  // چرا لازم است: فونت‌های ایران‌سنس/وزیرمتن/نسخ از CDN می‌آیند و فایل واقعی‌شان فقط
  // وقتی برای اولین‌بار در همان session لازم شوند دانلود می‌شود. تا قبل از رسیدن فایل،
  // مرورگر متن را با فونت جایگزین (fallback) می‌چیند و scrollWidth را بر همان اساس محاسبه
  // می‌کند. چون عرض حروف فونت جایگزین با فونت واقعی فرق دارد، همین که فونت واقعی برسد
  // یک reflow خاموش (بدون هیچ event قابل گوش‌دادنی که از قبل استفاده می‌کردیم) اتفاق می‌افتد
  // و شکست ستون‌ها را جابه‌جا می‌کند — دقیقاً همان «تعداد خط نامرتب» که می‌بینیم.
  // راه‌حل: قبل از calculateColumns، صریحاً از مرورگر بخواهیم فونت را بارگذاری کند و صبر کنیم.
  function ensureFontsLoaded(fontFamily, fontSize) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve(); // WebView خیلی قدیمی: نادیده بگیر
    const cssFont = FONTS[fontFamily] || FONTS.IranSans;
    const spec = `${fontSize}px ${cssFont}`;
    // یک نمونه متن فارسی واقعی می‌دهیم، نه فقط حروف لاتین پیش‌فرض API؛ چون بعضی فونت‌ها
    // فایل‌شان را بر اساس unicode-range به چند زیرمجموعه (لاتین/عربی-فارسی) تقسیم می‌کنند
    // و اگر فقط با متن لاتین چک کنیم، ممکن است مرورگر بگوید «بارگذاری شد» درحالی‌که فقط
    // زیرمجموعه لاتین آمده، نه زیرمجموعه فارسی که واقعاً استفاده می‌کنیم.
    const sample = 'متن نمونه فارسی برای بارگذاری فونت آزمایش صفحه‌بندی';
    const timeout = new Promise(resolve => setTimeout(resolve, 3000)); // سقف ایمنی: گیر نکنیم اگر افلاین باشیم
    return Promise.race([
      Promise.all([
        document.fonts.load(spec, sample),
        document.fonts.ready
      ]).catch(() => {}),
      timeout
    ]);
  }

  // ===== باز کردن کتاب =====
  async function open(bookId) {
    const book = await LocalStore.getBook(bookId);
    if (!book) { alert('کتاب پیدا نشد'); return; }
    currentBook = book;

    // ساخت inner div برای column layout
    const wrapper = document.getElementById('reader-content');
    wrapper.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'reader-inner';
    inner.id = 'reader-inner';
    inner.innerHTML = book.content || '';
    wrapper.appendChild(inner);
    await Highlights.applyStoredHighlights(inner, book.id);

    applySettings();

    // اول مطمئن شو فونت واقعی (نه فالبک) رسیده، بعد صبر برای layout کامل
    await ensureFontsLoaded(settings.fontFamily, settings.fontSize);
    await waitForLayout(inner);
    calculateColumns(inner, wrapper);

    // رفتن به صفحه آخر خوانده‌شده
    if (book.progress && book.progress > 0 && totalColumns > 1) {
      currentColumn = Math.min(
        Math.round((book.progress / 100) * (totalColumns - 1)),
        totalColumns - 1
      );
    } else {
      currentColumn = 0;
    }
    applyTransform(inner);

    document.getElementById('reader-title').textContent = book.title;
    updateIndicator();
    bindEvents();
    Highlights.bindPopupButton(() => currentBook && currentBook.id);
  }

  // صبر تا layout کامل بشه
  function waitForLayout(inner) {
    return new Promise(resolve => {
      let prev = 0, stable = 0, frame = 0;
      const check = () => {
        frame++;
        const w = inner.scrollWidth;
        if (w > 0 && w === prev) {
          stable++;
          if (stable >= 5) { resolve(); return; }
        } else { stable = 0; prev = w; }
        if (frame >= 120) { resolve(); return; }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  // محاسبه تعداد صفحات از scrollWidth واقعی inner
  // توضیح فرمول (این را عوض نکردم، فقط برای روشن‌شدن کامنت گذاشتم — عدد درست است):
  // هر «صفحه» یک دوره‌ی column-width + column-gap است. چون column-width در CSS برابر
  // calc(100vw - 48px) و column-gap برابر 48px است، دوره‌ی هر صفحه دقیقاً 100vw می‌شود.
  // wrapperW هم برابر 100vw است (چون .reader-content عرضش 100vw است)، پس
  // wrapperW - 24 - 24 + 48 در واقع فقط با یک مسیر ریاضی دیگر به همان wrapperW می‌رسد.
  // یعنی pageWidth === wrapperW === دوره‌ی واقعی هر ستون. عدد درست است، صرفاً گیج‌کننده نوشته شده.
  function calculateColumns(inner, wrapper) {
    const wrapperW = wrapper.getBoundingClientRect().width;
    const PADDING = 24, GAP = 48;
    pageWidth = wrapperW - PADDING - PADDING + GAP;

    const sw = inner.scrollWidth;
    totalColumns = Math.max(1, Math.round(sw / pageWidth));
  }

  // اعمال transform به inner
  function applyTransform(inner, animated) {
    if (!inner) inner = document.getElementById('reader-inner');
    if (!inner) return;
    const offset = currentColumn * pageWidth;
    if (animated) {
      inner.style.transition = 'transform 0.3s ease';
      setTimeout(() => { inner.style.transition = ''; }, 350);
    } else {
      inner.style.transition = '';
    }
    inner.style.transform = `translateX(${offset}px)`;
  }

  // ===== ناوبری =====
  function nextPage() {
    if (currentColumn >= totalColumns - 1) return;
    currentColumn++;
    applyTransform(null, true);
    updateIndicator();
    saveProgress();
  }

  function prevPage() {
    if (currentColumn <= 0) return;
    currentColumn--;
    applyTransform(null, true);
    updateIndicator();
    saveProgress();
  }

  function updateIndicator() {
    const pageStr = `${currentColumn + 1} / ${totalColumns}`;
    const el = document.getElementById('reader-page-indicator');
    if (el) el.textContent = pageStr;
    const fixed = document.getElementById('reader-page-fixed');
    if (fixed) fixed.textContent = pageStr;
  }

  async function saveProgress() {
    if (!currentBook) return;
    const pct = totalColumns > 1 ? Math.round((currentColumn / (totalColumns - 1)) * 100) : 100;
    currentBook.progress = pct;
    await LocalStore.saveBook(currentBook);
  }

  // ===== رویدادها =====
  function bindEvents() {
    const wrapper = document.getElementById('reader-content');
    const screen = document.getElementById('screen-reader');

    // wrapper و screen بین باز/بسته شدن کتاب‌ها از بین نمی‌روند (فقط innerHTML پاک می‌شود)،
    // پس اگر بدون guard دوباره addEventListener کنیم، هر بار یک listener تکراری اضافه می‌شود:
    // کتاب دوم = هر swipe/tap دوبار اجرا می‌شود، کتاب سوم = سه‌بار، و همین‌طور تا آخر session.
    if (!coreListenersBound) {
      wrapper.addEventListener('touchstart', onTouchStart, { passive: true });
      wrapper.addEventListener('touchend', onTouchEnd, { passive: false });
      screen.addEventListener('click', onScreenClick);
      Highlights.bindSelectionChangeWatcher(
        () => document.getElementById('reader-inner'),
        () => currentBook && currentBook.id
      );
      coreListenersBound = true;
    }

    document.getElementById('btn-reader-menu').onclick = (e) => { e.stopPropagation(); hideBars(); showSettingsPanel(); };
    document.getElementById('btn-back-from-reader').onclick = (e) => { e.stopPropagation(); Reader.close(); showScreen('screen-library'); Library.render(); };

    // نکته: قبلاً اینجا addListener('backButton', ...) بود که هر بار باز شدن کتاب
    // ثبت و در close() حذف می‌شد — یعنی بیرون از reader هیچ listener ای نبود و
    // دکمه‌ی فیزیکی برگشت روی صفحه‌های دیگه (تنظیمات، افزودن کتاب) بی‌اثر می‌موند.
    // الان یک listener سراسری تو app.js (یک‌بار، برای کل عمر اپ) این کار رو می‌کنه
    // و وقتی صفحه‌ی فعال reader باشه، همین‌جا Reader.handleBackPress() (پایین) رو صدا می‌زنه.
    bindDebugTrigger();
  }

  // ===== ابزار دیباگ: long-press روی نشانگر صفحه پایین =====
  // چون هیچ USB debugging در دسترس نیست، این یک راه سریع برای گرفتن وضعیت دقیق
  // صفحه‌بندی روی خود گوشی است، بدون نیاز به build جدید برای هر بررسی.
  function bindDebugTrigger() {
    if (debugTriggerBound) return;
    const el = document.getElementById('reader-page-fixed');
    if (!el) return;
    debugTriggerBound = true;
    el.style.pointerEvents = 'auto';
    let pressTimer = null;
    el.addEventListener('touchstart', () => {
      pressTimer = setTimeout(showDebugInfo, 700);
    }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach(evt =>
      el.addEventListener(evt, () => clearTimeout(pressTimer))
    );
  }

  function showDebugInfo() {
    const inner = document.getElementById('reader-inner');
    const wrapper = document.getElementById('reader-content');
    let fontLoaded = 'نامشخص';
    try {
      const spec = `${settings.fontSize}px ${FONTS[settings.fontFamily] || FONTS.IranSans}`;
      fontLoaded = document.fonts.check(spec) ? 'بله' : 'خیر';
    } catch (e) {}
    alert([
      `فونت: ${settings.fontFamily} / ${settings.fontSize}px / خط:${settings.lineHeight}`,
      `فونت واقعی بارگذاری شده: ${fontLoaded}`,
      `document.fonts.status: ${document.fonts ? document.fonts.status : '—'}`,
      `ارتفاع inner: ${inner ? inner.getBoundingClientRect().height.toFixed(1) : '—'}`,
      `ارتفاع wrapper: ${wrapper ? wrapper.getBoundingClientRect().height.toFixed(1) : '—'}`,
      `scrollWidth: ${inner ? inner.scrollWidth : '—'}`,
      `pageWidth: ${pageWidth}`,
      `totalColumns: ${totalColumns}`,
      `currentColumn: ${currentColumn}`
    ].join('\n'));
  }

  function onBackButton() {
    if (Highlights.closeManagePanel()) return;
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') hideSettingsPanel();
    else { Reader.close(); showScreen('screen-library'); Library.render(); }
  }

  function onTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }

  function onTouchEnd(e) {
    const inner = document.getElementById('reader-inner');
    // اگه کاربر داره یه انتخاب متن رو می‌کشه (برای هایلایت)، این نباید ورق‌زدن صفحه
    // حساب بشه — چون انتخاب معمولاً هم یه حرکت افقی داره، وگرنه با چک dx/dy پایین
    // اشتباهی صفحه ورق می‌خورد وسط کشیدن دستگیره‌ی انتخاب.
    if (inner && Highlights.hasActiveSelection(inner)) { Highlights.showPopupForSelection(inner); return; }

    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(dy) > Math.abs(dx) * 0.8 || Math.abs(dx) < 40) {
      // نه swipe واضحی بود — شاید همین الان یه انتخاب متن تازه کامل شده (long-press
      // بدون حرکت افقی معنی‌دار)؛ چک کن و اگه بود پاپ‌آپ رو نشون بده.
      if (inner) Highlights.showPopupForSelection(inner);
      return;
    }
    e.preventDefault();
    if (dx < 0) nextPage();
    else prevPage();
  }

  function onScreenClick(e) {
    if (e.target.closest('#reader-top-bar')) return;
    if (e.target.closest('#highlight-popup')) return; // خودِ دکمه‌ی هایلایت جدا مدیریت می‌شه
    if (e.target.closest('#highlight-manage-panel')) return; // پنل خودش جلوی bubble رو گرفته؛ این فقط بیمه‌ست
    const markEl = e.target.closest('mark.highlight');
    if (markEl) { Highlights.openManagePanel(markEl); return; }
    const inner = document.getElementById('reader-inner');
    if (inner && Highlights.hasActiveSelection(inner)) return; // نباید هم‌زمان صفحه ورق بخوره
    Highlights.hidePopup(); // تپ جای دیگه = بی‌خیال پیشنهاد هایلایت
    if (Highlights.closeManagePanel()) return; // این تپ فقط پنل رو ببنده، ورق نزنه/بار رو toggle نکنه
    const panel = document.getElementById('reader-settings-panel');
    if (panel && panel.style.display !== 'none') { hideSettingsPanel(); return; }
    const w = window.innerWidth, x = e.clientX;
    if (x < w * 0.2) { nextPage(); return; }
    if (x > w * 0.8) { prevPage(); return; }
    toggleBars();
  }

  // ===== نوار بالا =====
  function toggleBars() { if (barsVisible) hideBars(); else showBars(); }
  function showBars() {
    document.getElementById('reader-top-bar')?.classList.add('visible');
    barsVisible = true; clearTimeout(barsTimeout);
    barsTimeout = setTimeout(hideBars, 3000);
  }
  function hideBars() {
    document.getElementById('reader-top-bar')?.classList.remove('visible');
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
    setTimeout(async () => {
      const inner = document.getElementById('reader-inner');
      const wrapper = document.getElementById('reader-content');
      if (inner && wrapper) {
        // موقعیت نسبی (٪) را قبل از recalculation نگه داریم؛ چون فونت/سایز جدید می‌تواند
        // تعداد کل صفحات را عوض کند و currentColumn خام دیگر معنای درستی نداشته باشد
        // (یا حتی از رنج جدید خارج بماند و applyTransform را به بعد از آخرین صفحه ببرد).
        const oldTotal = totalColumns;
        const oldColumn = currentColumn;

        await ensureFontsLoaded(settings.fontFamily, settings.fontSize);
        await waitForLayout(inner);
        calculateColumns(inner, wrapper);

        if (oldTotal > 1) {
          const ratio = oldColumn / (oldTotal - 1);
          currentColumn = Math.round(ratio * (totalColumns - 1));
        }
        currentColumn = Math.max(0, Math.min(currentColumn, totalColumns - 1));

        updateIndicator();
        applyTransform(inner);
      }
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
    // پنل داخل #screen-reader هست که خودش listener کلیک داره (onScreenClick) و همون
    // اولین کاری که می‌کنه اینه: «اگه پنل بازه، ببندش». چون دکمه‌های داخل پنل تا حالا
    // stopPropagation نداشتن، هر تپ روی مثلاً «+» اندازه فونت هم اثر خودش رو می‌ذاشت
    // (فونت بزرگ می‌شد) هم همزمان با bubble شدن به #screen-reader پنل رو می‌بست.
    // این خط جلوی ادامه‌ی bubble رو از مرز پنل به بعد می‌گیره؛ تپ بیرون پنل هنوز طبق
    // معمول می‌بندتش، چون اصلاً وارد پنل نمی‌شه.
    panel.addEventListener('click', (e) => e.stopPropagation());
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
    dark:  { bg:'#1c1a17', text:'#e8e2d4', bar:'rgba(28,26,23,0.96)',    border:'#3a352e', icon:'#e8e2d4' },
    sepia: { bg:'#f4efe4', text:'#3b2f1e', bar:'rgba(237,229,212,0.96)', border:'#c9b99a', icon:'#3b2f1e' },
    light: { bg:'#ffffff', text:'#1a1a18', bar:'rgba(245,245,245,0.96)', border:'#e0e0e0', icon:'#1a1a18' }
  };

  function applySettings() {
    const inner = document.getElementById('reader-inner');
    const wrapper = document.getElementById('reader-content');
    const screen = document.getElementById('screen-reader');
    const theme = THEMES[settings.theme] || THEMES.sepia;

    if (inner) {
      inner.style.fontFamily = FONTS[settings.fontFamily] || FONTS.IranSans;
      inner.style.fontSize   = settings.fontSize + 'px';
      inner.style.lineHeight = settings.lineHeight;
      inner.style.color      = theme.text;
    }
    if (wrapper) wrapper.style.background = theme.bg;
    if (screen)  screen.style.background  = theme.bg;

    const topBar = document.getElementById('reader-top-bar');
    if (topBar) {
      topBar.style.background  = theme.bar;
      topBar.style.borderColor = theme.border;
      topBar.style.color       = theme.icon;
      topBar.querySelectorAll('svg').forEach(s => s.style.stroke = theme.icon);
    }
    const fixed = document.getElementById('reader-page-fixed');
    if (fixed) fixed.style.color = theme.text;
    const panel = document.getElementById('reader-settings-panel');
    if (panel) { panel.style.background=theme.bar; panel.style.color=theme.text; panel.style.borderColor=theme.border; }
  }

  function close() {
    hideSettingsPanel(); hideBars();
    currentBook = null; totalColumns = 0; currentColumn = 0; pageWidth = 0;
    const wrapper = document.getElementById('reader-content');
    const screen  = document.getElementById('screen-reader');
    if (wrapper) { wrapper.innerHTML = ''; wrapper.removeAttribute('style'); }
    if (screen)  screen.removeAttribute('style');
  }

  return { open, close, prevPage, nextPage, handleBackPress: onBackButton };
})();
