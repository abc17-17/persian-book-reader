const Library = (() => {
  async function render() {
    const books = await LocalStore.getAllBooks();
    const grid = document.getElementById('library-grid');
    const empty = document.getElementById('library-empty');
    if (!books || books.length === 0) { grid.style.display='none'; empty.style.display='flex'; return; }
    empty.style.display='none'; grid.style.display='grid'; grid.innerHTML='';
    books.sort((a,b) => (b.addedAt||0)-(a.addedAt||0));
    books.forEach(book => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML = `
        <div class="book-cover">
          <span>${esc(book.title)}</span>
          <div class="book-progress"><div class="book-progress-fill" style="width:${book.progress||0}%"></div></div>
        </div>
        <div class="book-title">${esc(book.title)}</div>`;
      card.addEventListener('click', () => { Reader.open(book.id); showScreen('screen-reader'); });
      grid.appendChild(card);
    });
  }
  function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
  return { render };
})();
