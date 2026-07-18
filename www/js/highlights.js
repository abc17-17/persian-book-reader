const Highlights = (() => {
  let popupBound = false;
  let selectionWatcherBound = false;
  let debounceTimer = null;

  function generateId() { return 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }

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

  // ===== پیچیدن یک Range تو <mark> — حتی اگه چند پاراگراف/عنصر رو قطع کنه =====
  // range.surroundContents() وقتی انتخاب مرز چند عنصر رو رد کنه خطا می‌ده؛ به‌جاش هر
  // text node ای که با range تلاقی داره رو جدا پیدا می‌کنیم و فقط بخش مشترکش رو می‌پیچیم
  // (splitText). نکته‌ی مهم: چون Range زنده است و splitText می‌تونه مرزهاش رو خودکار
  // جابه‌جا کنه، مقادیر start/end رو قبل از هر تغییری تو متغیر جدا کش می‌کنیم.
  function wrapRangeInMarks(range, annotationId) {
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
      toWrap.parentNode.insertBefore(mark, toWrap);
      mark.appendChild(toWrap);
      marks.unshift(mark);
    }
    return marks;
  }

  // ===== ساخت هایلایت از انتخاب فعلی =====
  async function createFromSelection(root, bookId) {
    const sel = getSelectionOffsets(root);
    if (!sel) return null;

    const annotation = {
      id: generateId(),
      bookId,
      startOffset: sel.start,
      endOffset: sel.end,
      excerpt: sel.text,
      note: '',
      createdAt: Date.now(),
    };

    wrapRangeInMarks(sel.range, annotation.id);
    window.getSelection().removeAllRanges();
    await LocalStore.saveAnnotation(annotation);
    return annotation;
  }

  // ===== پاپ‌آپ کوچیک «هایلایت» بالای انتخاب =====
  function showPopupForSelection(root) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hidePopup(); return; }
    if (!root.contains(sel.getRangeAt(0).commonAncestorContainer)) { hidePopup(); return; }
    if (!sel.toString().trim()) { hidePopup(); return; }

    const popup = document.getElementById('highlight-popup');
    if (!popup) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const popupW = 90; // تقریبی، فقط برای جلوگیری از بیرون‌زدگی از لبه‌ی صفحه
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

  // فقط یک‌بار، برای کل عمر اپ — دکمه‌ی پاپ‌آپ داخل #screen-reader ثابته و بین باز/بسته
  // شدن کتاب‌ها از بین نمی‌ره (مثل بقیه‌ی عناصر ثابت reader)، پس نیاز به guard داره.
  function bindPopupButton(getBookId) {
    if (popupBound) return;
    const btn = document.getElementById('btn-create-highlight');
    if (!btn) return;
    popupBound = true;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const root = document.getElementById('reader-inner');
      if (!root) return;
      await createFromSelection(root, getBookId());
      hidePopup();
    });
  }

  // ===== نگهبانِ اصلی نمایش پاپ‌آپ — بر پایه‌ی selectionchange، نه touchend =====
  // چرا: وقتی مرورگر خودش long-press رو به‌عنوان «شروع انتخاب متن» تشخیص می‌ده،
  // اون touch sequence رو برای UI نیتیوِ خودش (دستگیره‌ها + منوی Copy/Share) قورت
  // می‌ده — یعنی ممکنه اصلاً touchend عادی به صفحه نرسه (یا touchcancel بیاد جاش).
  // selectionchange برعکس، مستقیماً خودِ «انتخاب عوض شد» رو می‌گه، بی‌ربط به اینکه
  // پشتش چه touch/mouse/keyboard ای بوده — پس مطمئن‌تره. debounce چون ممکنه حین
  // کشیدن دستگیره‌ها چندین‌بار پشت‌سرهم fire بشه.
  function bindSelectionChangeWatcher(getRoot, getBookId) {
    if (selectionWatcherBound) return;
    selectionWatcherBound = true;
    document.addEventListener('selectionchange', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const root = getRoot();
        if (root && hasActiveSelection(root)) showPopupForSelection(root);
        else hidePopup();
      }, 300);
    });
  }

  return {
    getPlainTextOffset,
    getSelectionOffsets,
    wrapRangeInMarks,
    createFromSelection,
    showPopupForSelection,
    hidePopup,
    hasActiveSelection,
    bindPopupButton,
    bindSelectionChangeWatcher,
  };
})();
