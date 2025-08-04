const mongoose = require('mongoose');

// Schéma pour les mises à jour de statut
const statusUpdateSchema = new mongoose.Schema({
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true
  },
  status: {
    type: String,
    required: true,
    enum: ['nouveau', 'en_analyse', 'info_complementaire', 'validé', 'refusé', 'en_cours_traitement', 'expédié', 'clôturé']
  },
  comment: {
    type: String
  },
  updatedBy: {
    type: String,
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Champ pour indiquer si le client a été notifié de cette mise à jour
  clientNotified: {
    type: Boolean,
    default: false
  },
  // Champ pour stocker les informations complémentaires demandées au client
  additionalInfoRequested: {
    type: String
  }
});

const StatusUpdate = mongoose.model('StatusUpdate', statusUpdateSchema);

module.exports = StatusUpdate;
