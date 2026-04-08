const CompanySettings = require('../models/CompanySettings');

async function getOrCreateSettings() {
  let doc = await CompanySettings.findOne({ singletonKey: 'default' });
  if (!doc) {
    doc = await CompanySettings.create({
      singletonKey: 'default',
      companyName: 'DEUOF LIGHT',
    });
  }
  return doc;
}

module.exports = { getOrCreateSettings };
