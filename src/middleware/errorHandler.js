const { ZodError } = require('zod');
const AppError = require('../utils/AppError');
const env = require('../config/env');

function notFound(req, _res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    });
  }
  if (err.name === 'CastError') return res.status(400).json({ error: `Invalid ${err.path}` });
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'value';
    return res.status(409).json({ error: `A record with this ${field} already exists` });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });

  if (/buffering timed out|MongoServerSelectionError|MongoNetworkError/.test(`${err.name} ${err.message}`)) {
    return res.status(503).json({ error: 'Service temporarily unavailable, please try again shortly' });
  }

  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong', ...(env.isProd ? {} : { detail: err.message }) });
}

module.exports = { notFound, errorHandler };
