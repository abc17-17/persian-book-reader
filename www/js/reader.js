// reader.js — نمایش محتوای کتاب و مدیریت هایلایت/یادداشت
// نسخه فعلی: اسکلت پایه. قابلیت‌های هایلایت و یادداشت در مرحله بعد اضافه می‌شود.

const Reader = (() => {

  let currentBookId = null;

  async function open(bookId) {
    currentBookId = bookId;
    const book = await LocalStore.getBook(bookId);
    if (!book) {
      alert('کتاب پیدا نشد');
      return;
    }

    document.getElementById('reader-title').textContent = book.title;
    document.getElementById('reader-content').innerHTML =
      `<p>${book.content ? escapeHtml(book.content).replace(/\n/g, '</p><p>') : 'محتوای این کتاب هنوز آماده نشده است.'}</p>`;
  }

  function close() {
    currentBookId = null;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  return { open, close };
})();
