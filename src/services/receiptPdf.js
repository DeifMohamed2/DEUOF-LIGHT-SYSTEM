const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { puppeteerLaunchOptions } = require('./chromeExecutable');
const { getOrCreateSettings } = require('./companySettings');
const { underLogoLinesHtml } = require('./quotePdf');

const FALLBACK_LOGO_REL = 'images/PHOTO-2025-10-14-05-49-43.png';

/** نص تحذيري كما في الإيصالات الورقية */
const RECEIPT_DISCLAIMER_AR =
  'لا يعتمد بهذا الإيصال كمستند إلا إذا كان مختوماً بختم الشركة، ولا يعتمد بالسداد للشيكات إلا بعد تمام صرفها.';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
          : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateAr(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

/* ─── Arabic number-to-words ─── */
const ONES = [
  '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة',
  'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
];
const TENS = [
  '', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون',
  'ستون', 'سبعون', 'ثمانون', 'تسعون',
];
const HUNDREDS = [
  '', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة',
  'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة',
];
const SCALE = ['', 'ألف', 'مليون', 'مليار'];

function threeDigitsAr(n) {
  const h = Math.floor(n / 100);
  const remainder = n % 100;
  const t = Math.floor(remainder / 10);
  const o = remainder % 10;
  const parts = [];
  if (h) parts.push(HUNDREDS[h]);
  if (remainder > 0) {
    if (remainder < 20) {
      parts.push(ONES[remainder]);
    } else {
      if (o) parts.push(ONES[o] + ' و' + TENS[t]);
      else parts.push(TENS[t]);
    }
  }
  return parts.join(' و');
}

function numberToArWords(amount) {
  if (!Number.isFinite(amount) || amount < 0) return '';
  const rounded = Math.round(amount * 100);
  const pounds = Math.floor(rounded / 100);
  const piastres = rounded % 100;

  if (pounds === 0 && piastres === 0) return 'صفر جنيه';

  // split into groups of 3 from the right
  const groups = [];
  let rem = pounds;
  for (let i = 0; i < SCALE.length; i++) {
    groups.push(rem % 1000);
    rem = Math.floor(rem / 1000);
    if (rem === 0) break;
  }

  const poundParts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const words = threeDigitsAr(g);
    if (SCALE[i]) {
      // special dual for 2000 / 2,000,000 etc.
      if (g === 2 && i === 1) poundParts.push('ألفان');
      else if (g === 2 && i === 2) poundParts.push('مليونان');
      else if (g === 1) poundParts.push(SCALE[i]);
      else poundParts.push(words + ' ' + SCALE[i]);
    } else {
      poundParts.push(words);
    }
  }

  let result = poundParts.join(' و') + ' جنيه';
  if (piastres > 0) {
    result += ' و' + threeDigitsAr(piastres) + ' قرش';
  }
  return result;
}

async function renderReceiptPdfHtml(receipt) {
  const settings = await getOrCreateSettings();
  const absRoot = path.join(__dirname, '../../public');

  let logoDataUri = '';
  if (settings.logoPath) {
    logoDataUri = imagePathToDataUri(
      path.join(absRoot, settings.logoPath.replace(/^\//, ''))
    );
  }
  if (!logoDataUri) {
    logoDataUri = imagePathToDataUri(path.join(absRoot, FALLBACK_LOGO_REL));
  }

  const khetmDataUri = imagePathToDataUri(path.join(absRoot, 'images/khetm.png'));

  const issuedDateStr = dateAr(receipt.issuedAt);
  const chequeDateStr = receipt.chequeDate ? dateAr(receipt.chequeDate) : '';
  const cashAmt = fmt(receipt.cashAmount);
  const chequeAmt = fmt(receipt.chequeAmount);
  const totalNumeric = Number(receipt.cashAmount || 0) + Number(receipt.chequeAmount || 0);
  const amountWords =
    (receipt.amountWords && String(receipt.amountWords).trim())
      ? String(receipt.amountWords).trim()
      : numberToArWords(totalNumeric);

  const addressBlock = [settings.address, settings.phone]
    .map((x) => (x || '').trim())
    .filter(Boolean)
    .join(' — ');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 12.5px;
      color: #111;
      line-height: 1.45;
      background: #fff;
    }
    .sheet { padding: 0; }

    /* نفس هيكل رأس عروض الأسعار / PDF */
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
      max-width: 56%;
      margin: 0;
      padding: 0;
      text-align: center;
      pointer-events: none;
    }
    .header-center h1 {
      margin: 0;
      padding: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.02em;
      direction: rtl;
      line-height: 1.08;
      color: #000;
      text-align: center;
      white-space: nowrap;
    }
    .header-stamp {
      display: block;
      margin: 6px auto 0;
      max-height: 72px;
      max-width: 180px;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .header-right {
      position: relative;
      z-index: 1;
      flex: 0 1 auto;
      max-width: 46%;
      min-width: 0;
      min-height: 1px;
      direction: rtl;
      text-align: right;
    }

    .body {
      direction: rtl;
      text-align: right;
    }
    .row {
      display: flex;
      flex-direction: row;
      direction: rtl;
      align-items: baseline;
      gap: 8px;
      padding: 8px 0 6px;
    }
    .row .lbl {
      flex: 0 0 auto;
      font-weight: 700;
      font-size: 12.5px;
      white-space: nowrap;
    }
    .row .fill {
      flex: 1 1 auto;
      font-size: 12.5px;
      min-height: 18px;
      border-bottom: 1px dotted #555;
      padding: 0 4px 2px;
      text-align: right;
    }

    .pay-block {
      margin: 10px 0 8px;
      padding: 0;
      border: none;
    }
    .pay-row {
      display: flex;
      flex-direction: row;
      direction: rtl;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
    }
    .pay-row .lbl {
      font-weight: 700;
      font-size: 12.5px;
      min-width: 3.5em;
      text-align: right;
    }
    .pay-row .amt {
      min-width: 100px;
      padding: 4px 8px;
      font-size: 13px;
      font-weight: 600;
      direction: ltr;
      text-align: center;
      border: 1px solid #333;
    }

    /* شيكات + بنك + اسم العميل — table layout for exact spacing */
    .checks-table {
      width: 100%;
      border-collapse: collapse;
      direction: rtl;
      margin: 6px 0;
    }
    .checks-table td {
      padding: 4px 4px 4px 0;
      vertical-align: bottom;
      white-space: nowrap;
    }
    .checks-table .td-lbl {
      font-weight: 700;
      font-size: 12px;
      padding-left: 4px;
      width: 1%;
    }
    .checks-table .td-amt {
      width: 1%;
      padding-left: 10px;
    }
    .checks-table .td-amt .amt {
      display: inline-block;
      min-width: 100px;
      padding: 4px 8px;
      font-size: 13px;
      font-weight: 600;
      direction: ltr;
      text-align: center;
      border: 1px solid #333;
    }
    .checks-table .td-dots {
      border-bottom: 1px dotted #555;
      width: auto;
      min-width: 55px;
      padding-bottom: 2px;
      font-size: 12px;
    }

    .row-compact {
      padding-top: 4px;
    }

    .footer-disclaimer {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid #ccc;
      font-size: 8.5px;
      color: #444;
      line-height: 1.55;
      text-align: center;
      direction: rtl;
    }
    .footer-addr {
      margin-top: 6px;
      font-size: 8.5px;
      color: #555;
      line-height: 1.5;
      text-align: center;
      direction: rtl;
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
      <h1>إيصال استلام نقدية / شيكات</h1>
      ${khetmDataUri ? `<img src="${khetmDataUri}" alt="" class="header-stamp" />` : ''}
    </div>
    <div class="header-right"></div>
  </div>

  <div class="body">
    <div class="row">
      <span class="lbl">تحريراً في</span>
      <span class="fill">${escapeHtml(issuedDateStr)}</span>
    </div>
    <div class="row">
      <span class="lbl">إستلمنا من السيد /</span>
      <span class="fill">${escapeHtml(receipt.receivedFrom || '')}</span>
    </div>
    <div class="row">
      <span class="lbl">فقط مبلغ وقدره /</span>
      <span class="fill">${escapeHtml(amountWords)}</span>
    </div>

    <div class="pay-block">
      <div class="pay-row">
        <span class="lbl">نقداً</span>
        <span class="amt">${escapeHtml(cashAmt)}</span>
      </div>
      <table class="checks-table">
        <tr>
          <td class="td-lbl">شيكات</td>
          <td class="td-amt"><span class="amt">${escapeHtml(chequeAmt)}</span></td>
          <td class="td-lbl">بنك</td>
          <td class="td-dots">${escapeHtml(receipt.bankName || '')}</td>
          <td class="td-lbl">اسم العميل</td>
          <td class="td-dots">${escapeHtml(receipt.customerName || '')}</td>
        </tr>
      </table>
    </div>

    <div class="row row-compact">
      <span class="lbl">رقم الشيك</span>
      <span class="fill" dir="ltr" style="text-align:right">${escapeHtml(receipt.chequeNumber || '')}</span>
    </div>
    <div class="row">
      <span class="lbl">تاريخ الشيك</span>
      <span class="fill">${escapeHtml(chequeDateStr)}</span>
    </div>
  </div>

  <footer class="footer-disclaimer">${escapeHtml(RECEIPT_DISCLAIMER_AR)}</footer>
  ${
    addressBlock
      ? `<div class="footer-addr">${escapeHtml(addressBlock)}</div>`
      : ''
  }

</div>
</body>
</html>`;
}

async function receiptToPdfBuffer(receipt) {
  const html = await renderReceiptPdfHtml(receipt);
  const browser = await puppeteer.launch(puppeteerLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A5',
      landscape: false,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '11mm', right: '11mm' },
    });
  } finally {
    await browser.close();
  }
}

module.exports = { receiptToPdfBuffer, renderReceiptPdfHtml };
