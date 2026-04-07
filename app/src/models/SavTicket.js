const mongoose = require('mongoose');

const PIECE_TYPES = [
  'mecatronique_dq200',
  'mecatronique_dq250',
  'mecatronique_dq381',
  'mecatronique_dq500',
  'boite_transfert',
  'pont',
  'differentiel',
  'haldex',
  'reducteur',
  'cardan',
  'autre',
];

const STATUTS = [
  'ouvert',
  'pre_qualification',
  'en_attente_documents',
  'retour_demande',
  'en_transit_retour',
  'recu_atelier',
  'en_analyse',
  'analyse_terminee',
  'en_attente_decision_client',
  'resolu_garantie',
  'resolu_facture',
  'clos',
  'refuse',
];

const messageSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    auteur: { type: String, required: true },
    canal: {
      type: String,
      enum: ['email', 'whatsapp', 'tel', 'interne'],
      required: true,
    },
    contenu: { type: String, required: true },
  },
  { _id: true }
);

const savTicketSchema = new mongoose.Schema(
  {
    numero: { type: String, unique: true, index: true },

    pieceType: { type: String, enum: PIECE_TYPES, required: true },
    referencePiece: { type: String, trim: true },
    numeroSerie: { type: String, trim: true },
    dateAchat: { type: Date },
    numeroCommande: { type: String, trim: true, index: true },

    vehicule: {
      marque: { type: String, trim: true },
      modele: { type: String, trim: true },
      motorisation: { type: String, trim: true },
      vin: { type: String, trim: true, uppercase: true, index: true },
      immatriculation: { type: String, trim: true, uppercase: true },
      kilometrage: { type: Number, min: 0 },
    },

    client: {
      nom: { type: String, trim: true, required: true },
      email: { type: String, trim: true, lowercase: true, required: true, index: true },
      telephone: { type: String, trim: true },
      adresse: { type: String, trim: true },
      type: { type: String, enum: ['B2C', 'B2B'], default: 'B2C' },
    },

    garage: {
      nom: { type: String, trim: true },
      adresse: { type: String, trim: true },
      telephone: { type: String, trim: true },
      factureMontage: { type: String, trim: true }, // URL doc
    },

    documents: {
      factureMontage: { type: String, trim: true },
      photosObd: [{ type: String, trim: true }],
      confirmationReglageBase: { type: String, trim: true },
      photosVisuelles: [{ type: String, trim: true }],
    },

    // Liste enrichie (nouveaux uploads). Conserve méta pour affichage admin.
    documentsList: [
      {
        kind: { type: String, trim: true },          // factureMontage|photoObd|photoPiece|autre
        url: { type: String, trim: true, required: true },
        originalName: { type: String, trim: true },
        size: { type: Number, min: 0 },              // octets
        mime: { type: String, trim: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    diagnostic: {
      symptomes: [{ type: String, trim: true }],
      codesDefaut: [{ type: String, trim: true }],
      scoreRisque: { type: Number, min: 0, max: 100, default: 0 },
      redFlags: [{ type: String, trim: true }],
      description: { type: String, trim: true }, // texte libre client
    },

    montage: {
      date: { type: Date },
      reglageBase: { type: String, enum: ['oui', 'non', 'inconnu'] },
    },

    cgvAcceptance: {
      version: { type: String, trim: true },
      acceptedAt: { type: Date },
      ip: { type: String, trim: true },
    },

    workflow: {
      track: {
        type: String,
        enum: ['red_flag', 'retour_systematique'],
        default: 'retour_systematique',
      },
      etape: { type: String, trim: true },
      statut: { type: String, trim: true },
    },

    statut: {
      type: String,
      enum: STATUTS,
      default: 'ouvert',
      index: true,
    },

    analyse: {
      rapport: { type: String, trim: true }, // PDF URL
      conclusion: {
        type: String,
        enum: ['defaut_produit', 'mauvais_montage', 'usure_normale', 'non_defectueux'],
      },
      facture149: {
        status: {
          type: String,
          enum: ['na', 'a_facturer', 'payee', 'impayee'],
          default: 'na',
        },
      },
      photosBanc: [{ type: String, trim: true }],
    },

    resolution: {
      type: {
        type: String,
        enum: [
          'echange',
          'reparation',
          'remboursement',
          'retour_pieces',
          'piece_conservee_impaye',
        ],
      },
      montant: { type: Number, min: 0 },
      dateResolution: { type: Date },
    },

    paiements: {
      facture149: {
        status: {
          type: String,
          enum: ['na', 'a_facturer', 'payee', 'impayee'],
          default: 'na',
        },
        mollieId: { type: String, trim: true },
        dateGeneration: { type: Date },
        datePaiement: { type: Date },
      },
    },

    sla: {
      dateOuverture: { type: Date, default: Date.now },
      dateLimite: { type: Date },
      alertes: [
        {
          date: { type: Date, default: Date.now },
          type: { type: String, trim: true },
          message: { type: String, trim: true },
        },
      ],
      escalade: { type: Boolean, default: false },
    },

    messages: [messageSchema],

    fournisseur: {
      contact: { type: String, trim: true },
      dateEnvoi: { type: Date },
      dateRetour: { type: Date },
      reponse: { type: String, trim: true },
    },

    preuveQualite: {
      videoTest: { type: String, trim: true },
      screenshotBanc: { type: String, trim: true },
      certificatReconditionnement: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

savTicketSchema.index({ numero: 1 });
savTicketSchema.index({ 'client.email': 1 });
savTicketSchema.index({ statut: 1 });
savTicketSchema.index({ 'vehicule.vin': 1 });

// ---------- Helpers ----------

function addBusinessDays(startDate, days) {
  const date = new Date(startDate);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay(); // 0 dim, 6 sam
    if (day !== 0 && day !== 6) added += 1;
  }
  return date;
}

// ---------- Statics ----------

savTicketSchema.statics.generateNumero = async function generateNumero() {
  const year = new Date().getFullYear();
  const prefix = `SAV-${year}-`;
  const last = await this.findOne({ numero: new RegExp(`^${prefix}`) })
    .sort({ numero: -1 })
    .select('numero')
    .lean();
  let seq = 1;
  if (last && last.numero) {
    const parsed = parseInt(last.numero.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) seq = parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
};

// ---------- Hooks ----------

savTicketSchema.pre('save', async function preSave(next) {
  try {
    if (this.isNew && !this.numero) {
      this.numero = await this.constructor.generateNumero();
    }
    if (!this.sla) this.sla = {};
    if (!this.sla.dateOuverture) this.sla.dateOuverture = new Date();
    if (!this.sla.dateLimite) {
      this.sla.dateLimite = addBusinessDays(this.sla.dateOuverture, 5);
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ---------- Methods ----------

savTicketSchema.methods.addMessage = function addMessage(auteur, canal, contenu) {
  this.messages.push({ auteur, canal, contenu, date: new Date() });
  return this;
};

savTicketSchema.methods.changerStatut = function changerStatut(nouveauStatut, auteur) {
  const ancien = this.statut;
  this.statut = nouveauStatut;
  this.addMessage(
    auteur || 'systeme',
    'interne',
    `Changement de statut : ${ancien} → ${nouveauStatut}`
  );
  // Hook notif (lazy require pour éviter cycle)
  try {
    const notif = require('../services/savNotifications');
    // fire-and-forget : ne bloque jamais le save
    Promise.resolve(notif.notifyStatusChange(this, nouveauStatut)).catch(() => {});
  } catch (_) {}
  return this;
};

module.exports = mongoose.model('SavTicket', savTicketSchema);
