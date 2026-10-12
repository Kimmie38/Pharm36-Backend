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
    const user = await User.findById(payload.sub).select('+deletionInProgress');
    if (!user || (user.tokenVersion || 0) !== payload.tv) throw new AppError(401, 'Session is no longer valid, please log in again');
    if (user.deletionInProgress) throw new AppError(423, 'This account is being permanently deleted');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

const requireRole = (role) => (req, _res, next) =>
  req.user && req.user.role === role ? next() : next(new AppError(403, 'You do not have access to this resource'));

// Re-read the account before writes so a request authenticated just before a deletion lock is rejected.
const requireActive = async (req, _res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+deletionInProgress');
    if (!user || user.deletionInProgress) throw new AppError(423, 'This account is being permanently deleted');
    req.user = user;
    if (user.role === 'admin' || user.pcnStatus === 'active') return next();
    throw new AppError(403, 'Your access has been revoked by your regulatory council. Contact them to restore it.');
  } catch (error) {
    next(error);
  }
};

module.exports = { signToken, authenticate, requireRole, requireActive };
