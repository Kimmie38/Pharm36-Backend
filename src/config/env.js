require('dotenv').config({ path: ['.env.local', '.env'] });

const bool = (v, d) => (v === undefined ? d : String(v).toLowerCase() === 'true');
const nodeEnv = process.env.NODE_ENV || 'development';

if (!process.env.JWT_SECRET) {
  if (nodeEnv === 'test') process.env.JWT_SECRET = 'test-secret';
  else throw new Error('JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
}

module.exports = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pharm36',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  requireSectionVerification: bool(process.env.REQUIRE_SECTION_VERIFICATION, true),
  enableCron: bool(process.env.ENABLE_CRON, true),
  cronSchedule: process.env.CRON_SCHEDULE || '0 6 * * *',
  cronTimezone: process.env.CRON_TIMEZONE || 'Africa/Lagos',
  salesLevelHigh: Number(process.env.SALES_LEVEL_HIGH) || 8000,
  salesLevelMedium: Number(process.env.SALES_LEVEL_MEDIUM) || 3000,
};
