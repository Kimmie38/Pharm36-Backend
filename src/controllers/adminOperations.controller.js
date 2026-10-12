const User = require('../models/User');
const Batch = require('../models/Batch');
const Listing = require('../models/Listing');
const SaleRecord = require('../models/SaleRecord');
const MarketplaceOrder = require('../models/MarketplaceOrder');
const Notification = require('../models/Notification');
const DrugCheck = require('../models/DrugCheck');
const AppError = require('../utils/AppError');
const { escapeRegex } = require('../utils/regex');
const { canAddCategory } = require('../constants/permissions');
const { professionalTypes, drugCategories, getCategory } = require('../constants/professions');
const { serializeUser } = require('../services/serializers');
const { userDeletePreview, deleteUserCascade, deleteBatchCascade, deleteListingCascade } = require('../services/adminDeletion');
const { withAdminInvariantLock } = require('../services/adminInvariant');

const SORT_NEWEST = { createdAt: -1, _id: -1 };
function scopeType(admin) {
  if (admin.council === 'PCN') return 'pharmacist';
  if (admin.council === 'VCN') return 'veterinary';
  if (admin.council === 'ALL') return null;
  throw new AppError(403, 'Administrator account has no valid council scope');
}
function scopeFilter(admin) {
  const type = scopeType(admin);
  return type ? { professionalType: type } : {};
}
const requireAllScope = (admin) => {
  if (admin.council !== 'ALL') throw new AppError(403, 'This global or cross-council action requires an ALL-scope administrator');
};

async function scopedProfessionalIds(admin) {
  return User.distinct('_id', { role: 'professional', ...scopeFilter(admin), deletionInProgress: { $ne: true } });
}

async function findVisibleUser(admin, id) {
  const filter = { _id: id, deletionInProgress: { $ne: true } };
  if (admin.council !== 'ALL') {
    const type = scopeType(admin);
    filter.role = 'professional';
    filter.professionalType = type;
  }
  const user = await User.findOne(filter).select('+deletionInProgress');
  if (!user) throw new AppError(404, 'User not found in your council scope');
  return user;
}

function escapeQuery(search) {
  return search ? { $regex: escapeRegex(search), $options: 'i' } : null;
}

function addDateRange(filter, from, to, field = 'createdAt') {
  if (!from && !to) return;
  filter[field] = {};
  if (from) filter[field].$gte = from;
  if (to) filter[field].$lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
}

async function listUsers(req, res) {
  const { search, role, professionalType, verificationStatus, pcnStatus, state, page, limit } = req.valid.query;
  const filter = { role: req.user.council === 'ALL' ? { $in: ['professional', 'admin'] } : 'professional', ...scopeFilter(req.user), deletionInProgress: { $ne: true } };
  if (role) filter.role = role;
  if (professionalType) filter.professionalType = professionalType;
  if (verificationStatus) filter.verificationStatus = verificationStatus;
  if (pcnStatus) filter.pcnStatus = pcnStatus;
  if (state) filter.state = state;
  if (search) {
    const rx = escapeQuery(search);
    filter.$or = [{ name: rx }, { storeName: rx }, { email: rx }, { phone: rx }, { licenseNo: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort(SORT_NEWEST).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ items: items.map(serializeUser), total, page, limit, scope: req.user.council || 'PCN' });
}

async function getUser(req, res) {
  const user = await findVisibleUser(req.user, req.valid.params.id);
  const userId = user._id;
  const previewPromise = req.user.council === 'ALL' ? userDeletePreview(userId) : Promise.resolve(null);
  const [batchCount, activeUnits, saleCount, listingCount, orderCount, notificationCount, deletionPreview] = await Promise.all([
    Batch.countDocuments({ owner: userId }),
    Batch.aggregate([{ $match: { owner: userId, state: 'active' } }, { $group: { _id: null, units: { $sum: '$quantity' } } }]),
    SaleRecord.countDocuments({ owner: userId }),
    Listing.countDocuments({ seller: userId }),
    MarketplaceOrder.countDocuments({ $or: [{ seller: userId }, { buyer: userId }] }),
    Notification.countDocuments({ user: userId }),
    previewPromise,
  ]);
  res.json({
    user: serializeUser(user),
    counts: { batches: batchCount, activeUnits: activeUnits[0]?.units || 0, sales: saleCount, listings: listingCount, orders: orderCount, notifications: notificationCount },
    ...(deletionPreview ? { deletionPreview: deletionPreview.counts } : {}),
  });
}

async function updateUser(req, res) {
  const user = await findVisibleUser(req.user, req.valid.params.id);
  const body = req.valid.body;
  if (user.role === 'admin' && req.user.council !== 'ALL') throw new AppError(403, 'Only an ALL-scope administrator can manage administrator accounts');
  if (user.deletionInProgress) throw new AppError(423, 'This account is being permanently deleted');

  if (body.email !== undefined && body.email !== user.email && await User.exists({ email: body.email, _id: { $ne: user._id } })) {
    throw new AppError(409, 'This email address is already in use');
  }
  if (body.phone !== undefined && body.phone !== user.phone && await User.exists({ phone: body.phone, _id: { $ne: user._id } })) {
    throw new AppError(409, 'This phone number is already in use');
  }

  if (user.role === 'admin' && body.council !== undefined) {
    if (req.user.council !== 'ALL') throw new AppError(403, 'Only an ALL-scope administrator can change administrator council scope');
    if (String(user._id) === String(req.user._id)) throw new AppError(400, 'You cannot change your own administrator scope');
    const updated = await withAdminInvariantLock(async (session) => {
      const current = await User.findById(user._id).select('+deletionInProgress').session(session);
      if (!current || current.deletionInProgress || current.role !== 'admin') throw new AppError(409, 'This administrator changed or is being removed. Refresh and try again.');
      if (current.council === 'ALL' && body.council !== 'ALL') {
        const remainingAllAdmins = await User.countDocuments({
          role: 'admin', council: 'ALL', _id: { $ne: current._id }, deletionInProgress: { $ne: true },
        }).session(session);
        if (remainingAllAdmins < 1) throw new AppError(409, 'The last ALL-scope administrator cannot be downgraded');
      }
      for (const field of ['name', 'email', 'phone']) if (body[field] !== undefined) current[field] = body[field];
      current.council = body.council;
      await current.save({ session });
      return current;
    });
    res.json({ user: serializeUser(updated) });
    return;
  }

  for (const field of ['name', 'email', 'phone']) if (body[field] !== undefined) user[field] = body[field];
  if (user.role === 'professional') {
    if (body.council !== undefined) throw new AppError(400, 'Council scope applies only to administrator accounts');
    for (const field of ['storeName', 'location', 'state', 'licenseNo', 'verificationStatus', 'pcnStatus']) {
      if (body[field] !== undefined) user[field] = body[field];
    }
    if (body.sections !== undefined || body.verifiedSections !== undefined) {
      const allowed = professionalTypes[user.professionalType]?.sections.map((section) => section.key) || [];
      const sections = body.sections ?? user.sections;
      const verifiedSections = body.verifiedSections ?? user.verifiedSections;
      const invalid = [...sections, ...verifiedSections].filter((section) => !allowed.includes(section));
      if (invalid.length) throw new AppError(400, `Invalid section(s) for this profession: ${[...new Set(invalid)].join(', ')}`);
      if (verifiedSections.some((section) => !sections.includes(section))) throw new AppError(400, 'Verified sections must be among the professional’s claimed sections');
      user.sections = [...new Set(sections)];
      user.verifiedSections = [...new Set(verifiedSections)];
    }
  }

  await user.save();
  res.json({ user: serializeUser(user) });
}

async function revokeSessions(req, res) {
  const user = await findVisibleUser(req.user, req.valid.params.id);
  if (String(user._id) === String(req.user._id)) throw new AppError(400, 'Use sign-out or change your own password to end your current session');
  if (user.role === 'admin' && req.user.council !== 'ALL') throw new AppError(403, 'Only an ALL-scope administrator can revoke administrator sessions');
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  res.json({ message: 'All existing sessions for this account have been revoked' });
}

async function previewUserDelete(req, res) {
  requireAllScope(req.user);
  const user = await findVisibleUser(req.user, req.valid.params.id);
  if (String(user._id) === String(req.user._id)) throw new AppError(400, 'You cannot delete the signed-in administrator');
  if (user.role === 'admin' && req.user.council !== 'ALL') throw new AppError(403, 'Only an ALL-scope administrator can remove administrator accounts');
  res.json(await userDeletePreview(user._id));
}

async function deleteUser(req, res) {
  requireAllScope(req.user);
  const user = await findVisibleUser(req.user, req.valid.params.id);
  if (String(user._id) === String(req.user._id)) throw new AppError(400, 'You cannot delete the signed-in administrator');
  if (user.role === 'admin' && req.user.council !== 'ALL') throw new AppError(403, 'Only an ALL-scope administrator can remove administrator accounts');
  const remainingAllAdmins = user.role === 'admin' && user.council === 'ALL'
    ? await User.countDocuments({ role: 'admin', council: 'ALL', _id: { $ne: user._id }, deletionInProgress: { $ne: true } })
    : 1;
  if (user.role === 'admin' && user.council === 'ALL' && remainingAllAdmins < 1) throw new AppError(409, 'The last ALL-scope administrator cannot be deleted');
  const expected = String(user.email || user.phone || '').trim();
  if (!expected || String(req.valid.body.confirmIdentity).trim() !== expected) {
    throw new AppError(400, 'Confirmation must exactly match this account’s registered email, or its registered phone if no email is on file');
  }
  const deleted = await deleteUserCascade(user);
  res.json({ deleted: true, records: deleted });
}

async function listInventory(req, res) {
  const { search, state, category, page, limit } = req.valid.query;
  const owners = await scopedProfessionalIds(req.user);
  const filter = { owner: { $in: owners }, ...(state ? { state } : {}), ...(category ? { category } : {}) };
  const rx = escapeQuery(search);
  if (rx) filter.$or = [{ drugName: rx }, { batchCode: rx }, { manufacturer: rx }];
  const [items, total] = await Promise.all([
    Batch.find(filter).populate('owner', 'name storeName professionalType state sections verifiedSections').sort(SORT_NEWEST).skip((page - 1) * limit).limit(limit),
    Batch.countDocuments(filter),
  ]);
  const decoratedItems = items.map((batch) => {
    const item = batch.toObject({ virtuals: true });
    if (batch.owner && typeof batch.owner.toObject === 'function') {
      item.owner = {
        ...batch.owner.toObject({ virtuals: true }),
        allowedCategories: drugCategories.filter((category) => canAddCategory(batch.owner, category.key)).map((category) => category.key),
      };
    }
    return item;
  });
  res.json({ items: decoratedItems, total, page, limit, scope: req.user.council || 'PCN' });
}

async function findScopedBatch(admin, id) {
  const owners = await scopedProfessionalIds(admin);
  const batch = await Batch.findOne({ _id: id, owner: { $in: owners } }).populate('owner', 'name storeName professionalType state sections verifiedSections');
  if (!batch) throw new AppError(404, 'Inventory batch not found in your council scope');
  return batch;
}

async function updateInventory(req, res) {
  const batch = await findScopedBatch(req.user, req.valid.params.id);
  const body = req.valid.body;
  const originalState = batch.state;
  const originalBatchCode = batch.batchCode;
  if (body.category !== undefined && body.category !== batch.category && !canAddCategory(batch.owner, body.category)) {
    const cat = getCategory(body.category);
    const council = professionalTypes[batch.owner.professionalType]?.councilShort || 'the relevant council';
    throw new AppError(403, `The professional's current section authorization does not allow ${cat.label}. Contact ${council} to update the account's verified credentials.`, {
      code: 'CATEGORY_RESTRICTED', category: body.category, requiredSections: cat.requiredSections,
    });
  }
  if (body.state !== undefined && body.state !== originalState && (body.state === 'sold' || originalState === 'sold')) {
    throw new AppError(409, 'Sold batches cannot be marked sold or returned to stock through admin editing; use the professional sale workflow.');
  }
  for (const key of ['drugName', 'category', 'batchCode', 'manufacturer', 'strength', 'form', 'manufactureDate', 'expiryDate', 'quantity', 'unitPrice', 'reminder', 'state', 'disposalReason']) {
    if (body[key] !== undefined) batch[key] = body[key];
  }
  if (batch.manufactureDate && batch.expiryDate && batch.manufactureDate >= batch.expiryDate) throw new AppError(400, 'Manufacture date must be before the expiry date');
  if (batch.state === 'active' && batch.expiryDate <= new Date()) throw new AppError(400, 'An expired batch cannot be returned to active stock');
  if (batch.state === 'sold' && batch.quantity > 0) throw new AppError(400, 'A sold batch must have zero quantity');
  if (batch.state === 'active' && (originalState !== 'active' || batch.batchCode !== originalBatchCode)) {
    const duplicate = await Batch.exists({ _id: { $ne: batch._id }, owner: batch.owner._id, batchCode: batch.batchCode, state: 'active' });
    if (duplicate) throw new AppError(409, 'The owner already has an active batch with this batch code');
  }
  if (batch.state === 'disposed') {
    batch.closedAt = batch.closedAt || new Date();
    if (!batch.disposalReason) throw new AppError(400, 'A disposal reason is required for a disposed batch');
  } else if (batch.state === 'active') {
    batch.closedAt = undefined;
    batch.disposalReason = undefined;
  }
  await batch.save();
  if (batch.state !== 'active') await Listing.updateMany({ batch: batch._id, status: 'open' }, { $set: { status: 'cancelled' } });
  res.json({ batch });
}

async function deleteInventory(req, res) {
  requireAllScope(req.user);
  if (req.valid.body.confirmation !== 'DELETE') throw new AppError(400, 'Type DELETE to confirm permanent removal');
  const batch = await findScopedBatch(req.user, req.valid.params.id);
  res.json({ deleted: true, records: await deleteBatchCascade(batch) });
}

async function listListings(req, res) {
  const { search, type, status, page, limit } = req.valid.query;
  const sellers = await scopedProfessionalIds(req.user);
  const filter = { seller: { $in: sellers }, ...(type ? { type } : {}), ...(status ? { status } : {}) };
  const rx = escapeQuery(search);
  if (rx) filter.$or = [{ drugName: rx }, { batchCode: rx }, { note: rx }];
  const [items, total] = await Promise.all([
    Listing.find(filter).populate('seller', 'name storeName professionalType state').populate('batch', 'batchCode state quantity expiryDate').sort(SORT_NEWEST).skip((page - 1) * limit).limit(limit),
    Listing.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, scope: req.user.council || 'PCN' });
}

async function findScopedListing(admin, id) {
  const sellers = await scopedProfessionalIds(admin);
  const listing = await Listing.findOne({ _id: id, seller: { $in: sellers } }).populate('batch', 'quantity state expiryDate');
  if (!listing) throw new AppError(404, 'Marketplace listing not found in your council scope');
  return listing;
}

async function updateListing(req, res) {
  const listing = await findScopedListing(req.user, req.valid.params.id);
  const body = req.valid.body;
  if (body.status === 'open' && listing.status !== 'open') throw new AppError(400, 'A closed listing cannot be reopened; create a new listing from the professional account');
  if (body.quantity !== undefined && listing.type === 'offer' && listing.batch && body.quantity > listing.batch.quantity) throw new AppError(400, 'Listing quantity cannot exceed its linked batch quantity');
  for (const key of ['status', 'quantity', 'unitPrice', 'note']) if (body[key] !== undefined) listing[key] = body[key];
  await listing.save();
  res.json({ listing });
}

async function deleteListing(req, res) {
  requireAllScope(req.user);
  if (req.valid.body.confirmation !== 'DELETE') throw new AppError(400, 'Type DELETE to confirm permanent removal');
  const listing = await findScopedListing(req.user, req.valid.params.id);
  res.json({ deleted: true, records: await deleteListingCascade(listing) });
}

async function listSales(req, res) {
  const { search, channel, from, to, page, limit } = req.valid.query;
  const owners = await scopedProfessionalIds(req.user);
  const filter = { owner: { $in: owners }, ...(channel ? { channel } : {}) };
  addDateRange(filter, from, to, 'soldAt');
  const rx = escapeQuery(search);
  if (rx) filter.$or = [{ drugName: rx }, { batchCode: rx }];
  const [items, total] = await Promise.all([
    SaleRecord.find(filter).populate('owner', 'name storeName professionalType state').populate('batch', 'batchCode state').sort({ soldAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    SaleRecord.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, scope: req.user.council || 'PCN' });
}

async function deleteSale(req, res) {
  requireAllScope(req.user);
  if (req.valid.body.confirmation !== 'DELETE') throw new AppError(400, 'Type DELETE to confirm permanent removal');
  const owners = await scopedProfessionalIds(req.user);
  const result = await SaleRecord.deleteOne({ _id: req.valid.params.id, owner: { $in: owners } });
  if (!result.deletedCount) throw new AppError(404, 'Sale record not found in your council scope');
  res.json({ deleted: 1 });
}

async function listOrders(req, res) {
  const { search, from, to, page, limit } = req.valid.query;
  const users = await scopedProfessionalIds(req.user);
  const filter = { seller: { $in: users }, buyer: { $in: users } };
  addDateRange(filter, from, to);
  const rx = escapeQuery(search);
  if (rx) filter.$or = [{ drugName: rx }, { batchCode: rx }];
  const [items, total] = await Promise.all([
    MarketplaceOrder.find(filter).populate('seller', 'name storeName professionalType state').populate('buyer', 'name storeName professionalType state').populate('listing', 'type status').sort(SORT_NEWEST).skip((page - 1) * limit).limit(limit),
    MarketplaceOrder.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, scope: req.user.council || 'PCN' });
}

async function deleteOrder(req, res) {
  requireAllScope(req.user);
  if (req.valid.body.confirmation !== 'DELETE') throw new AppError(400, 'Type DELETE to confirm permanent removal');
  const users = await scopedProfessionalIds(req.user);
  const result = await MarketplaceOrder.deleteOne({ _id: req.valid.params.id, seller: { $in: users }, buyer: { $in: users } });
  if (!result.deletedCount) throw new AppError(404, 'Marketplace order not found entirely within your council scope');
  res.json({ deleted: 1, note: 'The separately stored sale record is not removed by deleting this order.' });
}

async function listScans(req, res) {
  const { search, kind, found, from, to, page, limit } = req.valid.query;
  const filter = { ...(kind ? { kind } : {}), ...(found !== undefined ? { found } : {}) };
  addDateRange(filter, from, to);
  const rx = escapeQuery(search);
  if (rx) filter.query = rx;
  const [items, total] = await Promise.all([
    DrugCheck.find(filter).sort(SORT_NEWEST).skip((page - 1) * limit).limit(limit).lean(),
    DrugCheck.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, retentionDays: 180 });
}

async function deleteScan(req, res) {
  requireAllScope(req.user);
  if (req.valid.body.confirmation !== 'DELETE') throw new AppError(400, 'Type DELETE to confirm permanent removal');
  const result = await DrugCheck.deleteOne({ _id: req.valid.params.id });
  if (!result.deletedCount) throw new AppError(404, 'Scan/audit record not found or already expired');
  res.json({ deleted: 1 });
}

async function deleteReport(req, res) {
  requireAllScope(req.user);
  if (req.valid.body.confirmation !== 'DELETE') throw new AppError(400, 'Type DELETE to confirm permanent removal');
  const result = await require('../models/Report').deleteOne({ _id: req.valid.params.id });
  if (!result.deletedCount) throw new AppError(404, 'Report not found');
  res.json({ deleted: 1 });
}

async function deleteDrugInfo(req, res) {
  requireAllScope(req.user);
  if (req.valid.body.confirmation !== 'DELETE') throw new AppError(400, 'Type DELETE to confirm permanent removal');
  const DrugInfo = require('../models/DrugInfo');
  const result = await DrugInfo.deleteOne({ _id: req.valid.params.id });
  if (!result.deletedCount) throw new AppError(404, 'Drug information record not found');
  res.json({ deleted: 1, note: 'This deletes the shared cached label summary; it is not linked to a single user account.' });
}

module.exports = {
  listUsers, getUser, updateUser, revokeSessions, previewUserDelete, deleteUser,
  listInventory, updateInventory, deleteInventory,
  listListings, updateListing, deleteListing,
  listSales, deleteSale, listOrders, deleteOrder, listScans, deleteScan, deleteReport, deleteDrugInfo,
};
