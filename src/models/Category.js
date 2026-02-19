const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },

    shippingClassId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShippingClass', default: null },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Category', categorySchema);
