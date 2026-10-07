const crypto = require('crypto');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const env = require('../config/env');
const { signToken } = require('../middleware/auth');
const { normalizePhone } = require('../utils/phone');
const { professionalTypes } = require('../constants/professions');
const { serializeUser } = require('../services/serializers');

async function register(req, res) {
  const b = req.valid.body;
  const profession = professionalTypes[b.professionalType];
  const validSections = profession.sections.map((s) => s.key);
  const bad = b.sections.filter((s) => !validSections.includes(s));
  if (bad.length) throw new AppError(400, `Invalid section(s) for a ${profession.label}: ${bad.join(', ')}`);

  const clash = await User.findOne({ $or: [{ phone: b.phone }, { email: b.email }] }).select('phone email');
  if (clash) {
    throw new AppError(409, clash.phone === b.phone ? 'An account with this phone number already exists' : 'An account with this email already exists');
  }

  const user = await User.create({
    role: 'professional',
    professionalType: b.professionalType,
    name: b.name,
    storeName: b.storeName,
    phone: b.phone,
    email: b.email,
    location: b.location,
    state: b.state,
    licenseNo: b.licenseNo,
    sections: [...new Set(b.sections)],
    verifiedSections: [], // the council confirms these in the admin portal
    verificationStatus: 'pending', // submitted to PCN/VCN in the background; full access starts immediately
    passwordHash: await User.hashPassword(b.password),
  });

  res.status(201).json({ token: signToken(user), user: serializeUser(user) });
}

async function login(req, res) {
  const { identifier, password } = req.valid.body;
  const query = identifier.includes('@')
    ? { email: identifier.trim().toLowerCase() }
    : { phone: normalizePhone(identifier) || '__none__' };
  const user = await User.findOne(query).select('+passwordHash');
  // same message for unknown user / wrong password so accounts can't be enumerated
  if (!user || !(await user.comparePassword(password))) throw new AppError(401, 'Incorrect phone/email or password');
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: signToken(user), user: serializeUser(user) });
}

async function forgotPassword(req, res) {
  const { identifier } = req.valid.body;
  const query = identifier.includes('@')
    ? { email: identifier.trim().toLowerCase() }
    : { phone: normalizePhone(identifier) || '__none__' };
  const user = await User.findOne(query);
  const response = { message: 'If an account exists, a reset code has been sent.' };
  if (user) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    user.resetTokenHash = crypto.createHash('sha256').update(`${user._id}:${code}`).digest('hex');
    user.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();
    // TODO: send `code` via SMS/email provider (Termii, Twilio, SendGrid...). Never return it in production.
    if (!env.isProd) {
      console.log(`[auth] password reset code for ${identifier}: ${code}`);
      response.devCode = code;
    }
  }
  res.json(response);
}

async function resetPassword(req, res) {
  const { identifier, code, password } = req.valid.body;
  const query = identifier.includes('@')
    ? { email: identifier.trim().toLowerCase() }
    : { phone: normalizePhone(identifier) || '__none__' };
  const user = await User.findOne(query).select('+resetTokenHash +resetTokenExpires');
  const hash = user && crypto.createHash('sha256').update(`${user._id}:${code}`).digest('hex');
  if (!user || !user.resetTokenHash || user.resetTokenHash !== hash || user.resetTokenExpires < new Date()) {
    throw new AppError(400, 'Invalid or expired reset code');
  }
  user.passwordHash = await User.hashPassword(password);
  user.tokenVersion += 1; // log out every existing session
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();
  res.json({ message: 'Password updated. Please log in.' });
}

module.exports = { register, login, forgotPassword, resetPassword };
