const env = require('./config/env');
const { connectDB } = require('./config/db');
const app = require('./app');
const { startExpiryCron } = require('./jobs/expiryScan');

// Creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_COUNCIL on boot if it doesn't exist yet
// (for hosts without shell access, e.g. Render free). Never modifies an existing account.
async function ensureAdmin() {
  if (!process.env.ADMIN_EMAIL) return;
  const User = require('./models/User');
  const { provisionAdmin } = require('./services/adminProvisioning');
  try {
    const result = await provisionAdmin({
      User,
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      council: process.env.ADMIN_COUNCIL,
    });
    if (result.action === 'created') console.log(`[admin] created admin account (council ${result.council})`);
  } catch (e) {
    console.error('[admin] could not provision admin:', e.message);
  }
}

async function main() {
  await connectDB();
  await ensureAdmin();
  const server = app.listen(env.port, () => console.log(`[api] Pharm36 backend listening on :${env.port} (${env.nodeEnv})`));
  startExpiryCron();

  const shutdown = (sig) => {
    console.log(`[api] ${sig} received, shutting down`);
    server.close(() => require('mongoose').connection.close().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[api] failed to start:', e.message);
  process.exit(1);
});
