const mongoose = require('mongoose');

const quoteLineSchema = new mongoose.Schema(
  {
    itemCode: { type: String, default: '', trim: true },
    itemName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    price: { type: Number, min: 0, default: null },
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
  },
  { _id: false }
);

const quoteSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['request', 'from_stock'], required: true },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, trim: true, default: '' },
    lines: { type: [quoteLineSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    vat14Applied: { type: Boolean, default: false },
    vat14Amount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Quote', quoteSchema);
