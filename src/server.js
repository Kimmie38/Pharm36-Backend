const env = require('./config/env');
const { connectDB } = require('./config/db');
const app = require('./app');
const { startExpiryCron } = require('./jobs/expiryScan');

async function main() {
  await connectDB();
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
