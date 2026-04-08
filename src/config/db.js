const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const Sale = require('../models/Sale');
const StockAddition = require('../models/StockAddition');

async function connectDb() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/deuof_light';
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  await InventoryItem.syncIndexes();
  await Sale.syncIndexes();
  await StockAddition.syncIndexes();
}

module.exports = { connectDb };
