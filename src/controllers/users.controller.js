const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const Quote = require('../models/Quote');
const Sale = require('../models/Sale');

function shell(locals) {
  return { layout: 'layouts/app', ...locals };
}

async function loadUserStatsMap() {
  const [quoteAgg, saleAgg] = await Promise.all([
    Quote.aggregate([{ $group: { _id: '$createdBy', count: { $sum: 1 } } }]),
    Sale.aggregate([{ $group: { _id: '$createdBy', count: { $sum: 1 } } }]),
  ]);
  const quotesByUser = new Map(
    quoteAgg.map((x) => [String(x._id), x.count]).filter(([id]) => id !== 'null')
  );
  const salesByUser = new Map(
    saleAgg.map((x) => [String(x._id), x.count]).filter(([id]) => id !== 'null')
  );
  return { quotesByUser, salesByUser };
}

async function countAdmins() {
  return User.countDocuments({ role: 'admin', isActive: true });
}

async function usersList(req, res) {
  const users = await User.find().sort({ createdAt: -1 }).lean();
  const { quotesByUser, salesByUser } = await loadUserStatsMap();
  const rows = users.map((u) => {
    const id = String(u._id);
    delete u.passwordHash;
    return {
      ...u,
      quotesCount: quotesByUser.get(id) || 0,
      salesCount: salesByUser.get(id) || 0,
    };
  });
  res.render(
    'sections/users',
    shell({
      section: 'users',
      title: 'المستخدمون',
      mode: 'list',
      users: rows,
      currentSessionUserId: req.session.userId,
    })
  );
}

async function usersShow(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    req.flash('error', 'مستخدم غير موجود');
    return res.redirect('/users');
  }
  const user = await User.findById(req.params.id).lean();
  if (!user) {
    req.flash('error', 'مستخدم غير موجود');
    return res.redirect('/users');
  }
  delete user.passwordHash;
  const { quotesByUser, salesByUser } = await loadUserStatsMap();
  const id = String(user._id);
  user.quotesCount = quotesByUser.get(id) || 0;
  user.salesCount = salesByUser.get(id) || 0;
  res.render(
    'sections/users',
    shell({
      section: 'users',
      title: user.fullName || user.username,
      mode: 'show',
      user,
      users: [],
      currentSessionUserId: req.session.userId,
    })
  );
}

async function usersCreate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect('/users');
  }
  const username = req.body.username.trim().toLowerCase();
  const exists = await User.findOne({ username });
  if (exists) {
    req.flash('error', 'اسم المستخدم مستخدم مسبقاً');
    return res.redirect('/users');
  }
  const passwordHash = await bcrypt.hash(req.body.password, 10);
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const isActive = req.body.isActive === '0' || req.body.isActive === 'false' ? false : true;
  await User.create({
    username,
    passwordHash,
    fullName: (req.body.fullName || '').trim(),
    role,
    isActive,
  });
  req.flash('success', 'تم إنشاء المستخدم');
  res.redirect('/users');
}

async function usersUpdate(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    req.flash('error', 'مستخدم غير موجود');
    return res.redirect('/users');
  }
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect(`/users/${req.params.id}`);
  }
  const user = await User.findById(req.params.id);
  if (!user) {
    req.flash('error', 'مستخدم غير موجود');
    return res.redirect('/users');
  }
  const sessionId = req.session.userId;
  const isSelf = user._id.toString() === sessionId;
  const newRole = req.body.role === 'admin' ? 'admin' : 'user';
  const newActive =
    req.body.isActive === '0' || req.body.isActive === 'false' ? false : true;

  if (isSelf && !newActive) {
    req.flash('error', 'لا يمكنك تعطيل حسابك الحالي');
    return res.redirect(`/users/${user._id}`);
  }
  if (isSelf && newRole !== 'admin') {
    const admins = await countAdmins();
    if (user.role === 'admin' && admins <= 1) {
      req.flash('error', 'لا يمكن إزالة صلاحية المدير — يجب وجود مدير نشط آخر');
      return res.redirect(`/users/${user._id}`);
    }
  }
  if (!isSelf && user.role === 'admin' && newRole !== 'admin') {
    const admins = await countAdmins();
    if (admins <= 1) {
      req.flash('error', 'لا يمكن إزالة آخر مدير نشط في النظام');
      return res.redirect(`/users/${user._id}`);
    }
  }

  user.fullName = (req.body.fullName || '').trim();
  user.role = newRole;
  user.isActive = newActive;

  const newPassword = (req.body.password || '').trim();
  if (newPassword) {
    user.passwordHash = await bcrypt.hash(newPassword, 10);
  }
  await user.save();

  if (isSelf) {
    req.session.fullName = user.fullName || user.username;
    req.session.role = user.role;
  }

  req.flash('success', 'تم حفظ التعديلات');
  res.redirect(`/users/${user._id}`);
}

async function usersDelete(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    req.flash('error', 'مستخدم غير موجود');
    return res.redirect('/users');
  }
  const user = await User.findById(req.params.id);
  if (!user) {
    req.flash('error', 'مستخدم غير موجود');
    return res.redirect('/users');
  }
  if (user._id.toString() === req.session.userId) {
    req.flash('error', 'لا يمكنك حذف حسابك الحالي');
    return res.redirect('/users');
  }
  if (user.role === 'admin' && user.isActive) {
    const admins = await countAdmins();
    if (admins <= 1) {
      req.flash('error', 'لا يمكن حذف آخر مدير نشط في النظام');
      return res.redirect('/users');
    }
  }
  await User.deleteOne({ _id: user._id });
  req.flash('success', 'تم حذف المستخدم');
  res.redirect('/users');
}

module.exports = {
  usersList,
  usersShow,
  usersCreate,
  usersUpdate,
  usersDelete,
};
