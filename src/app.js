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

// Public page opened by the pharmacy window QR sticker (no login, no app needed).
app.get('/p/:id', limits.publicLookup, async (req, res, next) => {
  try {
    const { escapeHtml } = require('./utils/html');
    const User = require('./models/User');
    const { pharmacyView } = require('./controllers/public.controller');
    res.set('Cache-Control', 'no-store');
    res.type('html');
    const page = (tone, head, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pharm36 verification</title><style>body{font-family:system-ui,sans-serif;margin:0;background:#0b1f1a;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}.c{max-width:420px;width:100%;background:#12332b;border-radius:16px;padding:28px;text-align:center}.b{display:inline-block;padding:6px 14px;border-radius:99px;font-weight:700;background:${tone}}h1{font-size:22px;margin:16px 0 6px}p{color:#b8d3ca;line-height:1.5;margin:6px 0}small{color:#7fa397}</style></head><body><div class="c"><span class="b">${head}</span>${body}<p><small>Pharm36 &middot; Genuine medicine. Verified professionals.</small></p></div></body></html>`;
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).send(page('#b3261e', 'NOT FOUND', '<h1>We could not find this pharmacy</h1><p>Do not rely on this sticker. Ask to see the pharmacist\'s licence.</p>'));
    const u = await User.findOne({ _id: req.params.id, role: 'professional' }).select('name storeName location state professionalType pcnStatus verificationStatus');
    if (!u) return res.status(404).send(page('#b3261e', 'NOT FOUND', '<h1>We could not find this pharmacy</h1><p>Do not rely on this sticker. Ask to see the pharmacist\'s licence.</p>'));
    const v = pharmacyView(u);
    const where = [v.location, v.state].filter(Boolean).map(escapeHtml).join(', ');
    if (!v.registered) return res.send(page('#b3261e', 'ACCESS REVOKED', `<h1>${escapeHtml(v.name)}</h1><p>This outlet is <b>no longer active</b> on Pharm36. Check with ${v.council} before buying medicine here.</p>`));
    res.send(page(v.licenceVerified ? '#1faa74' : '#b7791f', v.licenceVerified ? 'REGISTERED &amp; VERIFIED' : 'REGISTERED &middot; AWAITING ${v.council} CHECK'.replace('${v.council}', v.council), `<h1>${escapeHtml(v.name)}</h1><p>${where}</p><p>${v.licenceVerified ? 'Licence verified by ' + v.council + '.' : 'Licence check by ' + v.council + ' is still in progress.'}</p><p>You can check any drug from this shop with the Pharm36 app.</p>`));
  } catch (e) { next(e); }
});
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
