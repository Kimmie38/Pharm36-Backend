const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const AppError = require('../utils/AppError');

const signToken = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion || 0 }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw new AppError(401, 'Invalid or expired token');
    }
    const user = await User.findById(payload.sub);
    if (!user || (user.tokenVersion || 0) !== payload.tv) throw new AppError(401, 'Session is no longer valid, please log in again');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

const requireRole = (role) => (req, _res, next) =>
  req.user && req.user.role === role ? next() : next(new AppError(403, 'You do not have access to this resource'));

// Revoked professionals can still log in and read, but cannot create/modify anything.
const requireActive = (req, _res, next) =>
  req.user.role === 'admin' || req.user.pcnStatus === 'active'
    ? next()
    : next(new AppError(403, 'Your access has been revoked by your regulatory council. Contact them to restore it.'));

module.exports = { signToken, authenticate, requireRole, requireActive };
