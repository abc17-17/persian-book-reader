const PdfProcessor = (() => {
  let pdfJsLoaded = false;

  function loadPdfJs() {
    if (pdfJsLoaded && window.pdfjsLib) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'libs/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
        pdfJsLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('بارگذاری کتابخانه PDF ناموفق بود.'));
      document.head.appendChild(script);
    });
  }

  async function loadPdf(arrayBuffer) {
    await loadPdfJs();
    const task = window.pdfjsLib.getDocument({ data: arrayBuffer });
    return task.promise;
  }

  async function renderPageAsImage(pdf, pageNumber, scale = 2.0) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    canvas.width = 0; canvas.height = 0;
    return { base64, mimeType: 'image/jpeg' };
  }

  return { loadPdf, renderPageAsImage };
})();
