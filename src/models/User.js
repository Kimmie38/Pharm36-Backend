const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jsonPlugin = require('./plugins');
const { expiryBuckets } = require('../constants/professions');

const userSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['professional', 'admin'], default: 'professional', index: true },
    // professional fields
    professionalType: { type: String, enum: ['pharmacist', 'veterinary'] },
    name: { type: String, required: true, trim: true },
    storeName: { type: String, trim: true },
    phone: { type: String, unique: true, sparse: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    location: { type: String, trim: true },
    state: { type: String, trim: true, index: true },
    licenseNo: { type: String, trim: true },
    // sections the professional ticked at sign-up vs. the ones the council has confirmed
    sections: { type: [String], default: [] },
    verifiedSections: { type: [String], default: [] },
    // internal review state (never shown as "pending" to the professional)
    verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', index: true },
    // access state shown in the app: active | revoked
    pcnStatus: { type: String, enum: ['active', 'revoked'], default: 'active' },
    settings: {
      defaultReminder: { type: String, enum: expiryBuckets, default: '1 month' },
      pushEnabled: { type: Boolean, default: true },
    },
    expoPushToken: { type: String },
    // admin accounts: which council they act for
    council: { type: String, enum: ['PCN', 'VCN', 'ALL'] },
    tokenVersion: { type: Number, default: 0 },
    deletionInProgress: { type: Boolean, default: false, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 12);

jsonPlugin(userSchema, ['passwordHash', 'resetTokenHash', 'resetTokenExpires', 'tokenVersion', 'expoPushToken', 'deletionInProgress']);

module.exports = mongoose.model('User', userSchema);
