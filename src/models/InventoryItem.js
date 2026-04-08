const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    itemCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    band: { type: String, default: '', trim: true },
    quantityOnHand: { type: Number, required: true, min: 0, default: 0 },
    unitPrice: { type: Number, min: 0, default: 0 },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

inventoryItemSchema.index({ name: 'text', itemCode: 'text', band: 'text' });
inventoryItemSchema.index({ name: 1 });
inventoryItemSchema.index({ band: 1 });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
