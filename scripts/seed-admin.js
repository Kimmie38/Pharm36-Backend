// npm run seed:admin  -> creates (or resets the password of) the council admin account from .env
const env = require('../src/config/env');
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/User');

(async () => {
  await connectDB();
  const email = (process.env.ADMIN_EMAIL || 'admin@pharm36.app').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) throw new Error('Set ADMIN_PASSWORD (min 8 chars) in .env');
  const council = process.env.ADMIN_COUNCIL || 'ALL';
  const passwordHash = await User.hashPassword(password);
  const existing = await User.findOne({ email });
  if (existing) {
    existing.passwordHash = passwordHash; existing.role = 'admin'; existing.council = council; existing.tokenVersion += 1;
    await existing.save();
    console.log(`Updated admin ${email} (council: ${council})`);
  } else {
    await User.create({ role: 'admin', name: 'Council Admin', email, passwordHash, council });
    console.log(`Created admin ${email} (council: ${council})`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
