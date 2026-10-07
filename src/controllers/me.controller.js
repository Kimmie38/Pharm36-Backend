const User = require('../models/User');
const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');
const { professionalTypes } = require('../constants/professions');
const { serializeUser } = require('../services/serializers');
const { signToken } = require('../middleware/auth');

const getMe = (req, res) => res.json({ user: serializeUser(req.user) });

async function updateMe(req, res) {
  const b = req.valid.body;
  const user = req.user;

  if (b.phone && b.phone !== user.phone) {
    if (await User.exists({ phone: b.phone, _id: { $ne: user._id } })) throw new AppError(409, 'This phone number is already in use');
    user.phone = b.phone;
  }
  if (b.email && b.email !== user.email) {
    if (await User.exists({ email: b.email, _id: { $ne: user._id } })) throw new AppError(409, 'This email is already in use');
    user.email = b.email;
  }
  for (const k of ['name', 'storeName', 'location', 'state', 'licenseNo']) if (b[k] !== undefined) user[k] = b[k];

  if (b.sections && user.role === 'professional') {
    const valid = professionalTypes[user.professionalType].sections.map((s) => s.key);
    const bad = b.sections.filter((s) => !valid.includes(s));
    if (bad.length) throw new AppError(400, `Invalid section(s): ${bad.join(', ')}`);
    const next = [...new Set(b.sections)];
    const added = next.filter((s) => !user.sections.includes(s));
    user.sections = next;
    // dropping a claim also drops its verification; adding one sends it back to the council for review
    user.verifiedSections = user.verifiedSections.filter((s) => next.includes(s));
    if (added.length) user.verificationStatus = 'pending';
  }
  if (b.settings) {
    if (b.settings.defaultReminder) user.settings.defaultReminder = b.settings.defaultReminder;
    if (b.settings.pushEnabled !== undefined) user.settings.pushEnabled = b.settings.pushEnabled;
  }
  await user.save();
  res.json({ user: serializeUser(user) });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.valid.body;
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await user.comparePassword(currentPassword))) throw new AppError(400, 'Current password is incorrect');
  user.passwordHash = await User.hashPassword(newPassword);
  user.tokenVersion += 1;
  await user.save();
  res.json({ message: 'Password changed', token: signToken(user) }); // fresh token for this device
}

async function setPushToken(req, res) {
  req.user.expoPushToken = req.valid.body.token;
  await req.user.save();
  res.json({ message: 'Push token saved' });
}

// ---- notifications ----
async function listNotifications(req, res) {
  const { unread, page, limit } = req.valid.query;
  const filter = { user: req.user._id, ...(unread ? { read: false } : {}) };
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);
  res.json({ items, total, unreadCount, page, limit });
}

async function markRead(req, res) {
  const n = await Notification.findOneAndUpdate({ _id: req.valid.params.id, user: req.user._id }, { read: true }, { returnDocument: 'after' });
  if (!n) throw new AppError(404, 'Notification not found');
  res.json({ notification: n });
}

async function markAllRead(req, res) {
  const r = await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ updated: r.modifiedCount });
}

module.exports = { getMe, updateMe, changePassword, setPushToken, listNotifications, markRead, markAllRead };
