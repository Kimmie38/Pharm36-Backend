const { z } = require('zod');
const { normalizePhone } = require('./phone');
const { NIGERIAN_STATES, expiryBuckets, drugCategories } = require('../constants/professions');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// "YYYY-MM-DD" -> Date at UTC midnight (rejects 2026-02-31 etc.)
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .transform((s, ctx) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      ctx.addIssue({ code: 'custom', message: 'Not a real calendar date' });
      return z.NEVER;
    }
    return d;
  });

const phone = z
  .string()
  .transform((s, ctx) => {
    const p = normalizePhone(s);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. +234 803 555 0142' });
      return z.NEVER;
    }
    return p;
  });

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const state = z.enum(NIGERIAN_STATES, { errorMap: () => ({ message: 'Select a valid Nigerian state' }) });
const reminder = z.enum(expiryBuckets);
const category = z.enum(drugCategories.map((c) => c.key));

// numbers coming from forms as strings are fine ("25" -> 25)
const num = (min = 0) => z.coerce.number().finite().min(min);
const int = (min = 0) => z.coerce.number().int().min(min);

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

module.exports = { z, objectId, isoDate, phone, email, password, state, reminder, category, num, int, pagination };
