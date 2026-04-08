const mongoose = require('mongoose');

const saleLineSchema = new mongoose.Schema(
  {
    fromStock: { type: Boolean, default: true },
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
    itemCode: { type: String, required: true },
    itemName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    customerName: { type: String, trim: true, default: '' },
    disbursementNumber: { type: String, default: '', trim: true },
    customerNumber: { type: String, default: '', trim: true },
    paymentMethod: { type: String, default: '', trim: true },
    lines: { type: [saleLineSchema], required: true },
    subtotal: { type: Number, min: 0, default: 0 },
    vat14Applied: { type: Boolean, default: false },
    vat14Amount: { type: Number, min: 0, default: 0 },
    noticeDiscountApplied: { type: Boolean, default: false },
    noticeDiscountAmount: { type: Number, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    soldAt: { type: Date, default: Date.now },
    paymentNote: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

saleSchema.index({ soldAt: -1 });
saleSchema.index({ createdBy: 1, soldAt: -1 });
saleSchema.index({ customerName: 1 });

module.exports = mongoose.model('Sale', saleSchema);
