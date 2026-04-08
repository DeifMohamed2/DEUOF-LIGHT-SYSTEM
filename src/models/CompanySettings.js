const mongoose = require('mongoose');

const companySettingsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: 'default', unique: true },
    companyName: { type: String, default: 'DEUOF LIGHT' },
    companyNameAr: { type: String, default: '', trim: true },
    defaultQuoteNotes: { type: String, default: '', trim: true },
    logoPath: { type: String, default: '' },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompanySettings', companySettingsSchema);
