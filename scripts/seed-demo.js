// npm run seed:demo -> loads the same demo data the mobile app shows from mockData.js, so the app looks
// identical once it talks to the API.   Login: adaeze.okonkwo@pharm36.app / Demo12345
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Batch = require('../src/models/Batch');
const SaleRecord = require('../src/models/SaleRecord');
const Listing = require('../src/models/Listing');
const { todayUTC, addDays } = require('../src/utils/dates');

const inDays = (n) => addDays(todayUTC(), n);
const D = (s) => new Date(`${s}T00:00:00.000Z`);

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  await connectDB();
  const passwordHash = await User.hashPassword('Demo12345');

  const upsertUser = (email, data) =>
    User.findOneAndUpdate({ email }, { ...data, email, passwordHash }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });

  const adaeze = await upsertUser('adaeze.okonkwo@pharm36.app', {
    role: 'professional', professionalType: 'pharmacist', name: 'Adaeze Okonkwo', storeName: 'Okonkwo Pharmacy',
    phone: '+2348035550142', location: 'Yaba, Lagos', state: 'Lagos', licenseNo: 'PCN/LG/2291',
    sections: ['general_pharmacy', 'hospital_pharmacy'], verifiedSections: ['general_pharmacy', 'hospital_pharmacy'],
    verificationStatus: 'verified', pcnStatus: 'active',
  });
  const greenlife = await upsertUser('greenlife@pharm36.app', {
    role: 'professional', professionalType: 'pharmacist', name: 'Tunde Bello', storeName: 'GreenLife Pharmacy',
    phone: '+2348035550143', location: 'Ikeja, Lagos', state: 'Lagos', licenseNo: 'PCN/LG/1180',
    sections: ['general_pharmacy'], verifiedSections: ['general_pharmacy'], verificationStatus: 'verified', pcnStatus: 'active',
  });
  const carefirst = await upsertUser('carefirst@pharm36.app', {
    role: 'professional', professionalType: 'pharmacist', name: 'Ngozi Eze', storeName: 'CareFirst Pharmacy',
    phone: '+2348035550144', location: 'Surulere, Lagos', state: 'Lagos', licenseNo: 'PCN/LG/3342',
    sections: ['general_pharmacy'], verifiedSections: ['general_pharmacy'], verificationStatus: 'verified', pcnStatus: 'active',
  });

  await Promise.all([Batch.deleteMany({ owner: { $in: [adaeze._id, greenlife._id, carefirst._id] } }), Listing.deleteMany({ seller: { $in: [adaeze._id, greenlife._id, carefirst._id] } }), SaleRecord.deleteMany({ owner: adaeze._id })]);

  // Expiry dates are relative to today so the demo always shows 1-month / 2-week / expired examples.
  const rows = [
    { drugName: 'Amoxicillin 500mg', batchCode: '5012345678901', manufactureDate: D('2025-02-10'), expiryDate: inDays(20), quantity: 240, unitPrice: 85, category: 'prescription', manufacturer: 'Emzor Pharmaceuticals', strength: '500mg', form: 'Capsule' },
    { drugName: 'Paracetamol 500mg', batchCode: '5019988771234', manufactureDate: D('2024-11-01'), expiryDate: inDays(14), quantity: 500, unitPrice: 25, category: 'general', manufacturer: 'May & Baker Nigeria', strength: '500mg', form: 'Tablet' },
    { drugName: 'Ciprofloxacin 250mg', batchCode: '5013321459087', manufactureDate: D('2025-06-18'), expiryDate: inDays(640), quantity: 150, unitPrice: 130, category: 'prescription' },
    { drugName: 'Artemether/Lumefantrine', batchCode: '5010098234561', manufactureDate: D('2024-04-01'), expiryDate: inDays(-167), quantity: 60, unitPrice: 210, category: 'general' },
    { drugName: 'Metformin 850mg', batchCode: '5017765432198', manufactureDate: D('2025-01-15'), expiryDate: inDays(487), quantity: 320, unitPrice: 60, category: 'prescription' },
  ];
  const created = await Batch.insertMany(rows.map((r) => ({ ...r, owner: adaeze._id, reminder: '1 month' })));
  const byName = Object.fromEntries(created.map((b) => [b.drugName, b]));

  const sale = (name, quantity, unitPrice, daysAgo) => ({
    owner: adaeze._id, batch: byName[name]._id, drugName: name, batchCode: byName[name].batchCode,
    quantity, unitPrice, revenue: quantity * unitPrice, soldAt: addDays(todayUTC(), -daysAgo),
  });
  await SaleRecord.insertMany([
    sale('Amoxicillin 500mg', 100, 85, 3), sale('Amoxicillin 500mg', 80, 85, 12),
    sale('Paracetamol 500mg', 160, 25, 5), sale('Paracetamol 500mg', 100, 25, 20),
    sale('Ciprofloxacin 250mg', 22, 130, 9),
    sale('Metformin 850mg', 140, 60, 7),
  ]);

  const gl = await Batch.create({ owner: greenlife._id, drugName: 'Vitamin C 1000mg', batchCode: '5011112223334', expiryDate: inDays(400), quantity: 100, unitPrice: 45, category: 'general' });
  const cf = await Batch.create({ owner: carefirst._id, drugName: 'Ibuprofen 400mg', batchCode: '5014445556667', expiryDate: inDays(300), quantity: 300, unitPrice: 30, category: 'general' });
  await Listing.insertMany([
    { type: 'offer', seller: greenlife._id, batch: gl._id, drugName: gl.drugName, category: 'general', quantity: 100, unitPrice: 45, batchCode: gl.batchCode, expiryDate: gl.expiryDate },
    { type: 'offer', seller: carefirst._id, batch: cf._id, drugName: cf.drugName, category: 'general', quantity: 300, unitPrice: 30, batchCode: cf.batchCode, expiryDate: cf.expiryDate },
  ]);

  console.log('Demo data loaded.\n  Login: adaeze.okonkwo@pharm36.app / Demo12345\n  Try scanning: 5012345678901 (Amoxicillin), 5019988771234 (Paracetamol)');
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
