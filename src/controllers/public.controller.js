const Batch = require('../models/Batch');
const Report = require('../models/Report');
const DrugCheck = require('../models/DrugCheck');
const { escapeRegex } = require('../utils/regex');
const { daysUntil, statusFromDays } = require('../utils/dates');

const OWNER_FIELDS = 'name storeName location state pcnStatus professionalType +deletionInProgress';
const pharmacyLabel = (o) => [o.storeName || o.name, o.location].filter(Boolean).join(', ');

// Batches registered by professionals who are still in good standing, and not disposed of.
async function registeredBatches(match) {
  const rows = await Batch.find({ ...match, state: { $in: ['active', 'sold'] } }).populate('owner', OWNER_FIELDS).sort({ createdAt: 1 });
  return rows.filter((b) => b.owner && b.owner.pcnStatus === 'active' && !b.owner.deletionInProgress);
}

function describe(rows, batchCode) {
  const primary = rows[0];
  const days = daysUntil(primary.expiryDate);
  const status = statusFromDays(days);
  const expiryDates = new Set(rows.map((r) => r.expiryDate.toISOString().slice(0, 10)));
  const inconsistent = expiryDates.size > 1; // same batch code, different expiry dates => suspicious
  const safeToUse = days > 30 && !inconsistent;

  let summary;
  if (inconsistent) {
    summary = 'Warning: pharmacists have registered this batch code with different expiry dates. Do not use it until you have checked with the pharmacist or the council.';
  } else if (days < 0) {
    summary = `This batch matches a registered record but EXPIRED ${Math.abs(days)} day(s) ago. Do not use it.`;
  } else if (days <= 30) {
    summary = `This looks like a genuine batch sold by a registered pharmacy, but it expires in ${days} day(s). Check you can finish the course before then.`;
  } else {
    summary = 'This looks like a genuine, in-date batch sold by a registered pharmacy. Always check the pack seal before use.';
  }

  return {
    found: true,
    verified: true,
    safeToUse,
    expiryStatus: status,
    inconsistentRecords: inconsistent,
    drug: {
      name: primary.drugName,
      strength: primary.strength || null,
      form: primary.form || null,
      manufacturer: primary.manufacturer || null,
      manufactureDate: primary.manufactureDate ? primary.manufactureDate.toISOString().slice(0, 10) : null,
      expiryDate: primary.expiryDate.toISOString().slice(0, 10),
      daysToExpiry: days,
      batchCode,
      category: primary.category,
    },
    registeredPharmacy: pharmacyLabel(primary.owner),
    sellers: [...new Map(rows.map((r) => [String(r.owner._id), { pharmacy: pharmacyLabel(r.owner), state: r.owner.state }])).values()],
    summary,
  };
}

// GET /api/public/drugs/verify?batchCode=...   (scan result)
async function verify(req, res) {
  const { batchCode } = req.valid.query;
  const rows = await registeredBatches({ batchCode });
  const result = rows.length
    ? describe(rows, batchCode)
    : {
        found: false,
        verified: false,
        safeToUse: false,
        batchCode,
        summary: 'We could not match this batch to any registered pharmacist record. Do not buy or use it until you have checked with a licensed pharmacist.',
      };
  DrugCheck.create({ kind: 'scan', query: batchCode, found: result.found, verified: result.verified }).catch(() => {});
  res.json(result);
}

// GET /api/public/drugs/search?q=amoxicillin   (search by name -> candidate batches)
async function search(req, res) {
  const { q, limit } = req.valid.query;
  const rows = await registeredBatches({ drugName: { $regex: escapeRegex(q), $options: 'i' } });
  const seen = new Set();
  const items = [];
  for (const b of rows) {
    if (seen.has(b.batchCode)) continue;
    seen.add(b.batchCode);
    const days = daysUntil(b.expiryDate);
    items.push({
      batchCode: b.batchCode,
      name: b.drugName,
      strength: b.strength || null,
      form: b.form || null,
      manufacturer: b.manufacturer || null,
      expiryDate: b.expiryDate.toISOString().slice(0, 10),
      expiryStatus: statusFromDays(days),
      registeredPharmacy: pharmacyLabel(b.owner),
    });
    if (items.length >= limit) break;
  }
  DrugCheck.create({ kind: 'search', query: q.toLowerCase(), found: items.length > 0 }).catch(() => {});
  res.json({ items, total: items.length });
}

// POST /api/public/reports   ("Report a problem with this drug")
async function report(req, res) {
  const r = await Report.create(req.valid.body);
  res.status(201).json({ id: String(r._id), message: 'Thank you. Your report has been sent to the regulator for review.' });
}

module.exports = { verify, search, report };
