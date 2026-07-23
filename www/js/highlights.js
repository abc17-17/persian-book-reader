const Highlights = (() => {
  let popupBound = false;
  let selectionWatcherBound = false;
  let debounceTimer = null;

  // ===== ردیابی و تصحیح جهش لنگرِ انتخاب =====
  // خودِ باگ: موقع کشیدن انتخاب از مرز یه پاراگراف رد می‌شه، «لنگر» (نقطه‌ی شروع
  // واقعیِ انتخاب) گاهی به‌جای اینکه ثابت بمونه، به ابتدای صفحه می‌پره — درحالی‌که
  // «focus» (نقطه‌ی فعلیِ کشیدن) درست ادامه پیدا می‌کنه. تشخیص: تو یک کشیدن پیوسته،
  // لنگر هیچ‌وقت نباید عوض بشه — فقط focus باید حرکت کنه، حالا چه ۱ پاراگراف جلوتر
  // چه ۵ تا. پس لنگرِ واقعیِ شروعِ هر session رو نگه می‌داریم، و اگه selectionchange
  // نشون بده لنگر عوض شده، انتخاب رو با setBaseAndExtent برمی‌گردونیم به همون لنگرِ
  // درست + هر focus فعلی — یعنی کاربر می‌تونه هر چقدر می‌خواد جلو بره (چند پاراگراف،
  // حتی کل صفحه)، فقط جهشِ لنگر تصحیح می‌شه، نه اینکه انتخاب رد بشه.
  let sessionAnchorNode = null;
  let sessionAnchorOffset = 0;

  function watchAndCorrectAnchorDrift(root) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      sessionAnchorNode = null; // انتخاب تموم شد/خالیه — session بعدی از نو شروع می‌شه
      return;
    }
    if (!root.contains(sel.anchorNode)) return; // ربطی به این reader نداره

    // لنگرِ ذخیره‌شده مال کتاب/DOM قبلیه (دیگه تو این root نیست) — از نو شروع کن
    if (sessionAnchorNode && !root.contains(sessionAnchorNode)) sessionAnchorNode = null;

    if (sessionAnchorNode === null) {
      sessionAnchorNode = sel.anchorNode;
      sessionAnchorOffset = sel.anchorOffset;
      return;
    }

    if (sel.anchorNode !== sessionAnchorNode || sel.anchorOffset !== sessionAnchorOffset) {
      const focusNode = sel.focusNode, focusOffset = sel.focusOffset;
      try {
        sel.setBaseAndExtent(sessionAnchorNode, sessionAnchorOffset, focusNode, focusOffset);
      } catch (e) {
        // اگه به هر دلیلی تصحیح ممکن نبود (مثلاً node دیگه معتبر نیست)، تسلیم شو
        // و همین وضعیت فعلی رو به‌عنوان لنگرِ جدید بپذیر — بهتر از throw کردنه.
        sessionAnchorNode = sel.anchorNode;
        sessionAnchorOffset = sel.anchorOffset;
      }
    }
  }

  function generateId() { return 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }
  function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

  // ===== پالتِ رنگ هایلایت — رنگ‌های شارپ و اشباع‌شده، نه پاستلی. yellow پیش‌فرضه —
  // برای هایلایت‌های قدیمی که فیلد color ندارن (یا مقدار قدیمیِ gold رو دارن) هم
  // همین fallback می‌شه (پایین‌تر، applyStoredHighlights + خودِ CSS). =====
  const HIGHLIGHT_COLORS = {
    yellow: '#FDD835',
    blue: '#1E88E5',
    red: '#E53935',
    orange: '#FB8C00',
    purple: '#8E24AA',
    green: '#43A047',
    pink: '#D81B60',
    turquoise: '#00ACC1',
  };
  function swatchesHtml(selectedColor) {
    return Object.entries(HIGHLIGHT_COLORS).map(([key, hex]) =>
      `<button class="color-swatch${key === selectedColor ? ' selected' : ''}" data-color="${key}" style="background:${hex}"></button>`
    ).join('');
  }

  // ===== پنل مدیریت هایلایت — با تپ رو یه <mark> باز می‌شه =====
  // یه هایلایت چندپاراگرافی چند تا <mark> جدا داره (یکی تو هر پاراگراف) که همه یه
  // data-annotation-id مشترک دارن؛ برای عملیات (حذف و بعداً یادداشت/رنگ) همیشه رو
  // همه‌شون با هم کار می‌کنیم، نه فقط اونی که تپ شده.
  function marksFor(annotationId) {
    return [...document.querySelectorAll(`mark.highlight[data-annotation-id="${annotationId}"]`)];
  }

  async function openManagePanel(markEl) {
    closeManagePanel();
    const annotationId = markEl.dataset.annotationId;
    const marks = marksFor(annotationId);
    const excerpt = marks.map(m => m.textContent).join(' ');
    const currentColor = markEl.dataset.color || 'yellow';

    let currentNote = '';
    if (typeof LocalStore !== 'undefined' && LocalStore.getAnnotation) {
      try {
        const ann = await LocalStore.getAnnotation(annotationId);
        if (ann && ann.note) currentNote = ann.note;
      } catch (e) { /* اگه نشد، فقط با یادداشت خالی شروع می‌کنیم */ }
    }

    const panel = document.createElement('div');
    panel.id = 'highlight-manage-panel';
    panel.className = 'bottom-sheet';
    panel.innerHTML = `
      <div class="bs-header">
        <span class="bs-title">هایلایت</span>
        <button class="bs-close" id="hm-close">✕</button>
      </div>
      <div class="details-list">
        <div class="details-row"><span class="details-value">${escHtml(truncate(excerpt, 100))}</span></div>
      </div>
      <div class="color-swatch-row" id="hm-color-row">${swatchesHtml(currentColor)}</div>
      <textarea class="hm-note-input" id="hm-note-input" placeholder="یادداشتی بنویس...">${escHtml(currentNote)}</textarea>
      <button class="menu-item" id="hm-save-note">ذخیره یادداشت</button>
      <button class="menu-item menu-item-danger" id="hm-delete">حذف هایلایت</button>
    `;
    document.getElementById('screen-reader').appendChild(panel);
    panel.addEventListener('click', (e) => e.stopPropagation());

    panel.querySelector('#hm-close').onclick = () => panel.remove();
    panel.querySelector('#hm-color-row').addEventListener('click', async (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      const color = swatch.dataset.color;
      panel.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s === swatch));
      await updateColor(annotationId, color);
    });
    panel.querySelector('#hm-save-note').onclick = async () => {
      const val = panel.querySelector('#hm-note-input').value.trim();
      await updateNote(annotationId, val);
      panel.remove();
    };
    panel.querySelector('#hm-delete').onclick = async () => {
      if (!confirm('این هایلایت حذف بشه؟')) return;
      panel.remove();
      await deleteHighlight(annotationId);
    };

    panel.classList.add('visible');
  }

  function closeManagePanel() {
    const panel = document.getElementById('highlight-manage-panel');
    if (panel) { panel.remove(); return true; }
    return false;
  }

  // ===== تغییرِ رنگ — هم تو LocalStore هم بلافاصله رو خودِ <mark>های DOM، بدون
  // نیاز به بستن/بازکردن کتاب برای دیدن نتیجه =====
  async function updateColor(annotationId, color) {
    if (typeof LocalStore !== 'undefined' && LocalStore.getAnnotation && LocalStore.saveAnnotation) {
      try {
        const ann = await LocalStore.getAnnotation(annotationId);
        if (ann) { ann.color = color; await LocalStore.saveAnnotation(ann); }
      } catch (e) { /* محلیه، به‌ندرت شکست می‌خوره */ }
    }
    marksFor(annotationId).forEach((m) => { m.dataset.color = color; });
  }

  // ===== ذخیره‌ی یادداشت — رکورد کامل رو می‌خونه، فقط note رو عوض می‌کنه، کامل ذخیره
  // می‌کنه. لازمه چون put() تو IndexedDB کل رکورد رو جایگزین می‌کنه، نه فقط یه فیلد —
  // اگه فقط {id, note} بفرستیم، بقیه‌ی فیلدها (bookId, startOffset, excerpt, ...) از
  // بین می‌رن. متنِ خالی یعنی «یادداشت نداره» — نیازی به دکمه‌ی جدای «حذف یادداشت» نیست.
  async function updateNote(annotationId, note) {
    if (typeof LocalStore === 'undefined' || !LocalStore.getAnnotation || !LocalStore.saveAnnotation) return;
    try {
      const ann = await LocalStore.getAnnotation(annotationId);
      if (!ann) return;
      ann.note = note;
      await LocalStore.saveAnnotation(ann);
    } catch (e) { /* محلیه، به‌ندرت شکست می‌خوره */ }
  }

  // ===== حذف — هم از LocalStore هم از DOM (باز کردن <mark> به متن ساده) =====
  async function deleteHighlight(annotationId) {
    if (typeof LocalStore !== 'undefined' && LocalStore.deleteAnnotation) {
      try { await LocalStore.deleteAnnotation(annotationId); } catch (e) { /* محلیه، به‌ندرت شکست می‌خوره */ }
    }
    marksFor(annotationId).forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize(); // ادغام text node های مجاوری که از splitText قبلی مونده بودن
    });
  }

  // ===== تبدیل موقعیت DOM (node, offset) به آفستِ کاراکتری در متنِ خامِ کل root =====
  // چرا لازم است: با تغییر فونت/سایز، مختصات پیکسلی عوض می‌شه ولی خودِ متن عوض نمی‌شه.
  // پس به‌جای مختصات، موقعیت رو به‌صورت «کاراکتر شماره‌ی چند» ذخیره می‌کنیم — پایدار در
  // برابر هر نوع relayout. عمداً هیچ جداکننده‌ای بین پاراگراف‌ها اضافه نمی‌کنیم (نه \n نه
  // فاصله) — چون این تابع فقط برای محاسبه‌ی آفستِ ذخیره‌سازی استفاده می‌شه، نه برای نمایش؛
  // مهم اینه که همیشه یکسان و قابل‌پیش‌بینی باشه، نه که «قشنگ» به‌نظر برسه.
  function getPlainTextOffset(root, targetNode, targetOffset) {
    let count = 0;
    let found = false;
    let result = 0;

    function textLength(node) {
      if (node.nodeType === 3) return node.textContent.length; // TEXT_NODE
      let total = 0;
      for (const child of node.childNodes) total += textLength(child);
      return total;
    }

    function visit(node) {
      if (found) return;
      if (node === targetNode) {
        found = true;
        if (node.nodeType === 3) {
          result = count + targetOffset;
        } else {
          // targetOffset اینجا شماره‌ی فرزند است (مرز انتخاب دقیقاً لبه‌ی یک تگ بوده)،
          // نه کاراکتر — پس فقط تا قبل از همون فرزند رو می‌شماریم.
          let c = count;
          const children = node.childNodes;
          for (let i = 0; i < targetOffset && i < children.length; i++) c += textLength(children[i]);
          result = c;
        }
        return;
      }
      if (node.nodeType === 3) { count += node.textContent.length; return; }
      for (const child of node.childNodes) {
        visit(child);
        if (found) return;
      }
    }

    visit(root);
    return result;
  }

  // ===== خوندن انتخاب فعلی کاربر و تبدیلش به آفست =====
  function getSelectionOffsets(root) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    const text = range.toString();
    if (!text.trim()) return null;
    const start = getPlainTextOffset(root, range.startContainer, range.startOffset);
    const end = getPlainTextOffset(root, range.endContainer, range.endOffset);
    if (end <= start) return null;
    return { start, end, text, range };
  }

  // ===== برعکسِ getPlainTextOffset: از آفستِ کاراکتری، یه Range واقعی می‌سازه =====
  // لازم برای بازتولید هایلایت‌ها هر بار کتاب باز می‌شه (چون innerHTML هر open()
  // از نو ساخته می‌شه و مرجع DOM قبلی از بین رفته). ترتیب پیمایش دقیقاً باید با
  // getPlainTextOffset یکی باشه وگرنه آفست‌ها به موقعیت غلط اشاره می‌کنن.
  function getRangeFromOffsets(root, startOffset, endOffset) {
    let count = 0;
    let startNode = null, startNodeOffset = 0;
    let endNode = null, endNodeOffset = 0;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (startNode === null && count + len >= startOffset) {
        startNode = node;
        startNodeOffset = startOffset - count;
      }
      if (endNode === null && count + len >= endOffset) {
        endNode = node;
        endNodeOffset = endOffset - count;
      }
      count += len;
      if (startNode && endNode) break;
    }
    if (!startNode || !endNode) return null;

    const range = document.createRange();
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
    return range;
  }

  // ===== پیچیدن یک Range تو <mark> — حتی اگه چند پاراگراف/عنصر رو قطع کنه =====
  // range.surroundContents() وقتی انتخاب مرز چند عنصر رو رد کنه خطا می‌ده؛ به‌جاش هر
  // text node ای که با range تلاقی داره رو جدا پیدا می‌کنیم و فقط بخش مشترکش رو می‌پیچیم
  // (splitText). نکته‌ی مهم: چون Range زنده است و splitText می‌تونه مرزهاش رو خودکار
  // جابه‌جا کنه، مقادیر start/end رو قبل از هر تغییری تو متغیر جدا کش می‌کنیم.
  function wrapRangeInMarks(range, annotationId, color = 'yellow') {
    const startContainer = range.startContainer, startOffset = range.startOffset;
    const endContainer = range.endContainer, endOffset = range.endOffset;

    const root = (range.commonAncestorContainer.nodeType === 3)
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    const marks = [];
    // از آخر به اول: split کردن یه node تأثیری رو شناسه‌ی node های قبلی تو آرایه نداره
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const node = textNodes[i];
      const full = node.textContent.length;
      const s = (node === startContainer) ? startOffset : 0;
      const e = (node === endContainer) ? endOffset : full;
      if (s >= e) continue;

      if (e < full) node.splitText(e);
      let toWrap = node;
      if (s > 0) toWrap = node.splitText(s);

      const mark = document.createElement('mark');
      mark.className = 'highlight';
      mark.dataset.annotationId = annotationId;
      mark.dataset.color = color;
      toWrap.parentNode.insertBefore(mark, toWrap);
      mark.appendChild(toWrap);
      marks.unshift(mark);
    }
    return marks;
  }

  // ===== بازتولید هایلایت‌های ذخیره‌شده، هر بار کتاب باز می‌شه =====
  // خودحفاظتی: اگه متنِ بازه‌ی محاسبه‌شده با excerpt ذخیره‌شده یکی نباشه (مثلاً به هر
  // دلیلی محتوا جابه‌جا شده)، اون annotation رد می‌شه به‌جای هایلایتِ متن اشتباه —
  // همون اصلِ needsRepair که تو drive-sync برای کتاب‌های قدیمی استفاده شده.
  async function applyStoredHighlights(root, bookId) {
    if (!root || !bookId || typeof LocalStore === 'undefined' || !LocalStore.getAnnotationsForBook) return;
    let list = [];
    try { list = await LocalStore.getAnnotationsForBook(bookId); } catch (e) { list = []; }
    if (!list || !list.length) return;
    for (const ann of list) {
      const range = getRangeFromOffsets(root, ann.startOffset, ann.endOffset);
      if (!range) continue;
      if (ann.excerpt && range.toString() !== ann.excerpt) continue;
      wrapRangeInMarks(range, ann.id, ann.color || 'yellow');
    }
  }

  // ===== ساخت هایلایت از انتخاب فعلی =====
  async function createFromSelection(root, bookId, color = 'yellow') {
    const sel = getSelectionOffsets(root);
    if (!sel) return null;

    const annotation = {
      id: generateId(),
      bookId,
      startOffset: sel.start,
      endOffset: sel.end,
      excerpt: sel.text,
      note: '',
      color,
      createdAt: Date.now(),
    };

    wrapRangeInMarks(sel.range, annotation.id, color);
    window.getSelection().removeAllRanges();
    await LocalStore.saveAnnotation(annotation);
    return annotation;
  }

  // ===== پاپ‌آپ کوچیک «هایلایت» بالای انتخاب =====
  function showPopupForSelection(root) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hidePopup(); return; }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) { hidePopup(); return; }
    if (!sel.toString().trim()) { hidePopup(); return; }

    const popup = document.getElementById('highlight-popup');
    if (!popup) return;

    const rect = range.getBoundingClientRect();
    const popupW = 180; // تقریبی برای گرید ۸تاییِ رنگ (که حالا می‌شکنه به ۲ ردیف)، فقط برای جلوگیری از بیرون‌زدگی از لبه‌ی صفحه
    let left = rect.left + rect.width / 2 - popupW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popupW - 8));
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(8, rect.top - 46)}px`;
    popup.style.display = 'flex';
  }

  function hidePopup() {
    const popup = document.getElementById('highlight-popup');
    if (popup) popup.style.display = 'none';
  }

  // آیا الان یه انتخاب واقعی (غیرخالی) داخل root هست؟ — reader.js موقع تشخیص swipe
  // ازش استفاده می‌کنه تا کشیدن دستگیره‌ی انتخاب رو با ورق‌زدن صفحه اشتباه نگیره.
  function hasActiveSelection(root) {
    const sel = window.getSelection();
    return !!(sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.toString().trim() && root.contains(sel.getRangeAt(0).commonAncestorContainer));
  }

  // فقط یک‌بار، برای کل عمر اپ — پاپ‌آپ داخل #screen-reader ثابته و بین باز/بسته
  // شدن کتاب‌ها از بین نمی‌ره (مثل بقیه‌ی عناصر ثابت reader)، پس نیاز به guard داره.
  function bindPopupButton(getBookId) {
    if (popupBound) return;
    const popup = document.getElementById('highlight-popup');
    if (!popup) return;
    popupBound = true;
    popup.addEventListener('click', async (e) => {
      e.stopPropagation();
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      const root = document.getElementById('reader-inner');
      if (!root) return;
      await createFromSelection(root, getBookId(), swatch.dataset.color);
      hidePopup();
    });
  }

  // ===== نگهبانِ اصلی — بر پایه‌ی selectionchange، نه touchend =====
  // چرا: وقتی مرورگر خودش long-press رو به‌عنوان «شروع انتخاب متن» تشخیص می‌ده،
  // اون touch sequence رو برای UI نیتیوِ خودش (دستگیره‌ها + منوی Copy/Share) قورت
  // می‌ده — یعنی ممکنه اصلاً touchend عادی به صفحه نرسه (یا touchcancel بیاد جاش).
  // selectionchange برعکس، مستقیماً خودِ «انتخاب عوض شد» رو می‌گه، بی‌ربط به اینکه
  // پشتش چه touch/mouse/keyboard ای بوده — پس مطمئن‌تره.
  // تصحیح لنگر فوریه (بدون debounce، چون هرچی دیرتر، احتمال دیدن جهش تو صفحه بیشتره)؛
  // نمایش پاپ‌آپ debounce داره چون حین کشیدن دستگیره‌ها چندین‌بار پشت‌سرهم fire می‌شه.
  function bindSelectionChangeWatcher(getRoot, getBookId) {
    if (selectionWatcherBound) return;
    selectionWatcherBound = true;
    document.addEventListener('selectionchange', () => {
      const root = getRoot();
      if (root) watchAndCorrectAnchorDrift(root);

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const root2 = getRoot();
        if (root2 && hasActiveSelection(root2)) showPopupForSelection(root2);
        else hidePopup();
      }, 300);
    });
  }

  return {
    getPlainTextOffset,
    getSelectionOffsets,
    getRangeFromOffsets,
    wrapRangeInMarks,
    applyStoredHighlights,
    createFromSelection,
    showPopupForSelection,
    hidePopup,
    hasActiveSelection,
    bindPopupButton,
    bindSelectionChangeWatcher,
    openManagePanel,
    closeManagePanel,
    deleteHighlight,
    updateNote,
    updateColor,
    HIGHLIGHT_COLORS,
  };
})();
