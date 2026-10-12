const mongoose = require('mongoose');
const AdminInvariant = require('../models/AdminInvariant');
const AppError = require('../utils/AppError');

const isTransactionUnsupported = (error) => /Transaction numbers are only allowed|replica set|\bmongos\b|transactions? (?:are )?not supported|TransactionNotSupported/i.test(`${error?.name || ''} ${error?.message || ''}`);

async function ensureAdminInvariant() {
  try {
    await AdminInvariant.updateOne(
      { _id: 'global' },
      { $setOnInsert: { revision: 0 } },
      { upsert: true }
    );
  } catch (error) {
    // Concurrent first use can race on the built-in _id index; accept the winner.
    if (error?.code !== 11000 || !(await AdminInvariant.exists({ _id: 'global' }))) throw error;
  }
}

async function acquireAdminInvariant(session) {
  const result = await AdminInvariant.updateOne(
    { _id: 'global' },
    { $inc: { revision: 1 } },
    { session }
  );
  if (!result.matchedCount) throw new AppError(503, 'Administrator safety guard is not initialized. No change was made.');
}

async function withAdminInvariantLock(work) {
  await ensureAdminInvariant();
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      await acquireAdminInvariant(session);
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      throw new AppError(503, 'Changing administrator scope requires MongoDB transaction support (a replica set or Atlas deployment). No change was made.');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { ensureAdminInvariant, acquireAdminInvariant, withAdminInvariantLock, isTransactionUnsupported };
