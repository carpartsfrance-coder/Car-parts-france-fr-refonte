const mongoose = require('mongoose');

const adminUserSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    passwordSalt: { type: String, required: true },
    role: {
      type: String,
      enum: ['owner', 'employe'],
      default: 'employe',
      required: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date, default: null },
    passwordUpdatedAt: { type: Date, default: Date.now },
    createdByAdminUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('AdminUser', adminUserSchema);
