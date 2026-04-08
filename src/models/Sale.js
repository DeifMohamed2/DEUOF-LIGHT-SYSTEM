const mongoose = require('mongoose');

const saleLineSchema = new mongoose.Schema(
  {
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
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
    lines: { type: [saleLineSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    soldAt: { type: Date, default: Date.now },
    paymentNote: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

saleSchema.index({ soldAt: -1 });
saleSchema.index({ createdBy: 1, soldAt: -1 });

module.exports = mongoose.model('Sale', saleSchema);
