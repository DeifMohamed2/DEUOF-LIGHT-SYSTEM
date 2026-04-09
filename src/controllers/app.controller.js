const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const InventoryItem = require('../models/InventoryItem');
const Quote = require('../models/Quote');
const Sale = require('../models/Sale');
const StockAddition = require('../models/StockAddition');
const { getOrCreateSettings } = require('../services/companySettings');
const { quoteToPdfBuffer } = require('../services/quotePdf');
const { saleToPdfBuffer } = require('../services/salePdf');
const { quoteToWorkbook } = require('../services/quoteExcel');
const { SALE_PAYMENT_METHODS, salePaymentLabel } = require('../constants/salePayment');

const SALE_VAT_RATE = 0.14;
/** خصم ١٪ إشعار — من المجموع قبل الضريبة، بنفس أساس احتساب الـ ١٤٪ */
const NOTICE_DISCOUNT_RATE = 0.01;

const INV_PAGE = 15;
const SALE_PAGE = 20;
const QUOTE_LIMIT = 20;

function shell(locals) {
  return { layout: 'layouts/app', ...locals };
}

function parseVat14AndNoticeDiscount(body) {
  const vat14Applied =
    body.vat14 === 'on' || body.vat14 === '1' || body.vat14 === 'true';
  const noticeDiscountApplied =
    body.noticeDiscount === 'on' ||
    body.noticeDiscount === '1' ||
    body.noticeDiscount === 'true';
  return { vat14Applied, noticeDiscountApplied };
}

function computeSubtotalAdjustments(subtotal, vat14Applied, noticeDiscountApplied) {
  const vat14Amount = vat14Applied ? Math.round(subtotal * SALE_VAT_RATE * 100) / 100 : 0;
  const noticeDiscountAmount = noticeDiscountApplied
    ? Math.round(subtotal * NOTICE_DISCOUNT_RATE * 100) / 100
    : 0;
  const finalTotal = Math.max(
    0,
    Math.round((subtotal + vat14Amount - noticeDiscountAmount) * 100) / 100
  );
  return { vat14Amount, noticeDiscountAmount, finalTotal };
}

/** Admin أو منشئ السجل فقط يمكنه التعديل/الحذف */
function quoteAccessFilter(req) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return null;
  if (req.session.role === 'admin') return { _id: id };
  return { _id: id, createdBy: req.session.userId };
}

function saleAccessFilter(req) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return null;
  if (req.session.role === 'admin') return { _id: id };
  return { _id: id, createdBy: req.session.userId };
}

function stockQtyMapFromSaleLines(saleLines) {
  const m = new Map();
  for (const line of saleLines) {
    if (!line.fromStock || !line.inventoryItem) continue;
    const id = String(line.inventoryItem);
    m.set(id, (m.get(id) || 0) + Number(line.quantity));
  }
  return m;
}

/**
 * تعديل مبيعة: تغيير صافي المخزون = (كميات قديمة − كميات جديدة) لكل صنف مخزون.
 */
async function applySaleStockDelta(oldLines, newLines) {
  const oldM = stockQtyMapFromSaleLines(oldLines);
  const newM = stockQtyMapFromSaleLines(newLines);
  const ids = new Set([...oldM.keys(), ...newM.keys()]);
  if (ids.size === 0) return { ok: true };

  const oids = [...ids].map((i) => new mongoose.Types.ObjectId(i));
  const items = await InventoryItem.find({ _id: { $in: oids } });
  const byId = new Map(items.map((it) => [String(it._id), it]));

  for (const id of ids) {
    const oldQ = oldM.get(id) || 0;
    const newQ = newM.get(id) || 0;
    const inc = oldQ - newQ;
    if (inc === 0) continue;
    const item = byId.get(id);
    if (!item && (oldQ > 0 || newQ > 0)) {
      return { error: 'صنف مخزون غير موجود' };
    }
    if (item) {
      const projected = item.quantityOnHand + inc;
      if (projected < 0) {
        return { error: `الكمية غير كافية في المخزون (${item.name})` };
      }
    }
  }

  for (const id of ids) {
    const oldQ = oldM.get(id) || 0;
    const newQ = newM.get(id) || 0;
    const inc = oldQ - newQ;
    if (inc === 0) continue;
    await InventoryItem.updateOne({ _id: id }, { $inc: { quantityOnHand: inc } });
  }
  return { ok: true };
}

async function buildSaleLinesFromParsed(parsed) {
  const saleLines = [];
  let total = 0;
  for (const line of parsed.lines) {
    if (line.fromStock) {
      const item = await InventoryItem.findById(line.inventoryItem);
      if (!item) return { error: 'صنف غير موجود في المخزون' };
      const lineTotal = line.quantity * line.unitPrice;
      total += lineTotal;
      saleLines.push({
        fromStock: true,
        inventoryItem: line.inventoryItem,
        itemCode: item.itemCode,
        itemName: item.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal,
      });
    } else {
      const lineTotal = line.quantity * line.unitPrice;
      total += lineTotal;
      saleLines.push({
        fromStock: false,
        inventoryItem: null,
        itemCode: line.itemCode || '—',
        itemName: line.itemName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal,
      });
    }
  }
  return { saleLines, subtotal: Math.round(total * 100) / 100 };
}

async function dashboard(req, res) {
  const [itemsCount, lowStock, quotesCount, mySalesCount] = await Promise.all([
    InventoryItem.countDocuments(),
    InventoryItem.countDocuments({ quantityOnHand: { $lte: 5, $gt: 0 } }),
    Quote.countDocuments(),
    Sale.countDocuments({ createdBy: req.session.userId }),
  ]);

  let revenueMonth = null;
  let revenueYear = null;
  if (req.session.role === 'admin') {
    const startMonth = new Date();
    startMonth.setDate(1);
    startMonth.setHours(0, 0, 0, 0);
    const startYear = new Date(startMonth.getFullYear(), 0, 1);
    const [mAgg, yAgg] = await Promise.all([
      Sale.aggregate([
        { $match: { soldAt: { $gte: startMonth } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Sale.aggregate([
        { $match: { soldAt: { $gte: startYear } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
    ]);
    revenueMonth = mAgg[0]?.total ?? 0;
    revenueYear = yAgg[0]?.total ?? 0;
  }

  res.render(
    'sections/dashboard',
    shell({
      section: 'dashboard',
      title: 'لوحة التحكم',
      itemsCount,
      lowStock,
      quotesCount,
      mySalesCount,
      revenueMonth,
      revenueYear,
    })
  );
}

async function inventoryList(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const q = (req.query.q || '').trim();
  const filter = q
    ? {
        $or: [
          { itemCode: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { band: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    InventoryItem.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * INV_PAGE)
      .limit(INV_PAGE)
      .lean(),
    InventoryItem.countDocuments(filter),
  ]);
  res.render(
    'sections/inventory',
    shell({
      section: 'inventory',
      title: 'المخزن',
      mode: 'list',
      items,
      page,
      totalPages: Math.max(1, Math.ceil(total / INV_PAGE)),
      q,
      item: null,
      errors: null,
    })
  );
}

async function inventorySearchJson(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const items = await InventoryItem.find({
    $or: [{ itemCode: regex }, { name: regex }, { band: regex }],
  })
    .sort({ name: 1 })
    .limit(40)
    .select('itemCode name band quantityOnHand unitPrice')
    .lean();
  res.json(items);
}

function inventoryNewForm(req, res) {
  res.render(
    'sections/inventory',
    shell({
      section: 'inventory',
      title: 'إضافة صنف',
      mode: 'new',
      item: null,
      errors: null,
      items: [],
      page: 1,
      totalPages: 1,
      q: '',
    })
  );
}

async function inventoryCreate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.render(
      'sections/inventory',
      shell({
        section: 'inventory',
        title: 'إضافة صنف',
        mode: 'new',
        item: req.body,
        errors: errors.mapped(),
        items: [],
        page: 1,
        totalPages: 1,
        q: '',
      })
    );
  }
  try {
    await InventoryItem.create({
      itemCode: req.body.itemCode.trim().toUpperCase(),
      name: req.body.name.trim(),
      band: (req.body.band || '').trim(),
      quantityOnHand: Number(req.body.quantityOnHand) || 0,
      unitPrice: Number(req.body.unitPrice) || 0,
      notes: (req.body.notes || '').trim(),
    });
    req.flash('success', 'تمت إضافة الصنف');
    res.redirect('/inventory');
  } catch (e) {
    if (e.code === 11000) req.flash('error', 'كود الصنف موجود مسبقاً');
    else req.flash('error', 'حدث خطأ أثناء الحفظ');
    res.render(
      'sections/inventory',
      shell({
        section: 'inventory',
        title: 'إضافة صنف',
        mode: 'new',
        item: req.body,
        errors: null,
        items: [],
        page: 1,
        totalPages: 1,
        q: '',
      })
    );
  }
}

async function inventoryEditForm(req, res) {
  const item = await InventoryItem.findById(req.params.id).lean();
  if (!item) {
    req.flash('error', 'الصنف غير موجود');
    return res.redirect('/inventory');
  }
  res.render(
    'sections/inventory',
    shell({
      section: 'inventory',
      title: 'تعديل صنف',
      mode: 'edit',
      item,
      errors: null,
      items: [],
      page: 1,
      totalPages: 1,
      q: '',
    })
  );
}

async function inventoryUpdate(req, res) {
  const errors = validationResult(req);
  const item = await InventoryItem.findById(req.params.id);
  if (!item) {
    req.flash('error', 'الصنف غير موجود');
    return res.redirect('/inventory');
  }
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.render(
      'sections/inventory',
      shell({
        section: 'inventory',
        title: 'تعديل صنف',
        mode: 'edit',
        item: { ...item.toObject(), ...req.body, _id: item._id },
        errors: errors.mapped(),
        items: [],
        page: 1,
        totalPages: 1,
        q: '',
      })
    );
  }
  try {
    item.itemCode = req.body.itemCode.trim().toUpperCase();
    item.name = req.body.name.trim();
    item.band = (req.body.band || '').trim();
    item.quantityOnHand = Number(req.body.quantityOnHand) || 0;
    item.unitPrice = Number(req.body.unitPrice) || 0;
    item.notes = (req.body.notes || '').trim();
    await item.save();
    req.flash('success', 'تم تحديث الصنف');
    res.redirect('/inventory');
  } catch (e) {
    if (e.code === 11000) req.flash('error', 'كود الصنف موجود مسبقاً');
    else req.flash('error', 'حدث خطأ أثناء الحفظ');
    res.render(
      'sections/inventory',
      shell({
        section: 'inventory',
        title: 'تعديل صنف',
        mode: 'edit',
        item: { ...item.toObject(), ...req.body },
        errors: null,
        items: [],
        page: 1,
        totalPages: 1,
        q: '',
      })
    );
  }
}

async function inventoryRemove(req, res) {
  const row = await InventoryItem.findByIdAndDelete(req.params.id);
  if (!row) req.flash('error', 'الصنف غير موجود');
  else req.flash('success', 'تم حذف الصنف');
  res.redirect('/inventory');
}

function parseYmdLocalDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

async function inventoryItemDetails(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    req.flash('error', 'الصنف غير موجود');
    return res.redirect('/inventory');
  }
  const itemId = new mongoose.Types.ObjectId(req.params.id);
  const item = await InventoryItem.findById(req.params.id).lean();
  if (!item) {
    req.flash('error', 'الصنف غير موجود');
    return res.redirect('/inventory');
  }
  const [sales, stockAdditions] = await Promise.all([
    Sale.find({ 'lines.inventoryItem': itemId }).sort({ soldAt: -1 }).lean(),
    StockAddition.find({ inventoryItem: itemId })
      .sort({ addedAt: -1 })
      .populate('createdBy', 'fullName username')
      .lean(),
  ]);
  const deductionRows = [];
  for (const sale of sales) {
    let qty = 0;
    for (const line of sale.lines) {
      if (!line.inventoryItem || String(line.inventoryItem) !== String(itemId)) continue;
      if (line.fromStock === false) continue;
      qty += Number(line.quantity) || 0;
    }
    if (qty <= 0) continue;
    deductionRows.push({
      disbursementNumber: sale.disbursementNumber || '',
      customerName: sale.customerName || '',
      soldAt: sale.soldAt,
      quantityReduced: qty,
      saleId: sale._id,
    });
  }
  deductionRows.sort((a, b) => {
    const da = String(a.disbursementNumber || '').trim();
    const db = String(b.disbursementNumber || '').trim();
    if (!da && db) return 1;
    if (da && !db) return -1;
    if (da !== db) return da.localeCompare(db, 'ar', { numeric: true });
    return new Date(b.soldAt) - new Date(a.soldAt);
  });
  res.render(
    'sections/inventory',
    shell({
      section: 'inventory',
      title: `تفاصيل الصنف`,
      mode: 'details',
      item,
      deductionRows,
      stockAdditions,
      items: [],
      page: 1,
      totalPages: 1,
      q: '',
      errors: null,
    })
  );
}

async function inventoryAddStock(req, res) {
  const id = req.params.id;
  const back = mongoose.isValidObjectId(id) ? `/inventory/${id}/details` : '/inventory';
  if (!mongoose.isValidObjectId(id)) {
    req.flash('error', 'الصنف غير موجود');
    return res.redirect('/inventory');
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect(back);
  }
  const addedAt = parseYmdLocalDate(req.body.addedAt);
  if (!addedAt) {
    req.flash('error', 'تاريخ غير صالح');
    return res.redirect(back);
  }
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    req.flash('error', 'الكمية غير صالحة');
    return res.redirect(back);
  }
  try {
    const item = await InventoryItem.findById(id);
    if (!item) {
      req.flash('error', 'الصنف غير موجود');
      return res.redirect('/inventory');
    }
    await StockAddition.create({
      inventoryItem: item._id,
      addedAt,
      source: req.body.source.trim(),
      quantity,
      createdBy: req.session.userId,
    });
    item.quantityOnHand += quantity;
    await item.save();
    req.flash('success', 'تمت إضافة الكمية وتسجيلها');
  } catch (e) {
    console.error(e);
    req.flash('error', 'تعذر حفظ الإضافة');
  }
  res.redirect(back);
}

function parseQuoteLinesJson(raw, type) {
  let lines;
  try {
    lines = JSON.parse(raw || '[]');
  } catch {
    return { error: 'بيانات الأسطر غير صالحة' };
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return { error: 'أضف سطراً واحداً على الأقل' };
  }
  const normalized = [];
  for (const line of lines) {
    const itemName = (line.itemName || '').trim();
    if (!itemName) return { error: 'اسم الصنف مطلوب في كل السطور' };
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) return { error: 'الكمية غير صالحة' };
    const itemCode = (line.itemCode || '').trim();
    if (type === 'from_stock') {
      const price = line.price != null && line.price !== '' ? Number(line.price) : null;
      if (!Number.isFinite(price) || price < 0) return { error: 'السعر غير صالح' };
      let inventoryItem = null;
      if (line.inventoryItem && mongoose.isValidObjectId(line.inventoryItem)) {
        inventoryItem = line.inventoryItem;
      }
      normalized.push({ itemCode, itemName, quantity, price, inventoryItem });
    } else {
      normalized.push({
        itemCode,
        itemName,
        quantity,
        price: null,
        inventoryItem: null,
      });
    }
  }
  return { lines: normalized };
}

async function quotesList(req, res) {
  const filter = {};
  const type = req.query.type;
  if (type === 'request' || type === 'from_stock') filter.type = type;
  const customer = (req.query.customer || '').trim();
  if (customer) filter.customerName = new RegExp(customer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (req.query.from) filter.createdAt = { $gte: new Date(req.query.from) };
  if (req.query.to) {
    const t = new Date(req.query.to);
    t.setHours(23, 59, 59, 999);
    filter.createdAt = { ...filter.createdAt, $lte: t };
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const [quotes, total] = await Promise.all([
    Quote.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * QUOTE_LIMIT)
      .limit(QUOTE_LIMIT)
      .populate('createdBy', 'fullName username')
      .lean(),
    Quote.countDocuments(filter),
  ]);
  res.render(
    'sections/quotes',
    shell({
      section: 'quotes',
      title: 'بيانات الأسعار',
      mode: 'list',
      quotes,
      page,
      totalPages: Math.max(1, Math.ceil(total / QUOTE_LIMIT)),
      query: req.query,
      quote: null,
      listUserId: req.session.userId,
      listIsAdmin: req.session.role === 'admin',
    })
  );
}

async function quotesNewRequest(req, res) {
  const settings = await getOrCreateSettings();
  res.render(
    'sections/quotes',
    shell({
      section: 'quotes',
      title: 'طلب تسعير جديد',
      mode: 'request',
      quotes: [],
      page: 1,
      totalPages: 1,
      query: {},
      quote: null,
      defaultQuoteNotes: settings.defaultQuoteNotes || '',
    })
  );
}

async function quotesNewFromStock(req, res) {
  const settings = await getOrCreateSettings();
  res.render(
    'sections/quotes',
    shell({
      section: 'quotes',
      title: 'عرض سعر من المخزون',
      mode: 'stock',
      quotes: [],
      page: 1,
      totalPages: 1,
      query: {},
      quote: null,
      defaultQuoteNotes: settings.defaultQuoteNotes || '',
    })
  );
}

async function quotesCreateRequest(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect('/quotes/new/request');
  }
  const parsed = parseQuoteLinesJson(req.body.linesJson, 'request');
  if (parsed.error) {
    req.flash('error', parsed.error);
    return res.redirect('/quotes/new/request');
  }
  await Quote.create({
    type: 'request',
    customerName: req.body.customerName.trim(),
    customerPhone: (req.body.customerPhone || '').trim(),
    lines: parsed.lines,
    subtotal: 0,
    total: 0,
    notes: (req.body.notes || '').trim(),
    createdBy: req.session.userId,
  });
  req.flash('success', 'تم حفظ طلب التسعير');
  res.redirect('/quotes');
}

async function quotesCreateFromStock(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect('/quotes/new/from-stock');
  }
  const parsed = parseQuoteLinesJson(req.body.linesJson, 'from_stock');
  if (parsed.error) {
    req.flash('error', parsed.error);
    return res.redirect('/quotes/new/from-stock');
  }
  for (const line of parsed.lines) {
    if (line.inventoryItem) {
      const item = await InventoryItem.findById(line.inventoryItem);
      if (!item) {
        req.flash('error', 'صنف غير موجود في المخزون');
        return res.redirect('/quotes/new/from-stock');
      }
      if (line.quantity > item.quantityOnHand) {
        req.flash('error', `الكمية المتاحة للصنف ${item.name} غير كافية`);
        return res.redirect('/quotes/new/from-stock');
      }
    }
  }
  let lineSum = 0;
  const lines = parsed.lines.map((l) => {
    const lineTotal = Number(l.quantity) * Number(l.price || 0);
    lineSum += lineTotal;
    return { ...l, itemCode: l.itemCode || '' };
  });
  const subtotal = Math.round(lineSum * 100) / 100;
  const { vat14Applied, noticeDiscountApplied } = parseVat14AndNoticeDiscount(req.body);
  const { vat14Amount, noticeDiscountAmount, finalTotal } = computeSubtotalAdjustments(
    subtotal,
    vat14Applied,
    noticeDiscountApplied
  );
  await Quote.create({
    type: 'from_stock',
    customerName: req.body.customerName.trim(),
    customerPhone: (req.body.customerPhone || '').trim(),
    lines,
    subtotal,
    vat14Applied,
    vat14Amount,
    noticeDiscountApplied,
    noticeDiscountAmount,
    total: finalTotal,
    notes: (req.body.notes || '').trim(),
    createdBy: req.session.userId,
  });
  req.flash('success', 'تم حفظ عرض السعر');
  res.redirect('/quotes');
}

async function quotesShow(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    req.flash('error', 'المستند غير موجود');
    return res.redirect('/quotes');
  }
  const quote = await Quote.findById(req.params.id).populate('createdBy', 'fullName username').lean();
  if (!quote) {
    req.flash('error', 'المستند غير موجود');
    return res.redirect('/quotes');
  }
  const createdId = quote.createdBy && quote.createdBy._id ? String(quote.createdBy._id) : String(quote.createdBy || '');
  const canMutateQuote =
    req.session.role === 'admin' || createdId === String(req.session.userId);
  res.render(
    'sections/quotes',
    shell({
      section: 'quotes',
      title: 'تفاصيل بيان الأسعار',
      mode: 'show',
      quote,
      quotes: [],
      page: 1,
      totalPages: 1,
      query: {},
      canMutateQuote,
    })
  );
}

async function quotesPdf(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Not found');
  const quote = await Quote.findById(req.params.id).lean();
  if (!quote) return res.status(404).send('Not found');
  try {
    const buf = await quoteToPdfBuffer(quote);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quote-${quote._id}.pdf"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error(e);
    req.flash('error', 'تعذر إنشاء ملف PDF');
    res.status(500).type('text/plain; charset=utf-8').send('تعذر إنشاء ملف PDF');
  }
}

async function quotesXlsx(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Not found');
  const quote = await Quote.findById(req.params.id).lean();
  if (!quote) return res.status(404).send('Not found');
  try {
    const wb = await quoteToWorkbook(quote);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="quote-${quote._id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    req.flash('error', 'تعذر إنشاء ملف Excel');
    res.redirect(`/quotes/${req.params.id}`);
  }
}

async function quotesEditForm(req, res) {
  const filter = quoteAccessFilter(req);
  if (!filter) {
    req.flash('error', 'المستند غير موجود');
    return res.redirect('/quotes');
  }
  const quote = await Quote.findOne(filter).populate('createdBy', 'fullName username').lean();
  if (!quote) {
    req.flash('error', 'المستند غير موجود أو ليس لديك صلاحية التعديل');
    return res.redirect('/quotes');
  }
  const settings = await getOrCreateSettings();
  const mode = quote.type === 'request' ? 'edit-request' : 'edit-stock';
  if (quote.type === 'from_stock') {
    quote.lines = await Promise.all(
      quote.lines.map(async (l) => {
        if (!l.inventoryItem) return { ...l, stockOnHandForMax: null };
        const inv = await InventoryItem.findById(l.inventoryItem).lean();
        return { ...l, stockOnHandForMax: inv ? inv.quantityOnHand : 0 };
      })
    );
  }
  res.render(
    'sections/quotes',
    shell({
      section: 'quotes',
      title: quote.type === 'request' ? 'تعديل طلب تسعير' : 'تعديل عرض السعر',
      mode,
      quote,
      quotes: [],
      page: 1,
      totalPages: 1,
      query: {},
      defaultQuoteNotes: settings.defaultQuoteNotes || '',
    })
  );
}

async function quotesUpdate(req, res) {
  const filter = quoteAccessFilter(req);
  if (!filter) {
    req.flash('error', 'المستند غير موجود');
    return res.redirect('/quotes');
  }
  const doc = await Quote.findOne(filter);
  if (!doc) {
    req.flash('error', 'المستند غير موجود أو ليس لديك صلاحية التعديل');
    return res.redirect('/quotes');
  }
  const id = req.params.id;
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect(`/quotes/${id}/edit`);
  }
  if (doc.type === 'request') {
    const parsed = parseQuoteLinesJson(req.body.linesJson, 'request');
    if (parsed.error) {
      req.flash('error', parsed.error);
      return res.redirect(`/quotes/${id}/edit`);
    }
    await Quote.updateOne(
      { _id: doc._id },
      {
        $set: {
          customerName: req.body.customerName.trim(),
          customerPhone: (req.body.customerPhone || '').trim(),
          lines: parsed.lines,
          subtotal: 0,
          total: 0,
          notes: (req.body.notes || '').trim(),
          vat14Applied: false,
          vat14Amount: 0,
          noticeDiscountApplied: false,
          noticeDiscountAmount: 0,
        },
      }
    );
    req.flash('success', 'تم حفظ التعديلات');
    return res.redirect(`/quotes/${id}`);
  }
  const parsed = parseQuoteLinesJson(req.body.linesJson, 'from_stock');
  if (parsed.error) {
    req.flash('error', parsed.error);
    return res.redirect(`/quotes/${id}/edit`);
  }
  for (const line of parsed.lines) {
    if (line.inventoryItem) {
      const item = await InventoryItem.findById(line.inventoryItem);
      if (!item) {
        req.flash('error', 'صنف غير موجود في المخزون');
        return res.redirect(`/quotes/${id}/edit`);
      }
      if (line.quantity > item.quantityOnHand) {
        req.flash('error', `الكمية المتاحة للصنف ${item.name} غير كافية`);
        return res.redirect(`/quotes/${id}/edit`);
      }
    }
  }
  let lineSum = 0;
  const lines = parsed.lines.map((l) => {
    const lineTotal = Number(l.quantity) * Number(l.price || 0);
    lineSum += lineTotal;
    return { ...l, itemCode: l.itemCode || '' };
  });
  const subtotal = Math.round(lineSum * 100) / 100;
  const { vat14Applied, noticeDiscountApplied } = parseVat14AndNoticeDiscount(req.body);
  const { vat14Amount, noticeDiscountAmount, finalTotal } = computeSubtotalAdjustments(
    subtotal,
    vat14Applied,
    noticeDiscountApplied
  );
  await Quote.updateOne(
    { _id: doc._id },
    {
      $set: {
        customerName: req.body.customerName.trim(),
        customerPhone: (req.body.customerPhone || '').trim(),
        lines,
        subtotal,
        vat14Applied,
        vat14Amount,
        noticeDiscountApplied,
        noticeDiscountAmount,
        total: finalTotal,
        notes: (req.body.notes || '').trim(),
      },
    }
  );
  req.flash('success', 'تم حفظ التعديلات');
  return res.redirect(`/quotes/${id}`);
}

async function quotesDelete(req, res) {
  const filter = quoteAccessFilter(req);
  if (!filter) {
    req.flash('error', 'المستند غير موجود');
    return res.redirect('/quotes');
  }
  const r = await Quote.deleteOne(filter);
  if (r.deletedCount === 0) {
    req.flash('error', 'تعذر الحذف');
    return res.redirect('/quotes');
  }
  req.flash('success', 'تم حذف بيان الأسعار');
  res.redirect('/quotes');
}

function parseSaleLinesJson(raw) {
  let lines;
  try {
    lines = JSON.parse(raw || '[]');
  } catch {
    return { error: 'بيانات الأسطر غير صالحة' };
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return { error: 'أضف سطراً واحداً على الأقل' };
  }
  const normalized = [];
  for (const line of lines) {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice ?? line.price);
    if (!Number.isFinite(quantity) || quantity < 1) return { error: 'الكمية غير صالحة' };
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: 'السعر غير صالح' };
    const invId = line.inventoryItem != null ? String(line.inventoryItem).trim() : '';
    if (invId && mongoose.isValidObjectId(invId)) {
      normalized.push({ fromStock: true, inventoryItem: invId, quantity, unitPrice });
    } else {
      const itemName = (line.itemName || '').trim();
      if (!itemName) return { error: 'اسم الصنف مطلوب في السطور خارج المخزن' };
      const itemCode = (line.itemCode || '').trim();
      normalized.push({
        fromStock: false,
        itemCode,
        itemName,
        quantity,
        unitPrice,
      });
    }
  }
  return { lines: normalized };
}

async function salesList(req, res) {
  const filter = {};
  if (req.session.role !== 'admin') filter.createdBy = req.session.userId;
  const q = (req.query.q || '').trim();
  if (q) {
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(esc, 'i');
    const or = [
      { customerName: rx },
      { disbursementNumber: rx },
      { customerNumber: rx },
      { paymentMethod: rx },
      { paymentNote: rx },
      { 'lines.itemName': rx },
      { 'lines.itemCode': rx },
    ];
    const compact = q.replace(/,/g, '').replace(/\s/g, '');
    if (/^\d+(\.\d{1,2})?$/.test(compact)) {
      const n = Number(compact);
      if (Number.isFinite(n)) or.push({ total: n });
    }
    filter.$or = or;
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const [sales, total] = await Promise.all([
    Sale.find(filter)
      .sort({ soldAt: -1 })
      .skip((page - 1) * SALE_PAGE)
      .limit(SALE_PAGE)
      .populate('createdBy', 'fullName username')
      .lean(),
    Sale.countDocuments(filter),
  ]);
  res.render(
    'sections/sales',
    shell({
      section: 'sales',
      title: 'المبيعات',
      mode: 'list',
      sales,
      page,
      totalPages: Math.max(1, Math.ceil(total / SALE_PAGE)),
      isAdmin: req.session.role === 'admin',
      sale: null,
      searchQ: q,
      listUserId: req.session.userId,
    })
  );
}

/** Next إذن صرف: max numeric value among existing sales + 1 (digits only), else 1. */
async function computeNextDisbursementNumber() {
  const docs = await Sale.find({
    disbursementNumber: { $exists: true, $nin: [null, ''] },
  })
    .select('disbursementNumber')
    .lean();
  let max = 0;
  for (const d of docs) {
    const t = String(d.disbursementNumber || '').trim();
    if (!/^\d+$/.test(t)) continue;
    const n = parseInt(t, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

async function salesNewForm(req, res, next) {
  let suggestedDisbursementNumber = '1';
  try {
    suggestedDisbursementNumber = await computeNextDisbursementNumber();
    res.render(
      'sections/sales',
      shell({
        section: 'sales',
        title: 'تسجيل مبيعة',
        mode: 'new',
        sales: [],
        page: 1,
        totalPages: 1,
        isAdmin: req.session.role === 'admin',
        sale: null,
        searchQ: '',
        suggestedDisbursementNumber,
        salePaymentMethods: SALE_PAYMENT_METHODS,
      })
    );
  } catch (e) {
    next(e);
  }
}

async function salesCreate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect('/sales/new');
  }
  const parsed = parseSaleLinesJson(req.body.linesJson);
  if (parsed.error) {
    req.flash('error', parsed.error);
    return res.redirect('/sales/new');
  }
  const decremented = [];
  try {
    const saleLines = [];
    let total = 0;
    for (const line of parsed.lines) {
      if (line.fromStock) {
        const updated = await InventoryItem.findOneAndUpdate(
          { _id: line.inventoryItem, quantityOnHand: { $gte: line.quantity } },
          { $inc: { quantityOnHand: -line.quantity } },
          { new: true }
        );
        if (!updated) {
          for (const d of decremented.reverse()) {
            await InventoryItem.updateOne({ _id: d.id }, { $inc: { quantityOnHand: d.qty } });
          }
          req.flash('error', 'الكمية غير كافية في المخزون لأحد الأصناف');
          return res.redirect('/sales/new');
        }
        decremented.push({ id: line.inventoryItem, qty: line.quantity });
        const lineTotal = line.quantity * line.unitPrice;
        total += lineTotal;
        saleLines.push({
          fromStock: true,
          inventoryItem: line.inventoryItem,
          itemCode: updated.itemCode,
          itemName: updated.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal,
        });
      } else {
        const lineTotal = line.quantity * line.unitPrice;
        total += lineTotal;
        saleLines.push({
          fromStock: false,
          inventoryItem: null,
          itemCode: line.itemCode || '—',
          itemName: line.itemName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal,
        });
      }
    }
    const subtotal = Math.round(total * 100) / 100;
    const { vat14Applied, noticeDiscountApplied } = parseVat14AndNoticeDiscount(req.body);
    const { vat14Amount, noticeDiscountAmount, finalTotal } = computeSubtotalAdjustments(
      subtotal,
      vat14Applied,
      noticeDiscountApplied
    );
    await Sale.create({
      customerName: req.body.customerName.trim(),
      disbursementNumber: (req.body.disbursementNumber || '').trim(),
      customerNumber: (req.body.customerNumber || '').trim(),
      paymentMethod: req.body.paymentMethod.trim(),
      lines: saleLines,
      subtotal,
      vat14Applied,
      vat14Amount,
      noticeDiscountApplied,
      noticeDiscountAmount,
      total: finalTotal,
      soldAt: new Date(),
      paymentNote: (req.body.paymentNote || '').trim(),
      createdBy: req.session.userId,
    });
    const anyStock = saleLines.some((l) => l.fromStock);
    req.flash(
      'success',
      anyStock ? 'تم تسجيل المبيعة وخصم أصناف المخزن' : 'تم تسجيل المبيعة (بدون خصم من المخزن)'
    );
    res.redirect('/sales');
  } catch (e) {
    console.error(e);
    for (const d of decremented.reverse()) {
      try {
        await InventoryItem.updateOne({ _id: d.id }, { $inc: { quantityOnHand: d.qty } });
      } catch (_) {}
    }
    req.flash('error', 'حدث خطأ أثناء حفظ المبيعة');
    res.redirect('/sales/new');
  }
}

async function salesEditForm(req, res) {
  const filter = saleAccessFilter(req);
  if (!filter) {
    req.flash('error', 'المبيعة غير موجودة');
    return res.redirect('/sales');
  }
  const sale = await Sale.findOne(filter).populate('createdBy', 'fullName username').lean();
  if (!sale) {
    req.flash('error', 'المبيعة غير موجودة أو ليس لديك صلاحية التعديل');
    return res.redirect('/sales');
  }
  const linesAug = await Promise.all(
    sale.lines.map(async (line) => {
      if (line.fromStock && line.inventoryItem) {
        const inv = await InventoryItem.findById(line.inventoryItem).lean();
        return {
          ...line,
          maxQtyForEdit: inv ? inv.quantityOnHand + line.quantity : line.quantity,
        };
      }
      return { ...line, maxQtyForEdit: null };
    })
  );
  sale.lines = linesAug;
  const soldAtLocal = new Date(sale.soldAt);
  const pad = (n) => String(n).padStart(2, '0');
  const soldAtInputValue = `${soldAtLocal.getFullYear()}-${pad(soldAtLocal.getMonth() + 1)}-${pad(soldAtLocal.getDate())}T${pad(soldAtLocal.getHours())}:${pad(soldAtLocal.getMinutes())}`;
  res.render(
    'sections/sales',
    shell({
      section: 'sales',
      title: 'تعديل مبيعة',
      mode: 'edit',
      sale,
      sales: [],
      page: 1,
      totalPages: 1,
      isAdmin: req.session.role === 'admin',
      searchQ: '',
      salePaymentMethods: SALE_PAYMENT_METHODS,
      salePaymentDisplay: salePaymentLabel(sale.paymentMethod),
      soldAtInputValue,
    })
  );
}

async function salesUpdate(req, res) {
  const filter = saleAccessFilter(req);
  if (!filter) {
    req.flash('error', 'المبيعة غير موجودة');
    return res.redirect('/sales');
  }
  const sale = await Sale.findOne(filter);
  if (!sale) {
    req.flash('error', 'المبيعة غير موجودة أو ليس لديك صلاحية التعديل');
    return res.redirect('/sales');
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect(`/sales/${req.params.id}/edit`);
  }
  const parsed = parseSaleLinesJson(req.body.linesJson);
  if (parsed.error) {
    req.flash('error', parsed.error);
    return res.redirect(`/sales/${req.params.id}/edit`);
  }
  const dNum = req.body.disbursementNumber.trim();
  const dup = await Sale.findOne({
    disbursementNumber: dNum,
    _id: { $ne: sale._id },
  }).lean();
  if (dup) {
    req.flash('error', 'رقم إذن الصرف مستخدم في مبيعة أخرى');
    return res.redirect(`/sales/${sale._id}/edit`);
  }
  const built = await buildSaleLinesFromParsed(parsed);
  if (built.error) {
    req.flash('error', built.error);
    return res.redirect(`/sales/${sale._id}/edit`);
  }
  const { saleLines, subtotal } = built;
  const oldLinesSnapshot = sale.lines.map((l) => ({
    fromStock: l.fromStock,
    inventoryItem: l.inventoryItem,
    quantity: l.quantity,
  }));
  let deltaResult = await applySaleStockDelta(oldLinesSnapshot, saleLines);
  if (deltaResult.error) {
    req.flash('error', deltaResult.error);
    return res.redirect(`/sales/${sale._id}/edit`);
  }
  const { vat14Applied, noticeDiscountApplied } = parseVat14AndNoticeDiscount(req.body);
  const { vat14Amount, noticeDiscountAmount, finalTotal } = computeSubtotalAdjustments(
    subtotal,
    vat14Applied,
    noticeDiscountApplied
  );
  let soldAt = sale.soldAt;
  if ((req.body.soldAt || '').trim()) {
    const d = new Date(req.body.soldAt);
    if (!Number.isNaN(d.getTime())) soldAt = d;
  }
  try {
    sale.customerName = req.body.customerName.trim();
    sale.disbursementNumber = dNum;
    sale.customerNumber = (req.body.customerNumber || '').trim();
    sale.paymentMethod = req.body.paymentMethod.trim();
    sale.paymentNote = (req.body.paymentNote || '').trim();
    sale.lines = saleLines;
    sale.subtotal = subtotal;
    sale.vat14Applied = vat14Applied;
    sale.vat14Amount = vat14Amount;
    sale.noticeDiscountApplied = noticeDiscountApplied;
    sale.noticeDiscountAmount = noticeDiscountAmount;
    sale.total = finalTotal;
    sale.soldAt = soldAt;
    await sale.save();
  } catch (e) {
    console.error(e);
    try {
      await applySaleStockDelta(saleLines, oldLinesSnapshot);
    } catch (_) {}
    req.flash('error', 'تعذر حفظ المبيعة');
    return res.redirect(`/sales/${sale._id}/edit`);
  }
  req.flash('success', 'تم حفظ تعديلات المبيعة');
  res.redirect(`/sales/${sale._id}`);
}

async function salesDelete(req, res) {
  const filter = saleAccessFilter(req);
  if (!filter) {
    req.flash('error', 'المبيعة غير موجودة');
    return res.redirect('/sales');
  }
  const sale = await Sale.findOne(filter);
  if (!sale) {
    req.flash('error', 'المبيعة غير موجودة أو ليس لديك صلاحية التعديل');
    return res.redirect('/sales');
  }
  for (const line of sale.lines) {
    if (line.fromStock && line.inventoryItem) {
      try {
        await InventoryItem.updateOne(
          { _id: line.inventoryItem },
          { $inc: { quantityOnHand: line.quantity } }
        );
      } catch (e) {
        console.error(e);
      }
    }
  }
  await Sale.deleteOne({ _id: sale._id });
  req.flash('success', 'تم حذف المبيعة وإرجاع كميات المخزن للبنود المرتبطة');
  res.redirect('/sales');
}

async function salesShow(req, res) {
  const filter = { _id: req.params.id };
  if (req.session.role !== 'admin') filter.createdBy = req.session.userId;
  const sale = await Sale.findOne(filter).populate('createdBy', 'fullName username').lean();
  if (!sale) {
    req.flash('error', 'المبيعة غير موجودة');
    return res.redirect('/sales');
  }
  const createdId = sale.createdBy && sale.createdBy._id ? String(sale.createdBy._id) : String(sale.createdBy || '');
  const canMutateSale =
    req.session.role === 'admin' || createdId === String(req.session.userId);
  res.render(
    'sections/sales',
    shell({
      section: 'sales',
      title: 'تفاصيل المبيعة',
      mode: 'show',
      sale,
      sales: [],
      page: 1,
      totalPages: 1,
      isAdmin: req.session.role === 'admin',
      searchQ: '',
      salePaymentMethods: SALE_PAYMENT_METHODS,
      salePaymentDisplay: salePaymentLabel(sale.paymentMethod),
      canMutateSale,
    })
  );
}

async function salesPdf(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Not found');
  const filter = { _id: req.params.id };
  if (req.session.role !== 'admin') filter.createdBy = req.session.userId;
  const sale = await Sale.findOne(filter).lean();
  if (!sale) return res.status(404).send('Not found');
  try {
    const buf = await saleToPdfBuffer(sale);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sale-${sale._id}.pdf"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error(e);
    req.flash('error', 'تعذر إنشاء ملف PDF');
    res.status(500).type('text/plain; charset=utf-8').send('تعذر إنشاء ملف PDF');
  }
}

async function settingsShow(req, res) {
  const settings = await getOrCreateSettings();
  res.render(
    'sections/settings',
    shell({
      section: 'settings',
      title: 'إعدادات الشركة',
      settings,
    })
  );
}

async function settingsUpdate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect('/settings');
  }
  const settings = await getOrCreateSettings();
  settings.companyName = (req.body.companyName || '').trim() || 'DEUOF LIGHT';
  settings.companyNameAr = (req.body.companyNameAr || '').trim();
  settings.defaultQuoteNotes = (req.body.defaultQuoteNotes || '').trim();
  settings.address = (req.body.address || '').trim();
  settings.phone = (req.body.phone || '').trim();
  if (req.file) {
    if (settings.logoPath) {
      const oldPath = path.join(__dirname, '../../public', settings.logoPath.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (_) {}
      }
    }
    settings.logoPath = `/uploads/${req.file.filename}`;
  }
  await settings.save();
  req.flash('success', 'تم حفظ الإعدادات');
  res.redirect('/settings');
}

async function reportsRevenue(req, res) {
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  to.setHours(23, 59, 59, 999);

  const [totalAgg, byMonth, byDay, countSales] = await Promise.all([
    Sale.aggregate([
      { $match: { soldAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Sale.aggregate([
      { $match: { soldAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { y: { $year: '$soldAt' }, m: { $month: '$soldAt' } },
          total: { $sum: '$total' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]),
    Sale.aggregate([
      { $match: { soldAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: {
            y: { $year: '$soldAt' },
            m: { $month: '$soldAt' },
            d: { $dayOfMonth: '$soldAt' },
          },
          total: { $sum: '$total' },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1 } },
    ]),
    Sale.countDocuments({ soldAt: { $gte: from, $lte: to } }),
  ]);

  const totalRevenue = totalAgg[0]?.total ?? 0;
  const chartMonths = byMonth.map((x) => ({
    label: `${x._id.y}-${String(x._id.m).padStart(2, '0')}`,
    total: x.total,
    count: x.count,
  }));

  res.render(
    'sections/reports',
    shell({
      section: 'reports',
      title: 'تقارير الإيرادات',
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totalRevenue,
      countSales,
      byMonth,
      byDay,
      chartMonthsJson: JSON.stringify(chartMonths),
    })
  );
}

module.exports = {
  dashboard,
  inventoryList,
  inventorySearchJson,
  inventoryNewForm,
  inventoryCreate,
  inventoryItemDetails,
  inventoryAddStock,
  inventoryEditForm,
  inventoryUpdate,
  inventoryRemove,
  quotesList,
  quotesNewRequest,
  quotesNewFromStock,
  quotesCreateRequest,
  quotesCreateFromStock,
  quotesShow,
  quotesPdf,
  quotesXlsx,
  quotesEditForm,
  quotesUpdate,
  quotesDelete,
  salesList,
  salesNewForm,
  salesCreate,
  salesEditForm,
  salesUpdate,
  salesDelete,
  salesShow,
  salesPdf,
  settingsShow,
  settingsUpdate,
  reportsRevenue,
};
