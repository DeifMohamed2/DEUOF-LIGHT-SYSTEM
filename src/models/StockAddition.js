const mongoose = require('mongoose');

const stockAdditionSchema = new mongoose.Schema(
  {
    inventoryItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem',
      required: true,
      index: true,
    },
    addedAt: { type: Date, required: true },
    source: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

stockAdditionSchema.index({ inventoryItem: 1, addedAt: -1 });

module.exports = mongoose.model('StockAddition', stockAdditionSchema);
