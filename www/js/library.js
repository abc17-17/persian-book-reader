// library.js — نمایش لیست کتاب‌ها در صفحه کتابخانه

const Library = (() => {

  async function render() {
    const books = await LocalStore.getAllBooks();
    const grid = document.getElementById('library-grid');
    const emptyState = document.getElementById('library-empty');

    if (!books || books.length === 0) {
      grid.style.display = 'none';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';
    grid.style.display = 'grid';
    grid.innerHTML = '';

    // جدیدترین کتاب‌ها اول نمایش داده شوند
    books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    books.forEach(book => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML = `
        <div class="book-cover">
          ${book.coverImage ? `<img src="${book.coverImage}" alt="" />` : `<span>${escapeHtml(book.title)}</span>`}
          <div class="book-progress">
            <div class="book-progress-fill" style="width:${book.progress || 0}%"></div>
          </div>
        </div>
        <div class="book-title">${escapeHtml(book.title)}</div>
      `;
      card.addEventListener('click', () => {
        Reader.open(book.id);
        showScreen('screen-reader');
      });
      grid.appendChild(card);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  return { render };
})();
