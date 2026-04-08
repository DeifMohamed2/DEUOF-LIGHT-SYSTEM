const { body } = require('express-validator');
const { SALE_PAYMENT_VALUES } = require('../constants/salePayment');

const loginRules = [
  body('username').trim().notEmpty().withMessage('اسم المستخدم مطلوب'),
  body('password').notEmpty().withMessage('كلمة المرور مطلوبة'),
];

const itemRules = [
  body('itemCode').trim().notEmpty().withMessage('كود الصنف مطلوب'),
  body('name').trim().notEmpty().withMessage('اسم الصنف مطلوب'),
  body('band').optional().trim().isLength({ max: 500 }).withMessage('حقل البند طويل جداً'),
  body('quantityOnHand')
    .toFloat()
    .isFloat({ min: 0 })
    .withMessage('الكمية يجب أن تكون رقماً موجباً'),
  body('unitPrice')
    .toFloat()
    .isFloat({ min: 0 })
    .withMessage('السعر يجب أن يكون رقماً موجباً'),
];

const settingsRules = [
  body('companyName').trim().notEmpty().withMessage('اسم الشركة مطلوب'),
  body('companyNameAr').optional().trim().isLength({ max: 500 }),
  body('defaultQuoteNotes').optional().trim().isLength({ max: 3000 }),
  body('address').optional().trim(),
  body('phone').optional().trim(),
];

const quoteCustomerValidators = [
  body('customerName').trim().notEmpty().withMessage('اسم العميل مطلوب'),
  body('customerPhone').optional().trim(),
  body('linesJson').notEmpty().withMessage('الأسطر مطلوبة'),
  body('notes').optional().trim().isLength({ max: 3000 }).withMessage('الملاحظات طويلة جداً'),
];

const saleValidators = [
  body('customerName').trim().notEmpty().withMessage('اسم العميل مطلوب'),
  body('disbursementNumber')
    .trim()
    .notEmpty()
    .withMessage('رقم إذن الصرف مطلوب')
    .isLength({ max: 200 }),
  body('customerNumber').optional().trim().isLength({ max: 200 }),
  body('paymentMethod')
    .trim()
    .notEmpty()
    .withMessage('طريقة الدفع مطلوبة')
    .isIn(SALE_PAYMENT_VALUES)
    .withMessage('طريقة دفع غير صالحة'),
  body('paymentNote').optional().trim().isLength({ max: 2000 }),
  body('linesJson').notEmpty().withMessage('الأسطر مطلوبة'),
];

const stockAdditionRules = [
  body('addedAt').trim().notEmpty().withMessage('تاريخ الإضافة مطلوب'),
  body('source').trim().notEmpty().withMessage('المصدر (من أين) مطلوب').isLength({ max: 500 }),
  body('quantity').toInt().isInt({ min: 1 }).withMessage('الكمية يجب أن تكون عدداً صحيحاً ≥ 1'),
];

module.exports = {
  loginRules,
  itemRules,
  settingsRules,
  quoteCustomerValidators,
  saleValidators,
  stockAdditionRules,
};
