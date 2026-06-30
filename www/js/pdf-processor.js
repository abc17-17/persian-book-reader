// pdf-processor.js — تبدیل فایل PDF به تصویر هر صفحه (با استفاده از PDF.js)

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

  // فایل PDF را می‌گیرد و تعداد کل صفحات را برمی‌گرداند، همراه با خود سند برای استفاده بعدی
  async function loadPdf(arrayBuffer) {
    await loadPdfJs();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    return pdf;
  }

  // یک صفحه خاص را به تصویر (base64 JPEG) تبدیل می‌کند
  async function renderPageAsImage(pdf, pageNumber, scale = 2.0) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');

    await page.render({ canvasContext: context, viewport }).promise;

    // فشرده‌سازی به JPEG برای کاهش حجم درخواست به API
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];

    // آزاد کردن حافظه canvas
    canvas.width = 0;
    canvas.height = 0;

    return { base64, mimeType: 'image/jpeg' };
  }

  return { loadPdf, renderPageAsImage };
})();
