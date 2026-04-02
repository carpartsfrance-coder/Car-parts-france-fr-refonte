const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: '', trim: true },
    optionsSelection: { type: Object, default: {} },
    optionsSummary: { type: String, default: '', trim: true },
    unitPriceCents: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 99 },
    lineTotalCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const shipmentDocumentSchema = new mongoose.Schema(
  {
    originalName: { type: String, default: '', trim: true },
    storedName: { type: String, default: '', trim: true },
    storedPath: { type: String, default: '', trim: true },
    mimeType: { type: String, default: 'application/pdf', trim: true },
    sizeBytes: { type: Number, default: 0 },
    stamped: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: null },
  },
  { _id: false }
);

const shipmentSchema = new mongoose.Schema(
  {
    label: { type: String, default: '', trim: true },
    carrier: { type: String, default: '', trim: true },
    trackingNumber: { type: String, required: true, trim: true },
    note: { type: String, default: '', trim: true },
    document: { type: shipmentDocumentSchema, default: null },
    createdAt: { type: Date, required: true },
    createdBy: { type: String, default: '', trim: true },
  },
  { timestamps: false }
);

const consigneLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 1, max: 99 },
    amountCents: { type: Number, required: true, min: 0 },
    delayDays: { type: Number, required: true, min: 0, max: 3650 },
    startAt: { type: Date, default: null },
    dueAt: { type: Date, default: null, index: true },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: false }
);

const addressSnapshotSchema = new mongoose.Schema(
  {
    label: { type: String, default: '', trim: true },
    fullName: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: '', trim: true },
    postalCode: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    country: { type: String, default: 'France', trim: true },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['draft', 'en_attente', 'validee', 'expediee', 'livree', 'annulee'],
      required: true,
    },
    changedAt: { type: Date, required: true },
    changedBy: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const emailSentSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    sentAt: { type: Date, required: true },
    recipientEmail: { type: String, default: '', trim: true },
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    reason: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const orderDocumentSchema = new mongoose.Schema(
  {
    docType: {
      type: String,
      enum: ['etiquette_envoi', 'bon_retour', 'recuperation_clonage', 'facture', 'bon_commande', 'autre'],
      default: 'autre',
    },
    originalName: { type: String, default: '', trim: true },
    storedName: { type: String, default: '', trim: true },
    storedPath: { type: String, default: '', trim: true },
    mimeType: { type: String, default: 'application/pdf', trim: true },
    sizeBytes: { type: Number, default: 0 },
    stamped: { type: Boolean, default: false },
    note: { type: String, default: '', trim: true },
    uploadedAt: { type: Date, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    uploadedByName: { type: String, default: '', trim: true },
  },
  { timestamps: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    number: { type: String, required: true, unique: true, trim: true },
    invoice: {
      number: { type: String, default: '', trim: true, index: true },
      issuedAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: ['draft', 'en_attente', 'validee', 'expediee', 'livree', 'annulee'],
      default: 'en_attente',
      required: true,
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    accountType: { type: String, enum: ['particulier', 'pro'], required: true },
    paymentProvider: { type: String, default: 'mollie', trim: true },
    paymentStatus: { type: String, default: 'pending', trim: true },
    molliePaymentId: { type: String, default: '', trim: true, index: true },
    molliePaymentStatus: { type: String, default: '', trim: true },
    mollieCheckoutUrl: { type: String, default: '', trim: true },
    mollieProfileId: { type: String, default: '', trim: true },
    molliePaidAt: { type: Date, default: null },
    mollieLastCheckedAt: { type: Date, default: null },
    scalapayOrderToken: { type: String, default: '', trim: true, index: true },
    scalapayCheckoutUrl: { type: String, default: '', trim: true },
    scalapayStatus: { type: String, default: '', trim: true },
    scalapayCapturedAt: { type: Date, default: null },
    scalapayLastCheckedAt: { type: Date, default: null },
    stockReservedAt: { type: Date, default: null },
    stockReleasedAt: { type: Date, default: null },
    currency: { type: String, default: 'EUR', trim: true },
    shippingMethod: { type: String, default: 'domicile', trim: true },
    shippingCostCents: { type: Number, default: 0, min: 0 },
    itemsSubtotalCents: { type: Number, default: 0, min: 0 },
    clientDiscountPercent: { type: Number, default: 0, min: 0, max: 90 },
    clientDiscountCents: { type: Number, default: 0, min: 0 },
    promoCode: { type: String, default: '', trim: true },
    promoDiscountCents: { type: Number, default: 0, min: 0 },
    itemsTotalAfterDiscountCents: { type: Number, default: 0, min: 0 },
    notifications: {
      orderConfirmationSentAt: { type: Date, default: null },
      consigneStartSentAt: { type: Date, default: null },
      consigneReceivedSentAt: { type: Date, default: null },
      consigneReminderSoonSentAt: { type: Date, default: null },
      consigneOverdueSentAt: { type: Date, default: null },
      shipmentLastSentAt: { type: Date, default: null },
      shipmentTrackingNumbersSent: { type: [String], default: [] },
      deliveryConfirmedSentAt: { type: Date, default: null },
      statusChangeSentAt: { type: Date, default: null },
    },
    emailsSent: { type: [emailSentSchema], default: [] },
    consigne: {
      lines: { type: [consigneLineSchema], default: [] },
    },
    shipments: { type: [shipmentSchema], default: [] },
    totalCents: { type: Number, required: true, min: 0 },
    items: { type: [orderItemSchema], required: true },
    shippingAddress: { type: addressSnapshotSchema, required: true },
    billingAddress: { type: addressSnapshotSchema, required: true },
    vehicle: {
      identifierType: { type: String, enum: ['', 'plate', 'vin'], default: '', trim: true },
      plate: { type: String, default: '', trim: true },
      vin: { type: String, default: '', trim: true },
      consentAt: { type: Date, default: null },
      providedAt: { type: Date, default: null },
    },
    legal: {
      cgvAcceptedAt: { type: Date, default: null },
      cgvSlug: { type: String, default: 'cgv', trim: true },
      cgvUpdatedAt: { type: Date, default: null },
    },
    source: {
      channel: {
        type: String,
        enum: ['website', 'phone', 'email', 'whatsapp', 'leboncoin', 'marketplace', 'salon', 'manual', 'other'],
        default: 'website',
      },
      detail: { type: String, default: '', trim: true },
    },
    isManual: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    noteInternal: { type: String, default: '', trim: true },
    noteClient: { type: String, default: '', trim: true },
    quoteReference: { type: String, default: '', trim: true },
    documents: { type: [orderDocumentSchema], default: [] },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
