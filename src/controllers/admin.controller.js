const User = require('../models/User');
const Batch = require('../models/Batch');
const Report = require('../models/Report');
const DrugCheck = require('../models/DrugCheck');
const AppError = require('../utils/AppError');
const { escapeRegex } = require('../utils/regex');
const { professionalTypes } = require('../constants/professions');
const { serializeUser } = require('../services/serializers');

// PCN admins only see pharmacists, VCN admins only see vets, ALL sees both.
function scopeFor(admin) {
  if (admin?.council === 'PCN') return { professionalType: 'pharmacist' };
  if (admin?.council === 'VCN') return { professionalType: 'veterinary' };
  if (admin?.council === 'ALL') return {};
  throw new AppError(403, 'Administrator account has no valid council scope');
}

function requireAllScope(admin) {
  if (admin?.council !== 'ALL') throw new AppError(403, 'Global reports and statistics require an ALL-scope administrator');
}

async function findScoped(admin, id) {
  const u = await User.findOne({ _id: id, role: 'professional', ...scopeFor(admin) });
  if (!u) throw new AppError(404, 'Professional not found');
  return u;
}

async function listProfessionals(req, res) {
  const { search, verificationStatus, pcnStatus, state, page, limit } = req.valid.query;
  const filter = { role: 'professional', ...scopeFor(req.user) };
  if (verificationStatus) filter.verificationStatus = verificationStatus;
  if (pcnStatus) filter.pcnStatus = pcnStatus;
  if (state) filter.state = state;
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ name: rx }, { storeName: rx }, { email: rx }, { phone: rx }, { licenseNo: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ items: items.map(serializeUser), total, page, limit });
}

async function getProfessional(req, res) {
  const u = await findScoped(req.user, req.valid.params.id);
  const [batchCount, activeUnits] = await Promise.all([
    Batch.countDocuments({ owner: u._id }),
    Batch.aggregate([{ $match: { owner: u._id, state: 'active' } }, { $group: { _id: null, units: { $sum: '$quantity' } } }]),
  ]);
  res.json({ professional: serializeUser(u), batchCount, activeUnits: activeUnits[0]?.units || 0 });
}

// PATCH /api/admin/professionals/:id/verification
async function setVerification(req, res) {
  const u = await findScoped(req.user, req.valid.params.id);
  const b = req.valid.body;
  if (b.verifiedSections) {
    const allowed = professionalTypes[u.professionalType].sections.map((s) => s.key);
    const bad = b.verifiedSections.filter((s) => !allowed.includes(s));
    if (bad.length) throw new AppError(400, `Invalid section(s) for this profession: ${bad.join(', ')}`);
    u.verifiedSections = [...new Set(b.verifiedSections)];
  }
  if (b.verificationStatus) u.verificationStatus = b.verificationStatus;
  if (b.pcnStatus) u.pcnStatus = b.pcnStatus;
  if (b.licenseNo !== undefined) u.licenseNo = b.licenseNo;
  if (b.verificationStatus === 'rejected' && !b.pcnStatus) u.pcnStatus = 'revoked';
  await u.save();
  res.json({ professional: serializeUser(u) });
}

async function listProfessionalBatches(req, res) {
  const u = await findScoped(req.user, req.valid.params.id);
  const { state, page, limit } = req.valid.query;
  const filter = { owner: u._id, ...(state ? { state } : {}) };
  const [items, total] = await Promise.all([
    Batch.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Batch.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
}

async function listReports(req, res) {
  requireAllScope(req.user);
  const { status, search, page, limit } = req.valid.query;
  const filter = status ? { status } : {};
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ drugName: rx }, { batchCode: rx }, { description: rx }, { sellerInfo: rx }, { contact: rx }, { adminNote: rx }];
  }
  const [items, total] = await Promise.all([
    Report.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Report.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
}

async function updateReport(req, res) {
  requireAllScope(req.user);
  const r = await Report.findByIdAndUpdate(
    req.valid.params.id,
    { ...req.valid.body, handledBy: req.user._id },
    { returnDocument: 'after' }
  );
  if (!r) throw new AppError(404, 'Report not found');
  res.json({ report: r });
}

async function stats(req, res) {
  requireAllScope(req.user);
  const scope = { role: 'professional', ...scopeFor(req.user) };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [professionals, pending, revoked, openReports, scans, unmatched, batches] = await Promise.all([
    User.countDocuments(scope),
    User.countDocuments({ ...scope, verificationStatus: 'pending' }),
    User.countDocuments({ ...scope, pcnStatus: 'revoked' }),
    Report.countDocuments({ status: { $in: ['new', 'reviewing'] } }),
    DrugCheck.countDocuments({ kind: 'scan', createdAt: { $gte: since } }),
    DrugCheck.countDocuments({ kind: 'scan', found: false, createdAt: { $gte: since } }),
    Batch.countDocuments({ state: 'active' }),
  ]);
  res.json({ professionals, pendingVerification: pending, revoked, openReports, scansLast30Days: scans, unmatchedScansLast30Days: unmatched, activeBatches: batches });
}

module.exports = { scopeFor, requireAllScope, listProfessionals, getProfessional, setVerification, listProfessionalBatches, listReports, updateReport, stats };
