const express = require('express');
const rateLimit = require('express-rate-limit');

const { requireAuth, requireAdmin } = require('../middleware/auth');
const { uploadLogo } = require('../middleware/uploadLogo');
const auth = require('../controllers/auth.controller');
const appCtrl = require('../controllers/app.controller');
const usersCtrl = require('../controllers/users.controller');
const {
  loginRules,
  itemRules,
  settingsRules,
  quoteCustomerValidators,
  saleValidators,
  stockAdditionRules,
  userCreateRules,
  userUpdateRules,
} = require('../validators');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'محاولات كثيرة، حاول لاحقاً',
  standardHeaders: true,
  legacyHeaders: false,
});

const authRouter = express.Router();
authRouter.get('/login', auth.loginForm);
authRouter.post('/login', loginLimiter, loginRules, auth.login);
authRouter.post('/logout', auth.logout);

const main = express.Router();
main.use(requireAuth);

main.get('/settings', requireAdmin, appCtrl.settingsShow);
main.post('/settings', requireAdmin, uploadLogo.single('logo'), settingsRules, appCtrl.settingsUpdate);

main.get('/', (req, res) => res.redirect('/dashboard'));
main.get('/dashboard', appCtrl.dashboard);

main.get('/api/inventory/search', appCtrl.inventorySearchJson);

main.get('/inventory', appCtrl.inventoryList);
main.get('/inventory/new', appCtrl.inventoryNewForm);
main.post('/inventory', itemRules, appCtrl.inventoryCreate);
main.get('/inventory/:id/details', appCtrl.inventoryItemDetails);
main.post('/inventory/:id/add-stock', stockAdditionRules, appCtrl.inventoryAddStock);
main.get('/inventory/:id/edit', appCtrl.inventoryEditForm);
main.post('/inventory/:id/delete', requireAdmin, appCtrl.inventoryRemove);
main.post('/inventory/:id', itemRules, appCtrl.inventoryUpdate);

main.get('/quotes', appCtrl.quotesList);
main.get('/quotes/new/request', appCtrl.quotesNewRequest);
main.post('/quotes/new/request', quoteCustomerValidators, appCtrl.quotesCreateRequest);
main.get('/quotes/new/from-stock', appCtrl.quotesNewFromStock);
main.post('/quotes/new/from-stock', quoteCustomerValidators, appCtrl.quotesCreateFromStock);
/* More specific paths first — otherwise /quotes/:id matches id ending in .xlsx */
main.get('/quotes/:id/pdf', appCtrl.quotesPdf);
main.get('/quotes/:id.xlsx', appCtrl.quotesXlsx);
main.get('/quotes/:id', appCtrl.quotesShow);

main.get('/sales', appCtrl.salesList);
main.get('/sales/new', appCtrl.salesNewForm);
main.post('/sales', saleValidators, appCtrl.salesCreate);
main.get('/sales/:id/pdf', appCtrl.salesPdf);
main.get('/sales/:id', appCtrl.salesShow);

main.get('/reports/revenue', requireAdmin, appCtrl.reportsRevenue);

main.get('/users', requireAdmin, usersCtrl.usersList);
main.post('/users', requireAdmin, userCreateRules, usersCtrl.usersCreate);
main.get('/users/:id', requireAdmin, usersCtrl.usersShow);
main.post('/users/:id', requireAdmin, userUpdateRules, usersCtrl.usersUpdate);
main.post('/users/:id/delete', requireAdmin, usersCtrl.usersDelete);

const router = express.Router();
router.use(authRouter);
router.use(main);

module.exports = { router };
