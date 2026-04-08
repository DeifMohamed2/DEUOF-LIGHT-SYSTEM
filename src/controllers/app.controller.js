const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const InventoryItem = require('../models/InventoryItem');
const Quote = require('../models/Quote');
const Sale = require('../models/Sale');
const { getOrCreateSettings } = require('../services/companySettings');
const { quoteToPdfBuffer } = require('../services/quotePdf');
const { quoteToWorkbook } = require('../services/quoteExcel');

const INV_PAGE = 15;
const SALE_PAGE = 20;
const QUOTE_LIMIT = 20;

function shell(locals) {
  return { layout: 'layouts/app', ...locals };
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
  let total = 0;
  const lines = parsed.lines.map((l) => {
    const lineTotal = Number(l.quantity) * Number(l.price || 0);
    total += lineTotal;
    return { ...l, itemCode: l.itemCode || '' };
  });
  await Quote.create({
    type: 'from_stock',
    customerName: req.body.customerName.trim(),
    customerPhone: (req.body.customerPhone || '').trim(),
    lines,
    subtotal: total,
    total,
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
    if (!line.inventoryItem || !mongoose.isValidObjectId(line.inventoryItem)) {
      return { error: 'معرف الصنف غير صالح' };
    }
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(quantity) || quantity < 1) return { error: 'الكمية غير صالحة' };
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: 'السعر غير صالح' };
    normalized.push({ inventoryItem: line.inventoryItem, quantity, unitPrice });
  }
  return { lines: normalized };
}

async function salesList(req, res) {
  const filter = {};
  if (req.session.role !== 'admin') filter.createdBy = req.session.userId;
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
    })
  );
}

function salesNewForm(req, res) {
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
    })
  );
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
        inventoryItem: line.inventoryItem,
        itemCode: updated.itemCode,
        itemName: updated.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal,
      });
    }
    await Sale.create({
      lines: saleLines,
      total,
      soldAt: new Date(),
      paymentNote: (req.body.paymentNote || '').trim(),
      createdBy: req.session.userId,
    });
    req.flash('success', 'تم تسجيل المبيعة وتحديث المخزون');
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

async function salesShow(req, res) {
  const filter = { _id: req.params.id };
  if (req.session.role !== 'admin') filter.createdBy = req.session.userId;
  const sale = await Sale.findOne(filter).populate('createdBy', 'fullName username').lean();
  if (!sale) {
    req.flash('error', 'المبيعة غير موجودة');
    return res.redirect('/sales');
  }
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
    })
  );
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
  salesList,
  salesNewForm,
  salesCreate,
  salesShow,
  settingsShow,
  settingsUpdate,
  reportsRevenue,
};
