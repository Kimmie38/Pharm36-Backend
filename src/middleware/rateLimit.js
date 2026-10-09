const rateLimit = require('express-rate-limit');

const make = (windowMs, limit, message) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message } });

module.exports = {
  global: make(15 * 60 * 1000, 600, 'Too many requests, slow down'),
  auth: make(15 * 60 * 1000, 20, 'Too many attempts, try again in a few minutes'),
  publicLookup: make(60 * 1000, 60, 'Too many lookups, try again in a minute'),
  publicInfo: make(60 * 1000, 30, 'Too many lookups, try again in a minute'),
  publicAskMinute: make(60 * 1000, 6, 'You are asking too fast, please wait a moment'),
  publicAskDay: make(24 * 60 * 60 * 1000, 40, 'Daily question limit reached, please try again tomorrow'),
  publicReport: make(60 * 60 * 1000, 10, 'Too many reports from this device, try again later'),
};
