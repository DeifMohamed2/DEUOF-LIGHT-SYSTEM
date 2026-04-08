const ExcelJS = require('exceljs');
const { getOrCreateSettings } = require('./companySettings');
const { PRICED_QUOTE_VAT_NOTE, PRICED_QUOTE_VAT_NOTE_PREFIX } = require('../constants/quotePricing');

async function quoteToWorkbook(quote) {
  const settings = await getOrCreateSettings();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('بيان أسعار', { views: [{ rightToLeft: true }] });

  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = settings.companyName;
  ws.getCell('A1').font = { bold: true, size: 16 };
  ws.getCell('A1').alignment = { horizontal: 'right' };

  let row = 3;
  if (settings.address) {
    ws.getCell(`A${row}`).value = settings.address;
    ws.getCell(`A${row}`).alignment = { horizontal: 'right' };
    row++;
  }
  if (settings.phone) {
    ws.getCell(`A${row}`).value = settings.phone;
    ws.getCell(`A${row}`).alignment = { horizontal: 'right' };
    row++;
  }

  row += 1;
  ws.getCell(`A${row}`).value =
    quote.type === 'request' ? 'طلب تسعير' : 'عرض سعر من المخزون';
  row += 1;
  ws.getCell(`A${row}`).value = `العميل: ${quote.customerName}`;
  row += 1;
  if (quote.customerPhone) {
    ws.getCell(`A${row}`).value = `الهاتف: ${quote.customerPhone}`;
    row++;
  }
  ws.getCell(`A${row}`).value = `التاريخ: ${new Date(quote.createdAt).toLocaleString('ar-EG')}`;
  row += 1;

  const showPrice = quote.type === 'from_stock';
  if (showPrice) {
    if (quote.vat14Applied && quote.noticeDiscountApplied) {
      ws.getCell(`A${row}`).value =
        '* يُضاف ١٤٪ ضريبة قيمة مضافة على مجموع البنود، ويُخصم خصم ١٪ إشعار من المجموع (يظهر في الإجمالي النهائي).';
    } else if (quote.vat14Applied) {
      ws.getCell(`A${row}`).value =
        '* يُضاف ١٤٪ ضريبة قيمة مضافة على مجموع بنود العرض (يظهر في الإجمالي النهائي).';
    } else if (quote.noticeDiscountApplied) {
      ws.getCell(`A${row}`).value =
        '* يُخصم خصم ١٪ إشعار من مجموع بنود العرض (يظهر في الإجمالي النهائي).';
    } else {
      ws.getCell(`A${row}`).value = `${PRICED_QUOTE_VAT_NOTE_PREFIX}${PRICED_QUOTE_VAT_NOTE}`;
    }
    ws.getCell(`A${row}`).font = { size: 9 };
    ws.getCell(`A${row}`).alignment = { horizontal: 'left', wrapText: true };
    row += 1;
  }
  row += 1;

  const headers = showPrice
    ? ['كود الصنف', 'اسم الصنف', 'الكمية', 'السعر (ج.م)', 'الإجمالي (ج.م)']
    : ['كود الصنف', 'اسم الصنف', 'الكمية'];
  const headerRow = ws.getRow(row);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
    headerRow.getCell(i + 1).font = { bold: true };
  });
  row++;

  for (const line of quote.lines) {
    const r = ws.getRow(row);
    r.getCell(1).value = line.itemCode || '';
    r.getCell(2).value = line.itemName;
    r.getCell(3).value = Number(line.quantity);
    if (showPrice) {
      r.getCell(4).value = line.price != null ? Number(line.price) : '';
      r.getCell(5).value = Number(line.quantity) * Number(line.price || 0);
    }
    row++;
  }

  if (showPrice && quote.total != null) {
    row += 1;
    if (quote.vat14Applied) {
      ws.getCell(`D${row}`).value = 'ضريبة القيمة المضافة (١٤٪)';
      ws.getCell(`E${row}`).value = Number(quote.vat14Amount || 0);
      row += 1;
    }
    if (quote.noticeDiscountApplied) {
      ws.getCell(`D${row}`).value = 'خصم ١٪ إشعار';
      ws.getCell(`E${row}`).value = Number(quote.noticeDiscountAmount || 0);
      row += 1;
    }
    const grandLabel =
      quote.vat14Applied || quote.noticeDiscountApplied
        ? 'الإجمالي النهائي (ج.م)'
        : 'الإجمالي (ج.م)';
    ws.getCell(`D${row}`).value = grandLabel;
    ws.getCell(`E${row}`).value = Number(quote.total);
    ws.getCell(`E${row}`).font = { bold: true };
  }

  if (quote.notes && String(quote.notes).trim()) {
    row += 2;
    const endCol = showPrice ? 'E' : 'C';
    const startR = row;
    const endR = row + 2;
    ws.mergeCells(`A${startR}:${endCol}${endR}`);
    const cell = ws.getCell(`A${startR}`);
    cell.value = `ملاحظات:\n${String(quote.notes).trim()}`;
    cell.alignment = { wrapText: true, horizontal: 'right', vertical: 'top' };
    cell.font = { size: 11 };
  }

  ws.columns.forEach((c) => {
    c.width = 18;
  });

  return wb;
}

module.exports = { quoteToWorkbook };
