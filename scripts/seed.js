require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const CompanySettings = require('../src/models/CompanySettings');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/deuof_light';
  await mongoose.connect(uri);
  const hash = await bcrypt.hash('Admin@123', 10);
  await User.findOneAndUpdate(
    { username: 'admin' },
    {
      username: 'admin',
      passwordHash: hash,
      fullName: 'مدير النظام',
      role: 'admin',
      isActive: true,
    },
    { upsert: true }
  );
  const userHash = await bcrypt.hash('User@123', 10);
  await User.findOneAndUpdate(
    { username: 'user' },
    {
      username: 'user',
      passwordHash: userHash,
      fullName: 'موظف',
      role: 'user',
      isActive: true,
    },
    { upsert: true }
  );
  await CompanySettings.findOneAndUpdate(
    { singletonKey: 'default' },
    { singletonKey: 'default', companyName: 'DEUOF LIGHT' },
    { upsert: true }
  );
  console.log('Seed OK. admin / Admin@123 — user / User@123');
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
