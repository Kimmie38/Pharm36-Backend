const cron = require('node-cron');
const Batch = require('../models/Batch');
const Notification = require('../models/Notification');
const User = require('../models/User');
const env = require('../config/env');
const { sendExpoPush } = require('../services/notify');
const { expiryBucketDays } = require('../constants/professions');
const { todayUTC, addDays, daysUntil } = require('../utils/dates');

// Which notifications are due for a batch today?
//  - automatic: 1 month (<=30d), 2 weeks (<=14d), expired (<0d)
//  - custom "extra reminder" chosen on the Add Batch screen (1 year, 6 months, 3 months, 1 week).
//    "1 month"/"2 weeks" would just duplicate the automatic alerts, so they're skipped.
function dueKinds(batch) {
  const d = daysUntil(batch.expiryDate);
  const kinds = [];
  const R = batch.reminder ? expiryBucketDays[batch.reminder] : null;
  if (R && R !== 30 && R !== 14 && d >= 0 && d <= R) kinds.push('reminder');
  if (d < 0) kinds.push('expired');
  else if (d <= 14) kinds.push('expiring_2w');
  else if (d <= 30) kinds.push('expiring_1m');
  return { kinds, days: d };
}

function message(kind, batch, days) {
  const name = batch.drugName;
  switch (kind) {
    case 'expired': return ['Batch expired', `${name} (batch …${batch.batchCode.slice(-6)}) has expired. Dispose of it — do not sell.`];
    case 'expiring_2w': return ['Expiring in 2 weeks or less', `${name} expires in ${days} day${days === 1 ? '' : 's'}. Sell or dispose of it.`];
    case 'expiring_1m': return ['Expiring within a month', `${name} expires in ${days} days.`];
    default: return ['Expiry reminder', `${name} expires in ${days} days (${batch.reminder} reminder).`];
  }
}

async function runExpiryScan() {
  const horizon = addDays(todayUTC(), 366);
  const cursor = Batch.find({ state: 'active', expiryDate: { $lte: horizon } }).cursor();
  const userCache = new Map();
  let created = 0;

  for await (const batch of cursor) {
    const { kinds, days } = dueKinds(batch);
    for (const kind of kinds) {
      const [title, body] = message(kind, batch, days);
      // upsert on (user, batch, kind): re-running the scan never duplicates
      const r = await Notification.updateOne(
        { user: batch.owner, batch: batch._id, kind },
        { $setOnInsert: { title, body } },
        { upsert: true }
      );
      if (!r.upsertedCount) continue;
      created += 1;
      let user = userCache.get(String(batch.owner));
      if (user === undefined) {
        user = await User.findById(batch.owner).select('expoPushToken settings');
        userCache.set(String(batch.owner), user);
      }
      if (user?.settings?.pushEnabled && user.expoPushToken) {
        await sendExpoPush(user.expoPushToken, title, body, { batchId: String(batch._id), kind });
      }
    }
  }
  console.log(`[expiry-scan] done, ${created} new notification(s)`);
  return created;
}

function startExpiryCron() {
  if (!env.enableCron) return;
  cron.schedule(env.cronSchedule, () => runExpiryScan().catch((e) => console.error('[expiry-scan]', e)), { timezone: env.cronTimezone });
  console.log(`[cron] expiry scan scheduled: "${env.cronSchedule}" (${env.cronTimezone})`);
}

module.exports = { runExpiryScan, startExpiryCron, dueKinds };
