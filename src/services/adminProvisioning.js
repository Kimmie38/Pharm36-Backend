'use strict';

const { z } = require('zod');

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8).max(128);
const councilSchema = z.enum(['PCN', 'VCN', 'ALL']);
const supportedFlags = new Set(['--reset-password', '--set-council']);

class AdminProvisioningError extends Error {}

function parse(schema, value, message) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AdminProvisioningError(message);
  return result.data;
}

function parseFlags(args = []) {
  if (!Array.isArray(args) || args.some((arg) => !supportedFlags.has(arg)) || new Set(args).size !== args.length) {
    throw new AdminProvisioningError('Supported options are --reset-password and --set-council (each at most once).');
  }
  return {
    resetPassword: args.includes('--reset-password'),
    setCouncil: args.includes('--set-council'),
  };
}

async function provisionAdmin({ User, email, password, council, resetPassword = false, setCouncil = false }) {
  if (!User) throw new AdminProvisioningError('Admin provisioning requires the User model.');
  const normalizedEmail = parse(emailSchema, email, 'Set a valid ADMIN_EMAIL before provisioning.');
  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    if (existing.role !== 'admin') {
      throw new AdminProvisioningError('ADMIN_EMAIL already belongs to a non-admin account; refusing role escalation.');
    }
    if (!resetPassword && !setCouncil) {
      return { action: 'unchanged', council: existing.council };
    }

    const nextPassword = resetPassword
      ? parse(passwordSchema, password, 'Set ADMIN_PASSWORD (8–128 characters) for an explicit password reset.')
      : undefined;
    const nextCouncil = setCouncil
      ? parse(councilSchema, council, 'Set ADMIN_COUNCIL to PCN, VCN, or ALL for an explicit scope change.')
      : undefined;

    if (resetPassword) {
      existing.passwordHash = await User.hashPassword(nextPassword);
      existing.tokenVersion = (Number(existing.tokenVersion) || 0) + 1;
    }
    if (setCouncil) existing.council = nextCouncil;
    await existing.save();
    return { action: 'updated', council: existing.council, resetPassword, setCouncil };
  }

  if (resetPassword || setCouncil) {
    throw new AdminProvisioningError('Update options require an existing admin account; no account was created.');
  }

  const validPassword = parse(passwordSchema, password, 'Set ADMIN_PASSWORD (8–128 characters) before creating an admin.');
  const validCouncil = parse(councilSchema, council, 'Set ADMIN_COUNCIL to PCN, VCN, or ALL before creating an admin.');
  const passwordHash = await User.hashPassword(validPassword);
  await User.create({
    role: 'admin',
    name: 'Pharm36 Administrator',
    email: normalizedEmail,
    passwordHash,
    council: validCouncil,
    verificationStatus: 'verified',
    pcnStatus: 'active',
  });
  return { action: 'created', council: validCouncil };
}

module.exports = { AdminProvisioningError, parseFlags, provisionAdmin };
