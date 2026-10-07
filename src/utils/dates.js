// Nigeria is UTC+1 all year (no DST). "Today" is the Lagos calendar day, stored as UTC midnight,
// so it compares cleanly with expiry dates stored as UTC midnight.
const DAY = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET = 60 * 60 * 1000;

function todayUTC(now = Date.now()) {
  const d = new Date(now + LAGOS_OFFSET);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const addDays = (date, n) => new Date(date.getTime() + n * DAY);

function daysUntil(expiryDate, now = Date.now()) {
  return Math.round((new Date(expiryDate).getTime() - todayUTC(now).getTime()) / DAY);
}

// ok | expiring_1m (15-30 days) | expiring_2w (0-14 days) | expired (past)
function statusFromDays(days) {
  if (days < 0) return 'expired';
  if (days <= 14) return 'expiring_2w';
  if (days <= 30) return 'expiring_1m';
  return 'ok';
}

// Mongo date-range filter equivalent to a status, so the DB can filter/sort without loading everything.
function statusRange(status, now = Date.now()) {
  const t = todayUTC(now);
  switch (status) {
    case 'expired': return { $lt: t };
    case 'expiring_2w': return { $gte: t, $lte: addDays(t, 14) };
    case 'expiring_1m': return { $gt: addDays(t, 14), $lte: addDays(t, 30) };
    case 'ok': return { $gt: addDays(t, 30) };
    default: return null;
  }
}

function timeAgo(date, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(date).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

module.exports = { DAY, todayUTC, addDays, daysUntil, statusFromDays, statusRange, timeAgo };
