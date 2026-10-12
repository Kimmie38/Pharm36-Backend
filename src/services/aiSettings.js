const mongoose = require('mongoose');
const AISettings = require('../models/AISettings');
const env = require('../config/env');
const AppError = require('../utils/AppError');

const CACHE_MS = 5000;
let cachedValue;
let cachedAt = 0;

function defaults() {
  const providerConfigured = Boolean(env.anthropicApiKey);
  return {
    enabled: providerConfigured,
    requestedEnabled: providerConfigured,
    summaryModel: env.anthropicModel,
    askModel: env.anthropicAskModel,
    askPerMinute: 6,
    askPerDay: 40,
    providerConfigured,
    updatedAt: null,
    updatedBy: null,
  };
}

function present(doc) {
  const fallback = defaults();
  const requestedEnabled = doc?.enabled ?? fallback.requestedEnabled;
  return {
    enabled: Boolean(requestedEnabled && fallback.providerConfigured),
    requestedEnabled: Boolean(requestedEnabled),
    summaryModel: doc?.summaryModel || fallback.summaryModel,
    askModel: doc?.askModel || fallback.askModel,
    askPerMinute: doc?.askPerMinute ?? fallback.askPerMinute,
    askPerDay: doc?.askPerDay ?? fallback.askPerDay,
    providerConfigured: fallback.providerConfigured,
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy ? String(doc.updatedBy) : null,
  };
}

async function getAiSettings({ force = false } = {}) {
  if (!force && cachedValue && Date.now() - cachedAt < CACHE_MS) return { ...cachedValue };
  if (mongoose.connection.readyState !== 1) {
    const fallback = defaults();
    cachedValue = fallback;
    cachedAt = Date.now();
    return { ...fallback };
  }
  let doc = null;
  try {
    doc = await AISettings.findOne({ scope: 'global' }).lean();
  } catch {
    // Keep the public drug-label fallback available if the settings collection is unavailable.
    const fallback = defaults();
    cachedValue = fallback;
    cachedAt = Date.now();
    return { ...fallback };
  }
  const value = present(doc);
  cachedValue = value;
  cachedAt = Date.now();
  return { ...value };
}

async function updateAiSettings(actor, changes) {
  if (changes.enabled === true && !env.anthropicApiKey) {
    throw new AppError(409, 'Configure the AI provider key in the hosting secrets before enabling AI. The key is never accepted or stored through this API.');
  }
  const doc = await AISettings.findOneAndUpdate(
    { scope: 'global' },
    { $set: { ...changes, updatedBy: actor._id }, $setOnInsert: { scope: 'global' } },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
  );
  cachedValue = null;
  cachedAt = 0;
  return present(doc);
}

function clearAiSettingsCache() {
  cachedValue = null;
  cachedAt = 0;
}

module.exports = { getAiSettings, updateAiSettings, clearAiSettingsCache, present };
