const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema(
  {
    receiptNumber: { type: Number, required: true, unique: true, index: true },
    issuedAt: { type: Date, required: true },
    receivedFrom: { type: String, trim: true, default: '' },
    amountWords: { type: String, trim: true, default: '' },
    cashAmount: { type: Number, min: 0, default: 0 },
    chequeAmount: { type: Number, min: 0, default: 0 },
    bankName: { type: String, trim: true, default: '' },
    customerName: { type: String, trim: true, default: '' },
    chequeNumber: { type: String, trim: true, default: '' },
    chequeDate: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Receipt', receiptSchema);
