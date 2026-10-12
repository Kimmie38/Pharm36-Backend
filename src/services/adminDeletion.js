const mongoose = require('mongoose');
const User = require('../models/User');
const Batch = require('../models/Batch');
const Listing = require('../models/Listing');
const MarketplaceOrder = require('../models/MarketplaceOrder');
const SaleRecord = require('../models/SaleRecord');
const Notification = require('../models/Notification');
const Report = require('../models/Report');
const DrugInfo = require('../models/DrugInfo');
const AISettings = require('../models/AISettings');
const AppError = require('../utils/AppError');
const { ensureAdminInvariant, acquireAdminInvariant } = require('./adminInvariant');

const idList = (rows) => rows.map((row) => row._id);
const deleted = (result) => Number(result?.deletedCount || 0);
const isTransactionUnsupported = (error) => /Transaction numbers are only allowed|replica set|\bmongos\b|transactions? (?:are )?not supported|TransactionNotSupported/i.test(`${error?.name || ''} ${error?.message || ''}`);

function requireReplicaSetError(error) {
  if (error instanceof AppError) return error;
  if (isTransactionUnsupported(error)) {
    return new AppError(503, 'Permanent deletion requires MongoDB transaction support (a replica set or Atlas deployment). No records were deleted.');
  }
  return error;
}

async function inTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (error) {
    throw requireReplicaSetError(error);
  } finally {
    await session.endSession();
  }
}

async function userDeletePreview(userId) {
  const user = await User.findById(userId).select('role name email phone').lean();
  if (!user) throw new AppError(404, 'User not found');
  const batches = await Batch.find({ owner: userId }).select('_id').lean();
  const batchIds = idList(batches);
  const listingFilter = { $or: [{ seller: userId }, { batch: { $in: batchIds } }] };
  const listings = await Listing.find(listingFilter).select('_id').lean();
  const listingIds = idList(listings);
  const [sales, orders, notifications] = await Promise.all([
    SaleRecord.countDocuments({ $or: [{ owner: userId }, { batch: { $in: batchIds } }] }),
    MarketplaceOrder.countDocuments({ $or: [{ seller: userId }, { buyer: userId }, { listing: { $in: listingIds } }] }),
    Notification.countDocuments({ $or: [{ user: userId }, { batch: { $in: batchIds } }] }),
  ]);
  return {
    user: { id: String(user._id), role: user.role, name: user.name, email: user.email || null, phone: user.phone || null },
    counts: { batches: batches.length, listings: listings.length, sales, orders, notifications },
  };
}

async function deleteUserCascade(user) {
  await ensureAdminInvariant();
  const lock = await User.findOneAndUpdate(
    { _id: user._id, role: user.role, deletionInProgress: { $ne: true } },
    { $set: { deletionInProgress: true } },
    { returnDocument: 'after' }
  );
  if (!lock) throw new AppError(409, 'This account is already being removed. Refresh and try again.');

  try {
    return await inTransaction(async (session) => {
      await acquireAdminInvariant(session);
      const current = await User.findById(user._id).select('+deletionInProgress').session(session);
      if (!current || !current.deletionInProgress || current.role !== user.role) {
        throw new AppError(409, 'The account changed before deletion could start. No related records were removed.');
      }
      if (current.role === 'admin' && current.council === 'ALL') {
        const remainingAllAdmins = await User.countDocuments({
          role: 'admin', council: 'ALL', _id: { $ne: current._id }, deletionInProgress: { $ne: true },
        }).session(session);
        if (remainingAllAdmins < 1) throw new AppError(409, 'The last ALL-scope administrator cannot be deleted');
      }
      const batches = await Batch.find({ owner: user._id }).select('_id').session(session).lean();
      const batchIds = idList(batches);
      const listingFilter = { $or: [{ seller: user._id }, { batch: { $in: batchIds } }] };
      const listings = await Listing.find(listingFilter).select('_id').session(session).lean();
      const listingIds = idList(listings);

      const notificationResult = await Notification.deleteMany({ $or: [{ user: user._id }, { batch: { $in: batchIds } }] }, { session });
      const orderResult = await MarketplaceOrder.deleteMany({ $or: [{ seller: user._id }, { buyer: user._id }, { listing: { $in: listingIds } }] }, { session });
      const saleResult = await SaleRecord.deleteMany({ $or: [{ owner: user._id }, { batch: { $in: batchIds } }] }, { session });
      const listingResult = await Listing.deleteMany(listingFilter, { session });
      const batchResult = await Batch.deleteMany({ owner: user._id }, { session });
      await Report.updateMany({ handledBy: user._id }, { $unset: { handledBy: 1 } }, { session });
      await DrugInfo.updateMany({ reviewedBy: user._id }, { $unset: { reviewedBy: 1, reviewedAt: 1 } }, { session });
      await AISettings.updateMany({ updatedBy: user._id }, { $unset: { updatedBy: 1 } }, { session });
      const userResult = await User.deleteOne({ _id: user._id, deletionInProgress: true }, { session });
      if (!userResult.deletedCount) throw new AppError(409, 'The account could not be deleted. The transaction was rolled back.');
      return {
        user: 1,
        batches: deleted(batchResult),
        listings: deleted(listingResult),
        sales: deleted(saleResult),
        orders: deleted(orderResult),
        notifications: deleted(notificationResult),
      };
    });
  } catch (error) {
    // The lock is outside the transaction so that concurrent professional writes can be rejected.
    // If the transaction fails, release it without leaving a partial account/session mutation.
    await User.updateOne({ _id: user._id, deletionInProgress: true }, { $set: { deletionInProgress: false } }).catch(() => {});
    throw error;
  }
}

async function deleteBatchCascade(batch) {
  return inTransaction(async (session) => {
    const current = await Batch.findById(batch._id).session(session);
    if (!current) throw new AppError(404, 'Batch not found');
    const listings = await Listing.find({ batch: current._id }).select('_id').session(session).lean();
    const listingIds = idList(listings);
    const notifications = await Notification.deleteMany({ batch: current._id }, { session });
    const orders = await MarketplaceOrder.deleteMany({ listing: { $in: listingIds } }, { session });
    const sales = await SaleRecord.deleteMany({ batch: current._id }, { session });
    const deletedListings = await Listing.deleteMany({ batch: current._id }, { session });
    const deletedBatch = await Batch.deleteOne({ _id: current._id }, { session });
    if (!deletedBatch.deletedCount) throw new AppError(409, 'Batch deletion failed. The transaction was rolled back.');
    return { batches: deleted(deletedBatch), listings: deleted(deletedListings), orders: deleted(orders), sales: deleted(sales), notifications: deleted(notifications) };
  });
}

async function deleteListingCascade(listing) {
  return inTransaction(async (session) => {
    const current = await Listing.findById(listing._id).session(session);
    if (!current) throw new AppError(404, 'Listing not found');
    const orders = await MarketplaceOrder.deleteMany({ listing: current._id }, { session });
    const deletedListing = await Listing.deleteOne({ _id: current._id }, { session });
    if (!deletedListing.deletedCount) throw new AppError(409, 'Listing deletion failed. The transaction was rolled back.');
    return { listings: deleted(deletedListing), orders: deleted(orders) };
  });
}

module.exports = { userDeletePreview, deleteUserCascade, deleteBatchCascade, deleteListingCascade, isTransactionUnsupported };
