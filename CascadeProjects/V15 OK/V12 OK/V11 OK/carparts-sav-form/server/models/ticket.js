const mongoose = require('mongoose');

// Schéma pour les tickets SAV
const ticketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // Type de réclamation
  claimType: {
    type: String,
    required: true,
    enum: ['piece_defectueuse', 'probleme_livraison', 'erreur_reference', 'autre'],
    default: 'piece_defectueuse'
  },
  // Informations client
  clientInfo: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true }
  },
  // Informations commande
  orderInfo: {
    orderNumber: { type: String, required: true },
    orderDate: { type: Date }
  },
  // Informations véhicule
  vehicleInfo: {
    make: { type: String },
    model: { type: String },
    year: { type: Number },
    vin: { type: String },
    registrationNumber: { type: String },
    installationDate: { type: Date }
  },
  // Informations pièce (pour les réclamations de type 'piece_defectueuse')
  partInfo: {
    partType: { type: String, enum: ['boite_vitesses', 'moteur', 'mecatronique', 'boite_transfert', 'pont', 'autres'] },
    symptom: { type: String },
    failureTime: { type: String },
    errorCodes: { type: String },
    professionalInstallation: { type: Boolean },
    oilFilled: { type: Boolean },
    oilQuantity: { type: Number },
    oilReference: { type: String },
    newParts: { type: Boolean },
    newPartsDetails: { type: String }
  },
  
  // Informations livraison (pour les réclamations de type 'probleme_livraison')
  deliveryInfo: {
    trackingNumber: { type: String },
    deliveryDate: { type: Date },
    carrier: { type: String },
    issueType: { type: String, enum: ['retard', 'colis_endommage', 'colis_perdu', 'livraison_partielle', 'autre'] },
    issueDescription: { type: String }
  },
  
  // Informations erreur référence (pour les réclamations de type 'erreur_reference')
  referenceErrorInfo: {
    receivedPartReference: { type: String },
    expectedPartReference: { type: String },
    compatibilityIssue: { type: Boolean },
    issueDescription: { type: String }
  },
  // Documents
  documents: [{
    type: { type: String, enum: ['lecture_obd', 'photo_piece', 'factures_pieces', 'media_transmission', 'factures_transmission', 'photos_moteur', 'factures_entretien', 'documents_autres', 'justificatif_pro_file'] },
    fileName: { type: String },
    filePath: { type: String },
    fileType: { type: String },
    uploadDate: { type: Date, default: Date.now }
  }],
  // Statut actuel
  currentStatus: {
    type: String,
    required: true,
    enum: ['nouveau', 'en_analyse', 'info_complementaire', 'validé', 'refusé', 'en_cours_traitement', 'expédié', 'clôturé'],
    default: 'nouveau'
  },
  // Priorité du ticket
  priority: {
    type: String,
    enum: ['faible', 'moyen', 'élevé', 'urgent'],
    default: 'moyen'
  },
  // Métadonnées
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Champ pour les notes internes
  internalNotes: {
    type: String
  }
});

// Middleware pour mettre à jour le champ updatedAt avant chaque sauvegarde
ticketSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Méthode pour générer un numéro de ticket unique
ticketSchema.statics.generateTicketNumber = function() {
  const prefix = "CPF"; // Car Parts France
  const date = new Date();
  const year = date.getFullYear().toString().substr(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  
  return `${prefix}-${year}${month}${day}-${randomPart}`;
};

const Ticket = mongoose.model('Ticket', ticketSchema);

module.exports = Ticket;
