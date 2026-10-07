const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);
mongoose.set('bufferTimeoutMS', 4000); // fail fast (-> 503) instead of hanging when the DB is down

async function connectDB(uri = env.mongoUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  console.log(`[db] connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  // Make sure indexes (incl. the partial unique one on batches) exist.
  await mongoose.syncIndexes();
}

module.exports = { connectDB };
