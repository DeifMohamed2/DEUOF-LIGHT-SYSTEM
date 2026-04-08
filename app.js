require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');

const { connectDb } = require('./src/config/db');
const { attachUserLocals } = require('./src/middleware/auth');
const {
  PRICED_QUOTE_VAT_NOTE,
  PRICED_QUOTE_VAT_NOTE_PREFIX,
} = require('./src/constants/quotePricing');
const { router } = require('./src/routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

const sessionCookieSecure =
  process.env.SESSION_COOKIE_SECURE === 'true' ||
  (process.env.TRUST_HTTPS_PROXY === 'true' && process.env.NODE_ENV === 'production');

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/app');

if (process.env.TRUST_HTTPS_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    name: 'deuof.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/deuof_light',
      ttl: 14 * 24 * 60 * 60,
    }),
    cookie: {
      httpOnly: true,
      secure: sessionCookieSecure,
      sameSite: 'lax',
      maxAge: 14 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(flash());
app.use(attachUserLocals);
app.use((req, res, next) => {
  res.locals.successFlash = req.flash('success');
  res.locals.errorFlash = req.flash('error');
  res.locals.pricedQuoteVatNote = PRICED_QUOTE_VAT_NOTE;
  res.locals.pricedQuoteVatNotePrefix = PRICED_QUOTE_VAT_NOTE_PREFIX;
  next();
});

app.use(router);

app.use((err, req, res, next) => {
  if (err.message === 'نوع الملف غير مدعوم') {
    req.flash('error', err.message);
    return res.redirect('/settings');
  }
  console.error(err);
  res.status(500).render('error', {
    title: 'خطأ',
    message: process.env.NODE_ENV === 'production' ? 'حدث خطأ' : err.message,
    layout: false,
  });
});

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'غير موجود',
    message: 'الصفحة غير موجودة',
    layout: false,
  });
});

connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`DEUOF LIGHT — افتح المتصفح على: http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('MongoDB connection failed:', e.message);
    process.exit(1);
  });
