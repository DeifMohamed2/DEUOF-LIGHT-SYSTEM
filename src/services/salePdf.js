const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { getOrCreateSettings } = require('./companySettings');
const { salePaymentLabel } = require('../constants/salePayment');
const { puppeteerLaunchOptions } = require('./quotePdf');

const FALLBACK_LOGO_REL = 'images/PHOTO-2025-10-14-05-49-43.png';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fixImportTypo(s) {
  return String(s).replace(/لللاستيراد/g, 'للاستيراد');
}

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

async function renderSalePdfHtml(sale) {
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

  const dateStr = new Date(sale.soldAt).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const vatApplied = Boolean(sale.vat14Applied);
  const vatAmount = vatApplied && sale.vat14Amount != null ? Number(sale.vat14Amount) : 0;
  const grandTotal = Number(sale.total);

  const rows = sale.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.itemCode || '')}</td>
        <td>${escapeHtml(line.itemName)}</td>
        <td>${escapeHtml(line.quantity)}</td>
        <td>${escapeHtml(`${Number(line.unitPrice).toFixed(2)} ج.م`)}</td>
        <td>${escapeHtml(`${Number(line.lineTotal).toFixed(2)} ج.م`)}</td>
      </tr>`
    )
    .join('');

  const totalsBlock = vatApplied
    ? `<div class="totals-block">
        <p><strong>ضريبة القيمة المضافة (١٤٪):</strong> ${vatAmount.toFixed(2)} ج.م</p>
        <p class="grand-total"><strong>الإجمالي النهائي:</strong> ${grandTotal.toFixed(2)} ج.م</p>
      </div>`
    : `<div class="totals-block"><p class="grand-total"><strong>الإجمالي:</strong> ${grandTotal.toFixed(2)} ج.م</p></div>`;

  const paymentNoteBlock =
    sale.paymentNote && String(sale.paymentNote).trim()
      ? `<div class="notes-block"><div class="notes-heading">ملاحظات</div><div class="notes-body">${escapeHtml(
          sale.paymentNote
        )}</div></div>`
      : '';

  return `<!DOCTYPE html>
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
    .sheet { padding: 0; margin: 0; }
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
      max-width: 38%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    .header-left img {
      max-height: 76px;
      max-width: 152px;
      object-fit: contain;
      margin: 0 0 5px 0;
    }
    .header-left .company-ar {
      font-size: 10.5px;
      line-height: 1.48;
      font-weight: 700;
      max-width: 152px;
      direction: rtl;
      text-align: right;
    }
    .header-center {
      position: absolute;
      left: 50%;
      top: 10px;
      transform: translateX(-50%);
      z-index: 0;
      text-align: center;
      pointer-events: none;
    }
    .header-center h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 700;
      direction: rtl;
      color: #000;
    }
    .header-right {
      position: relative;
      z-index: 1;
      max-width: 46%;
      direction: rtl;
      text-align: right;
      font-size: 13px;
      line-height: 1.55;
      font-weight: 600;
    }
    table.invoice {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin: 14px 0 10px;
      direction: rtl;
    }
    table.invoice th, table.invoice td {
      border: 1px solid #000;
      padding: 8px 6px;
      text-align: center;
      vertical-align: middle;
    }
    table.invoice th { font-weight: 700; }
    .totals-block {
      margin: 10px 0 12px;
      text-align: right;
      direction: rtl;
      font-size: 13px;
    }
    .totals-block p { margin: 0.35em 0; }
    .grand-total {
      margin: 8px 0 10px;
      text-align: right;
      font-size: 15px;
    }
    .notes-block {
      margin: 14px 0;
      text-align: right;
      direction: rtl;
    }
    .notes-heading { font-weight: 800; font-size: 13px; margin-bottom: 6px; }
    .notes-body { white-space: pre-wrap; font-size: 12px; font-weight: 600; }
    .closing {
      margin-top: 18px;
      text-align: right;
      direction: rtl;
      font-weight: 700;
      font-size: 14px;
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
        <h1>فاتورة</h1>
      </div>
      <div class="header-right">
        <div><strong>التاريخ:</strong> ${escapeHtml(dateStr)}</div>
        <div><strong>العميل:</strong> ${escapeHtml(sale.customerName || '—')}</div>
        ${
          sale.disbursementNumber && String(sale.disbursementNumber).trim()
            ? `<div><strong>رقم إذن الصرف:</strong> ${escapeHtml(sale.disbursementNumber)}</div>`
            : ''
        }
        ${
          sale.customerNumber && String(sale.customerNumber).trim()
            ? `<div><strong>رقم العميل:</strong> ${escapeHtml(sale.customerNumber)}</div>`
            : ''
        }
        ${
          sale.paymentMethod && String(sale.paymentMethod).trim()
            ? `<div><strong>طريقة الدفع:</strong> ${escapeHtml(salePaymentLabel(sale.paymentMethod))}</div>`
            : ''
        }
      </div>
    </div>
    <table class="invoice">
      <thead>
        <tr>
          <th>كود الصنف</th>
          <th>اسم الصنف</th>
          <th>الكمية</th>
          <th>سعر الوحدة (ج.م)</th>
          <th>الإجمالي (ج.م)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${totalsBlock}
    ${paymentNoteBlock}
    <div class="closing"><p>وتفضلوا بقبول فائق الاحترام</p></div>
  </div>
</body>
</html>`;
}

async function saleToPdfBuffer(sale) {
  const html = await renderSalePdfHtml(sale);
  const browser = await puppeteer.launch(puppeteerLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '5mm', bottom: '12mm', left: '11mm', right: '11mm' },
    });
  } finally {
    await browser.close();
  }
}

module.exports = { saleToPdfBuffer, renderSalePdfHtml };
