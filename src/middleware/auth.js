function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'يجب تسجيل الدخول أولاً');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    req.flash('error', 'يجب تسجيل الدخول أولاً');
    return res.redirect('/login');
  }
  if (req.session.role !== 'admin') {
    req.flash('error', 'غير مصرح لك بهذا القسم');
    return res.redirect('/dashboard');
  }
  next();
}

function attachUserLocals(req, res, next) {
  res.locals.currentUser = req.session.userId
    ? {
        id: req.session.userId,
        username: req.session.username,
        fullName: req.session.fullName,
        role: req.session.role,
      }
    : null;
  res.locals.isAdmin = req.session.role === 'admin';
  next();
}

module.exports = { requireAuth, requireAdmin, attachUserLocals };
