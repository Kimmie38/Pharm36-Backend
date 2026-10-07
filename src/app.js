const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const env = require('./config/env');
const limits = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1); // behind Render/Railway/Nginx so rate-limits see the real client IP

app.use(helmet());
app.use(
  cors({
    // React Native requests have no Origin header and are always allowed; browsers must be listed in CORS_ORIGINS.
    origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin) || !env.isProd),
  })
);
app.use(express.json({ limit: '100kb' }));
if (env.nodeEnv !== 'test') app.use(morgan(env.isProd ? 'combined' : 'dev'));
app.use(limits.global);

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', uptime: process.uptime() })
);

app.use('/api/meta', require('./routes/meta.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/me', require('./routes/me.routes'));
app.use('/api/public', require('./routes/public.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
// Pharmacist/vet app routes. Gated by prefix so unknown /api/* paths fall through to a clean 404
// instead of hitting the auth middleware.
const professionalRoutes = require('./routes/professional.routes');
app.use('/api', (req, res, next) =>
  /^\/(dashboard|sales|batches|marketplace)(\/|$)/.test(req.path) ? professionalRoutes(req, res, next) : next()
);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
