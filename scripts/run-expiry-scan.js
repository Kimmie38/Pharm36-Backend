// npm run scan:expiry -> run the daily expiry scan once, right now (handy for testing / external cron)
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const { runExpiryScan } = require('../src/jobs/expiryScan');

(async () => {
  await connectDB();
  await runExpiryScan();
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
