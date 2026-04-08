const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const User = require('../models/User');

async function loginForm(req, res) {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { title: 'تسجيل الدخول', layout: false });
}

async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array().map((e) => e.msg).join(' — '));
    return res.redirect('/login');
  }
  const { username, password } = req.body;
  const user = await User.findOne({ username: username.trim().toLowerCase(), isActive: true });
  if (!user) {
    req.flash('error', 'بيانات الدخول غير صحيحة');
    return res.redirect('/login');
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    req.flash('error', 'بيانات الدخول غير صحيحة');
    return res.redirect('/login');
  }
  req.session.userId = user._id.toString();
  req.session.username = user.username;
  req.session.fullName = user.fullName || user.username;
  req.session.role = user.role;
  req.flash('success', 'مرحباً بك');
  req.session.save((err) => {
    if (err) {
      console.error(err);
      req.flash('error', 'تعذر حفظ الجلسة، أعد المحاولة');
      return res.redirect('/login');
    }
    return res.redirect('/dashboard');
  });
}

function logout(req, res) {
  req.session.destroy(() => {
    res.redirect('/login');
  });
}

module.exports = { loginForm, login, logout };
