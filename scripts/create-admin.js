// npm run admin:create                      -> creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_COUNCIL
// npm run admin:create -- --reset-password  -> sets an existing admin's password to ADMIN_PASSWORD (signs out old sessions)
// npm run admin:create -- --set-council     -> sets an existing admin's council scope to ADMIN_COUNCIL
'use strict';

const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/User');
const { AdminProvisioningError, parseFlags, provisionAdmin } = require('../src/services/adminProvisioning');

(async () => {
  const flags = parseFlags(process.argv.slice(2));
  await connectDB();
  try {
    const result = await provisionAdmin({
      User,
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      council: process.env.ADMIN_COUNCIL,
      ...flags,
    });
    const email = String(process.env.ADMIN_EMAIL).trim().toLowerCase();
    if (result.action === 'created') console.log(`Admin created: ${email} (council ${result.council})`);
    else if (result.action === 'updated') console.log(`Admin updated: ${email} (council ${result.council}${result.resetPassword ? ', password reset' : ''})`);
    else console.log(`Admin already exists: ${email} (council ${result.council}). Nothing changed; use --reset-password or --set-council to update.`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((e) => {
  console.error(e instanceof AdminProvisioningError ? e.message : e);
  process.exit(1);
});
