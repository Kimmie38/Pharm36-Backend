'use strict';

// Manual, one-time command. It is never run automatically during API startup.
require('../src/config/env'); // loads ignored .env.local first, then .env
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/User');
const { AdminProvisioningError, parseFlags, provisionAdmin } = require('../src/services/adminProvisioning');

async function main(args = process.argv.slice(2)) {
  const flags = parseFlags(args);
  try {
    await connectDB();
    const result = await provisionAdmin({
      User,
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      council: process.env.ADMIN_COUNCIL,
      ...flags,
    });
    const scope = result.council || 'unchanged';
    const message = result.action === 'created'
      ? 'Admin account created'
      : result.action === 'updated'
        ? 'Existing admin account updated'
        : 'Existing admin account left unchanged';
    console.log(`[seed:admin] ${message} (council scope: ${scope}).`);
    return result;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof AdminProvisioningError
      ? error.message
      : 'Database/seed operation failed; details were withheld to avoid exposing environment values.';
    console.error(`[seed:admin] ${message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
