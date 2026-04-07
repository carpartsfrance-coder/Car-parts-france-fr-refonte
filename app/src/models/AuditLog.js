const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', index: true },
    userEmail: { type: String, trim: true, lowercase: true, index: true },
    action: { type: String, trim: true, required: true, index: true },
    entityType: { type: String, trim: true, index: true }, // 'sav_ticket', 'admin_user', etc.
    entityId: { type: String, trim: true, index: true },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

// TTL : 2 ans
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 * 2 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
