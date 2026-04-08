const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { getOrCreateSettings } = require('./companySettings');
const { PRICED_QUOTE_VAT_NOTE, PRICED_QUOTE_VAT_NOTE_PREFIX } = require('../constants/quotePricing');

/** Main title on PDF for priced quotes (`from_stock`). */
const PRICED_QUOTE_DOCUMENT_TITLE = 'عرض سعر';

const FALLBACK_LOGO_REL = 'images/PHOTO-2025-10-14-05-49-43.png';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fix common typo: لللاستيراد → للاستيراد (extra ل before الاستيراد) */
function fixImportTypo(s) {
  return String(s).replace(/لللاستيراد/g, 'للاستيراد');
}

/** Arabic lines under logo on PDF (never English company name). */
function underLogoLinesHtml(settings) {
  const ar = fixImportTypo((settings.companyNameAr || '').trim());
  if (ar) {
    return ar
      .split(/\r?\n/)
      .map((line) => fixImportTypo(line.trim()))
      .filter(Boolean)
      .map(escapeHtml)
      .join('<br/>');
  }
  return 'ضيوف لايت للاستيراد<br/>والتوريدات الكهربائية';
}

function imagePathToDataUri(absPath) {
  if (!fs.existsSync(absPath)) return '';
  const ext = path.extname(absPath).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/png';
  const b64 = fs.readFileSync(absPath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

async function renderQuotePdfHtml(quote) {
  const settings = await getOrCreateSettings();
  const absRoot = path.join(__dirname, '../../public');
  let logoDataUri = '';
  if (settings.logoPath) {
    const logoFs = path.join(absRoot, settings.logoPath.replace(/^\//, ''));
    logoDataUri = imagePathToDataUri(logoFs);
  }
  if (!logoDataUri) {
    logoDataUri = imagePathToDataUri(path.join(absRoot, FALLBACK_LOGO_REL));
  }

  const isRequest = quote.type === 'request';
  const showPrice = quote.type === 'from_stock';
  const docTitle = isRequest ? 'فاتورة طلب' : PRICED_QUOTE_DOCUMENT_TITLE;
  const introLine = isRequest
    ? 'برجاء التكرم بتوريد امر الشغل التالي :'
    : 'برجاء الاطلاع على التسعيرة التالية :';
  const dateStr = new Date(quote.createdAt).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const headExtra = showPrice ? '<th>السعر (ج.م)</th><th>الإجمالي (ج.م)</th>' : '';
  /* thead order: with dir=rtl on table, first th is the rightmost column = كود الصنف */
  const theadCells = `<th>كود الصنف</th><th>اسم الصنف</th><th>الكمية</th>${headExtra}`;

  const rows = quote.lines
    .map((line) => {
      const priceCells = showPrice
        ? `<td>${escapeHtml(line.price != null ? `${Number(line.price).toFixed(2)} ج.م` : '')}</td>
           <td>${escapeHtml(`${(Number(line.quantity) * Number(line.price || 0)).toFixed(2)} ج.م`)}</td>`
        : '';
      return `<tr>
        <td>${escapeHtml(line.itemCode || '')}</td>
        <td>${escapeHtml(line.itemName)}</td>
        <td>${escapeHtml(line.quantity)}</td>
        ${priceCells}
      </tr>`;
    })
    .join('');

  const notesBlock =
    quote.notes && String(quote.notes).trim()
      ? `<div class="notes-block">
          <div class="notes-heading">ملاحظات</div>
          <div class="notes-body">${escapeHtml(quote.notes)}</div>
        </div>`
      : '';

  const totalBlock =
    showPrice && quote.total != null
      ? `<p class="grand-total"><strong>الإجمالي:</strong> ${Number(quote.total).toFixed(2)} ج.م</p>`
      : '';

  const vatCurrencyBlock = showPrice
    ? `<p class="price-vat-footnote"><span class="price-vat-footnote__star">${escapeHtml(
        PRICED_QUOTE_VAT_NOTE_PREFIX
      )}</span><span class="price-vat-footnote__text">${escapeHtml(PRICED_QUOTE_VAT_NOTE)}</span></p>`
    : '';

  const _pdfHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif;
      margin: 0;
      padding: 0;
      color: #000;
      font-size: 13px;
      line-height: 1.45;
    }
    .sheet {
      padding: 0;
      margin: 0;
    }
    /* Title uses position absolute at 50% so it matches true page center, not flex middle column */
    .header-row {
      position: relative;
      display: flex;
      flex-direction: row;
      direction: ltr;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px 14px;
      margin: 0 0 12px 0;
      padding: 0 0 10px 0;
      border-bottom: 1px solid #000;
    }
    .header-left {
      position: relative;
      z-index: 1;
      flex: 0 0 auto;
      min-width: 0;
      max-width: 38%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: flex-start;
    }
    .header-left img {
      max-height: 76px;
      max-width: 152px;
      width: auto;
      height: auto;
      object-fit: contain;
      object-position: left top;
      display: block;
      margin: 0 0 5px 0;
    }
    .header-left .company-ar {
      font-size: 10.5px;
      line-height: 1.48;
      font-weight: 700;
      color: #000;
      width: 100%;
      max-width: 152px;
      direction: rtl;
      text-align: right;
      unicode-bidi: embed;
    }
    .header-center {
      position: absolute;
      left: 50%;
      top: 10px;
      transform: translateX(-50%);
      z-index: 0;
      width: max-content;
      max-width: 46%;
      margin: 0;
      padding: 0;
      text-align: center;
      pointer-events: none;
    }
    .header-center h1 {
      margin: 0;
      padding: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0.03em;
      direction: rtl;
      line-height: 1.08;
      color: #000;
      text-align: center;
    }
    .header-right {
      position: relative;
      z-index: 1;
      flex: 0 1 auto;
      max-width: 46%;
      min-width: 0;
      direction: rtl;
      text-align: right;
      font-size: 14px;
      line-height: 1.58;
      font-weight: 600;
      align-self: flex-start;
      margin: 0;
      padding: 0;
    }
    .header-right strong {
      font-weight: 700;
    }
    .header-right .intro {
      margin-top: 26px;
      padding-top: 6px;
      font-weight: 700;
      font-size: 14px;
      line-height: 1.5;
    }
    table.invoice {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin: 14px 0 10px;
      direction: rtl;
    }
    table.invoice th,
    table.invoice td {
      border: 1px solid #000;
      padding: 8px 6px;
      text-align: center;
      vertical-align: middle;
    }
    table.invoice th {
      font-weight: 700;
      background: #fff;
      font-family: 'IBM Plex Sans Arabic', sans-serif;
    }
    .notes-block {
      margin: 14px 0 18px;
      text-align: right;
      direction: rtl;
    }
    .notes-heading {
      font-weight: 800;
      font-size: 13px;
      margin-bottom: 8px;
    }
    .notes-body {
      white-space: pre-wrap;
      font-size: 12.5px;
      line-height: 1.55;
      font-weight: 700;
    }
    .grand-total {
      margin: 8px 0 10px;
      text-align: center;
      font-size: 14px;
    }
    .price-vat-footnote {
      margin: 2px 0 14px;
      padding: 0;
      border: none;
      display: flex;
      flex-direction: row;
      direction: ltr;
      justify-content: flex-start;
      align-items: flex-start;
      gap: 5px;
      font-size: 8.5px;
      font-weight: 500;
      line-height: 1.45;
      color: #444;
    }
    .price-vat-footnote__star {
      flex-shrink: 0;
      font-weight: 600;
      margin-top: 0.05em;
    }
    .price-vat-footnote__text {
      direction: rtl;
      text-align: right;
      unicode-bidi: embed;
    }
    .closing {
      margin-top: 22px;
      text-align: center;
      direction: rtl;
      line-height: 1.85;
    }
    .closing p {
      margin: 0.35em 0;
      font-weight: 700;
      font-size: 15px;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header-row">
      <div class="header-left">
        ${logoDataUri ? `<img src="${logoDataUri}" alt="" />` : ''}
        <div class="company-ar">${underLogoLinesHtml(settings)}</div>
      </div>
      <div class="header-center">
        <h1>${escapeHtml(docTitle)}</h1>
      </div>
      <div class="header-right">
        <div><strong>التاريخ:</strong> ${escapeHtml(dateStr)}</div>
        <div><strong>المرسل إليه :</strong> ${escapeHtml(quote.customerName)}</div>
        ${quote.customerPhone ? `<div><strong>الهاتف:</strong> ${escapeHtml(quote.customerPhone)}</div>` : ''}
        <div class="intro">${escapeHtml(introLine)}</div>
      </div>
    </div>

    <table class="invoice">
      <thead>
        <tr>
          ${theadCells}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${totalBlock}
    ${vatCurrencyBlock}
    ${notesBlock}

    <div class="closing">
      <p>وتفضلوا بقبول فائق الاحترام</p>
      <p>نشكركم لحسن تعاونكم</p>
    </div>
  </div>
</body>
</html>`;
  return _pdfHtml;
}

async function quoteToPdfBuffer(quote) {
  const html = await renderQuotePdfHtml(quote);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '5mm', bottom: '12mm', left: '11mm', right: '11mm' },
    });
    return buf;
  } finally {
    await browser.close();
  }
}

module.exports = { quoteToPdfBuffer, renderQuotePdfHtml };
