const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const connectDB = require('./db');
const Ticket = require('./models/ticket');
const StatusUpdate = require('./models/status');
const { sendStatusUpdateEmail, sendTicketCreationEmail } = require('./services/emailService');
const setupStatsRoutes = require('./stats-api');
const authRoutes = require('./routes/auth');
const { requireAuth, requireAdmin, authenticateAdmin } = require('./middleware/auth');
require('dotenv').config();

// Initialisation de l'application Express
const app = express();
const PORT = process.env.PORT || 3000;

// Connexion à MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration de multer pour le téléchargement de fichiers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limite à 10MB
  fileFilter: (req, file, cb) => {
    // Vérifier les types de fichiers autorisés
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt|csv|zip|mp4|avi|mov|wmv|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé. Seuls les images, vidéos (MP4, AVI, MOV), PDF, documents Office et archives sont acceptés.'));
    }
  }
});

// Routes d'authentification
app.use('/api/auth', authRoutes);

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, '../')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Middleware pour rediriger vers login si non authentifié pour l'interface d'administration
app.use('/admin', (req, res, next) => {
  // Ne pas appliquer la redirection à la page de login elle-même
  if (req.path === '/login.html') {
    return next();
  }
  
  // Vérifier l'en-tête d'autorisation
  const authHeader = req.headers.authorization;
  
  // Si pas d'authentification, rediriger vers login
  if (!authHeader) {
    return res.redirect('/admin/login.html');
  }
  
  // Si authentification avec JWT
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (error) {
      return res.redirect('/admin/login.html');
    }
  }
  
  // Compatibilité Basic Auth temporaire
  // [...code Basic Auth existant si nécessaire...]
  
  next();
});

// Servir les fichiers statiques pour l'administration
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// Route par défaut pour l'administration - redirige vers login si pas connecté
app.get('/admin', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.redirect('/admin/login.html');
  }
  
  res.sendFile(path.join(__dirname, '../admin/index.html'));
});

// Route pour la page de connexion
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../login.html'));
});

// Routes API

// Créer un nouveau ticket (accessible sans authentification)
app.post('/api/tickets', upload.array('documents', 10), async (req, res) => {
  try {
    console.log('Requête reçue:', req.body);
    console.log('Fichiers reçus:', req.files);
    
    // Générer un numéro de ticket unique
    const ticketNumber = Ticket.generateTicketNumber();
    
    // Préparer les données du ticket
    const ticketData = {
      ticketNumber,
      // Définir le type de réclamation
      claimType: req.body.claimType || 'piece_defectueuse',
      clientInfo: {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        phone: req.body.phone
      },
      orderInfo: {
        orderNumber: req.body.orderNumber,
        orderDate: req.body.orderDate
      },
      vehicleInfo: {
        make: req.body.make,
        model: req.body.model,
        year: req.body.year,
        vin: req.body.vin,
        registrationNumber: req.body.registrationNumber,
        installationDate: req.body.installationDate
      },
      partInfo: {
        // Définir une valeur par défaut 'autres' si le type de pièce est vide
        partType: req.body.partType || 'autres',
        symptom: req.body.symptom,
        failureTime: req.body.failureTime,
        errorCodes: req.body.errorCodes,
        // Correction des noms de champs pour correspondre au formulaire
        professionalInstallation: req.body.montage_pro === 'oui' || req.body.professionalInstallation === 'true' || req.body.professionalInstallation === 'on' || req.body.professionalInstallation === true || req.body.professionalInstallation === '1' || req.body.professionalInstallation === 'yes' || req.body.professionalInstallation === 'oui',
        oilFilled: req.body.mise_huile === 'oui' || req.body.oilFilled === 'true' || req.body.oilFilled === 'on' || req.body.oilFilled === true || req.body.oilFilled === '1' || req.body.oilFilled === 'yes' || req.body.oilFilled === 'oui',
        oilQuantity: req.body.oilQuantity,
        oilReference: req.body.oilReference,
        newParts: req.body.newParts === 'true' || req.body.pieces_neuves === 'oui',
        // Correction pour prendre en compte le nom du champ dans le formulaire
        newPartsDetails: req.body.pieces_details || req.body.newPartsDetails
      },
      documents: []
    };
    
    // Ajouter les documents téléchargés
    if (req.files && req.files.length > 0) {
      // Récupérer les types de documents
      const documentTypes = Array.isArray(req.body.documentTypes) ? req.body.documentTypes : [req.body.documentTypes];
      
      req.files.forEach((file, index) => {
        // Mapper les types de documents du formulaire vers les types autorisés dans le schéma
        let documentType = 'documents_autres'; // Type par défaut
        
        // Récupérer le type de document du formulaire
        const formDocType = documentTypes[index] || '';
        
        // Mapper les types de documents du formulaire vers les types autorisés
        if (formDocType.includes('justificatif_pro')) {
          documentType = 'factures_pieces';
        } else if (formDocType.includes('lecture_obd')) {
          documentType = 'lecture_obd';
        } else if (formDocType.includes('photo')) {
          documentType = 'photo_piece';
        } else if (formDocType.includes('facture')) {
          documentType = 'factures_pieces';
        } else if (formDocType.includes('media')) {
          documentType = 'media_transmission';
        } else if (formDocType.includes('moteur')) {
          documentType = 'photos_moteur';
        } else if (formDocType.includes('entretien')) {
          documentType = 'factures_entretien';
        }
        
        console.log(`Mappage de type de document: ${formDocType} -> ${documentType}`);
        
        ticketData.documents.push({
          type: documentType,
          fileName: file.originalname,
          filePath: file.path,
          fileType: file.mimetype,
          uploadDate: new Date()
        });
      });
    }
    
    // Créer le ticket dans la base de données
    const newTicket = new Ticket(ticketData);
    await newTicket.save();
    
    // Créer la première mise à jour de statut
    const statusUpdate = new StatusUpdate({
      ticketId: newTicket._id,
      status: 'nouveau',
      comment: 'Ticket créé',
      updatedBy: 'system',
      clientNotified: true
    });
    await statusUpdate.save();
    
    // Envoyer un email de confirmation au client
    try {
      await sendTicketCreationEmail(newTicket);
      console.log(`Email de confirmation envoyé au client ${newTicket.clientInfo.email}`);
    } catch (emailError) {
      console.error('Erreur lors de l\'envoi de l\'email de confirmation:', emailError);
      // On continue même si l'envoi d'email échoue
    }
    
    // Envoyer la réponse
    res.status(201).json({
      success: true,
      ticketNumber: ticketNumber,
      message: 'Votre demande SAV a été enregistrée avec succès'
    });
    
  } catch (error) {
    console.error('Erreur lors de la création du ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Une erreur est survenue lors de l\'enregistrement de votre demande'
    });
  }
});

// Obtenir un ticket par son numéro
app.get('/api/tickets/:ticketNumber', async (req, res) => {
  try {
    console.log('Recherche du ticket:', req.params.ticketNumber);
    
    if (!req.params.ticketNumber) {
      console.log('Numéro de ticket manquant dans la requête');
      return res.status(400).json({
        success: false,
        message: 'Numéro de ticket requis'
      });
    }
    
    const ticket = await Ticket.findOne({ ticketNumber: req.params.ticketNumber });
    console.log('Résultat de la recherche:', ticket ? 'Ticket trouvé' : 'Ticket non trouvé');
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket non trouvé. Vérifiez le numéro et réessayez.'
      });
    }
    
    // Obtenir l'historique des statuts
    const statusHistory = await StatusUpdate.find({ ticketId: ticket._id }).sort({ updatedAt: -1 });
    console.log(`${statusHistory.length} mises à jour de statut trouvées pour le ticket`);
    
    res.status(200).json({
      success: true,
      ticket,
      statusHistory
    });
    
  } catch (error) {
    console.error('Erreur lors de la récupération du ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Une erreur est survenue lors de la récupération du ticket'
    });
  }
});

// NOTE: La nouvelle implémentation du middleware d'authentification est maintenant dans middleware/auth.js
// Ceci est conservé temporairement pour compatibilité avec l'ancien code
const authenticateAdminLegacy = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentification requise'
    });
  }
  
  // Décodage de l'authentification Basic
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');
  
  // Identifiants fixes pour l'accès directeur (en plus des identifiants dans .env)
  const directeurUsername = 'directeur';
  const directeurPassword = 'CarParts2025';
  
  // Vérification des identifiants (à remplacer par une vérification en base de données)
  if ((username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) ||
      (username === directeurUsername && password === directeurPassword)) {
    next();
  } else {
    res.status(401).json({
      success: false,
      message: 'Identifiants incorrects'
    });
  }
};

// Routes admin (protégées par authentification)

// Récupérer les détails d'un ticket spécifique (admin)
app.get('/api/admin/tickets/:ticketId', requireAuth, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.ticketId);
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket non trouvé'
      });
    }
    
    // Récupérer l'historique des statuts
    const StatusUpdate = require('./models/status');
    const statusHistory = await StatusUpdate.find({ ticketId: ticket._id }).sort({ updatedAt: -1 });
    
    res.status(200).json({
      success: true,
      ticket,
      statusHistory
    });
    
  } catch (error) {
    console.error('Erreur lors de la récupération des détails du ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Une erreur est survenue lors de la récupération des détails du ticket'
    });
  }
});

// Récupérer la liste des tickets (admin)
app.get('/api/admin/tickets', requireAuth, async (req, res) => {
  try {
    // Débogage - Afficher les paramètres de requête
    console.log('Paramètres de requête reçus:', req.query);
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    // Si limit est explicitement 0, ne pas appliquer de limite
    const hasLimit = req.query.limit !== undefined && req.query.limit !== '';
    const parsedLimit = parseInt(req.query.limit);
    const limit = hasLimit ? (parsedLimit === 0 ? null : parsedLimit) : 10;
    const skip = (page - 1) * (limit || 0); // Utiliser 0 pour le calcul si limit est null
    
    // Préparer les conditions de filtre
    const conditions = [];
    
    // Filtres de base
    const baseFilter = {};
    if (req.query.status) baseFilter.currentStatus = req.query.status;
    if (req.query.partType) baseFilter['partInfo.partType'] = req.query.partType;
    if (req.query.priority) baseFilter.priority = req.query.priority;
    
    // Si nous avons des filtres de base, les ajouter aux conditions
    if (Object.keys(baseFilter).length > 0) {
      conditions.push(baseFilter);
    }
    
    // Filtre par numéro de ticket
    if (req.query.ticketNumber && req.query.ticketNumber.trim() !== '') {
      const ticketNumberValue = req.query.ticketNumber.trim();
      console.log('Recherche par numéro de ticket:', ticketNumberValue);
      
      // Utiliser une correspondance exacte pour le numéro de ticket
      // C'est plus fiable que l'expression régulière pour ce cas précis
      console.log('Utilisation d\'une correspondance exacte pour le numéro de ticket');
      
      // Ajouter le filtre directement sans utiliser d'expression régulière
      conditions.push({ ticketNumber: ticketNumberValue });
      
      // Log pour débogage
      console.log('Condition ajoutée pour le numéro de ticket:', { ticketNumber: ticketNumberValue });
    }
    
    // Filtre par numéro de commande
    if (req.query.orderNumber && req.query.orderNumber.trim() !== '') {
      const orderNumberValue = req.query.orderNumber.trim();
      console.log('Recherche par numéro de commande:', orderNumberValue);
      
      // Échapper les caractères spéciaux dans la recherche
      conditions.push({ 
        'orderInfo.orderNumber': new RegExp(orderNumberValue.replace(/[-\[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i') 
      });
    }
    
    // Filtre par prénom de client
    if (req.query.clientFirstName && req.query.clientFirstName.trim() !== '') {
      const clientFirstNameValue = req.query.clientFirstName.trim();
      console.log('Recherche par prénom de client:', clientFirstNameValue);
      
      // Échapper les caractères spéciaux dans la recherche
      const escapedClientFirstName = clientFirstNameValue.replace(/[-\[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const clientFirstNameRegex = new RegExp(escapedClientFirstName, 'i');
      
      // Recherche dans le prénom
      conditions.push({ 'clientInfo.firstName': clientFirstNameRegex });
    }
    
    // Filtre par nom de client
    if (req.query.clientName && req.query.clientName.trim() !== '') {
      const clientNameValue = req.query.clientName.trim();
      console.log('Recherche par nom de client:', clientNameValue);
      
      // Échapper les caractères spéciaux dans la recherche
      const escapedClientName = clientNameValue.replace(/[-\[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const clientNameRegex = new RegExp(escapedClientName, 'i');
      
      // Recherche dans le nom de famille uniquement
      conditions.push({ 'clientInfo.lastName': clientNameRegex });
    }
    
    // Filtres par date
    if (req.query.dateFrom || req.query.dateTo) {
      const dateFilter = {};
      
      if (req.query.dateFrom) {
        dateFilter.$gte = new Date(req.query.dateFrom);
      }
      
      if (req.query.dateTo) {
        // Ajouter un jour à dateTo pour inclure toute la journée
        const dateTo = new Date(req.query.dateTo);
        dateTo.setDate(dateTo.getDate() + 1);
        dateFilter.$lt = dateTo;
      }
      
      conditions.push({ createdAt: dateFilter });
    }
    
    // Recherche globale
    if (req.query.search && req.query.search.trim() !== '') {
      const searchRegex = new RegExp(req.query.search, 'i');
      conditions.push({
        $or: [
          { ticketNumber: searchRegex },
          { 'clientInfo.firstName': searchRegex },
          { 'clientInfo.lastName': searchRegex },
          { 'clientInfo.email': searchRegex },
          { 'vehicleInfo.vin': searchRegex },
          { 'vehicleInfo.registrationNumber': searchRegex },
          { 'orderInfo.orderNumber': searchRegex }
        ]
      });
    }
    
    // Construire le filtre final
    const filter = conditions.length > 0 ? { $and: conditions } : {};
    
    // Débogage - Afficher les filtres générés
    console.log('Filtres appliqués:', JSON.stringify(filter, null, 2));
    
    // Débogage - Afficher le nombre de conditions
    console.log(`Nombre de conditions appliquées: ${conditions.length}`);
    
    // Débogage - Vérifier les paramètres spécifiques
    if (req.query.ticketNumber) {
      console.log(`Filtre par numéro de ticket: ${req.query.ticketNumber}`);
    }
    if (req.query.orderNumber) {
      console.log(`Filtre par numéro de commande: ${req.query.orderNumber}`);
    }
    if (req.query.clientName) {
      console.log(`Filtre par nom de client: ${req.query.clientName}`);
    }
    
    // Exécuter la requête avec des logs détaillés
    console.log('Exécution de la requête avec les filtres suivants:', JSON.stringify(filter, null, 2));
    
    // Construire la requête de base
    let query = Ticket.find(filter).sort({ createdAt: -1 }).skip(skip);
    
    // N'appliquer la limite que si elle n'est pas null
    if (limit !== null) {
      query = query.limit(limit);
    }
    
    // Exécuter la requête
    const tickets = await query;
    
    console.log(`Nombre de tickets trouvés: ${tickets.length}`);
    
    if (tickets.length > 0 && req.query.ticketNumber) {
      console.log('Premier ticket trouvé:', tickets[0].ticketNumber);
      console.log('Numéro de ticket recherché:', req.query.ticketNumber);
    }
    
    // Compter le nombre total de tickets
    const total = await Ticket.countDocuments(filter);
    console.log(`Nombre total de tickets correspondant aux filtres: ${total}`);
    
    // Débogage - Afficher le nombre de résultats
    console.log(`Tickets trouvés: ${tickets.length} sur un total de ${total}`);
    if (tickets.length > 0) {
      console.log('Premier ticket:', tickets[0].ticketNumber);
    }
    
    res.status(200).json({
      success: true,
      tickets,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Erreur lors de la récupération des tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Une erreur est survenue lors de la récupération des tickets'
    });
  }
});

// Mettre à jour le statut d'un ticket (admin)
// Route pour mettre à jour les champs professionalInstallation et oilFilled d'un ticket
app.post('/api/admin/tickets/:ticketId/update-boolean-fields', requireAuth, async (req, res) => {
  try {
    const { professionalInstallation, oilFilled } = req.body;
    
    const ticket = await Ticket.findById(req.params.ticketId);
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket non trouvé'
      });
    }
    
    // Mise à jour des champs booléens avec une meilleure gestion des valeurs
    if (professionalInstallation !== undefined) {
      ticket.partInfo.professionalInstallation = professionalInstallation === true || 
                                                 professionalInstallation === 'true' || 
                                                 professionalInstallation === 'on' || 
                                                 professionalInstallation === '1' || 
                                                 professionalInstallation === 'yes' || 
                                                 professionalInstallation === 'oui';
    }
    
    if (oilFilled !== undefined) {
      ticket.partInfo.oilFilled = oilFilled === true || 
                                  oilFilled === 'true' || 
                                  oilFilled === 'on' || 
                                  oilFilled === '1' || 
                                  oilFilled === 'yes' || 
                                  oilFilled === 'oui';
    }
    
    await ticket.save();
    
    res.status(200).json({
      success: true,
      message: 'Champs booléens mis à jour avec succès',
      ticket
    });
    
  } catch (error) {
    console.error('Erreur lors de la mise à jour des champs booléens:', error);
    res.status(500).json({
      success: false,
      message: 'Une erreur est survenue lors de la mise à jour des champs booléens'
    });
  }
});

app.post('/api/admin/tickets/:ticketId/status', requireAuth, async (req, res) => {
  try {
    const { status, comment, additionalInfoRequested, clientNotified, priority } = req.body;
    
    // Vérifier si le ticket existe
    const ticket = await Ticket.findById(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket non trouvé'
      });
    }
    
    // Créer la mise à jour de statut
    const statusUpdate = new StatusUpdate({
      ticketId: ticket._id,
      status,
      comment,
      additionalInfoRequested,
      clientNotified: clientNotified === true,
      updatedBy: req.body.updatedBy || 'admin'
    });
    await statusUpdate.save();
    
    // Mettre à jour le statut actuel du ticket et la priorité si fournie
    ticket.currentStatus = status;
    if (priority && ['faible', 'moyen', 'élevé', 'urgent'].includes(priority)) {
      ticket.priority = priority;
    }
    if (comment) ticket.internalNotes = ticket.internalNotes ? `${ticket.internalNotes}\n${comment}` : comment;
    await ticket.save();
    
    // Envoyer un email au client si demandé
    if (clientNotified === true) {
      try {
        await sendStatusUpdateEmail(ticket, status, comment);
        console.log(`Email de notification envoyé au client ${ticket.clientInfo.email} pour le ticket ${ticket.ticketNumber}`);
      } catch (emailError) {
        console.error('Erreur lors de l\'envoi de l\'email:', emailError);
        // Ne pas bloquer la mise à jour du ticket si l'email échoue
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Statut du ticket mis à jour avec succès',
      ticket,
      statusUpdate
    });
    
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut:', error);
    res.status(500).json({
      success: false,
      message: 'Une erreur est survenue lors de la mise à jour du statut'
    });
  }
});

// Route pour ajouter des informations complémentaires à un ticket existant
app.post('/api/tickets/additional-info', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    console.log('Requête d\'informations complémentaires reçue:', req.body);
    console.log('Fichiers reçus:', req.files);
    
    const { ticketNumber, message } = req.body;
    
    console.log('ticketNumber:', ticketNumber);
    console.log('message:', message);
    
    if (!ticketNumber) {
      console.log('Erreur: Numéro de ticket manquant');
      return res.status(400).json({ success: false, message: 'Numéro de ticket requis' });
    }
    
    // Rechercher le ticket existant avec la dernière version
    const ticket = await Ticket.findOne({ ticketNumber });
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket non trouvé' });
    }
    
    // Traiter les fichiers téléchargés
    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      console.log(`Traitement de ${req.files.length} fichiers téléchargés...`);
      for (const file of req.files) {
        const newDocument = {
          fileName: file.originalname,  // Utiliser le même format que pour les documents initiaux
          filePath: file.path,         // Utiliser le même format que pour les documents initiaux
          fileType: file.mimetype,     // Utiliser le même format que pour les documents initiaux
          type: 'documents_autres',    // Utiliser une valeur autorisée dans l'énumération
          uploadDate: new Date(),
          size: file.size
        };
        uploadedFiles.push(newDocument);
        console.log(`Fichier traité: ${file.originalname}, chemin: ${file.path}`);
      }
      
      // Ajouter les nouveaux fichiers au ticket
      if (!ticket.documents) {
        ticket.documents = [];
      }
      console.log(`Ajout de ${uploadedFiles.length} documents au ticket. Avant: ${ticket.documents.length} documents`);
      ticket.documents = [...ticket.documents, ...uploadedFiles];
      console.log(`Après: ${ticket.documents.length} documents`);
    }
    
    // Créer une mise à jour de statut pour enregistrer les informations complémentaires
    console.log('Création de la mise à jour de statut...');
    try {
      const statusUpdate = new StatusUpdate({
        ticketId: ticket._id,
        status: ticket.currentStatus, // Conserver le statut actuel
        comment: `Informations complémentaires reçues du client: ${message || 'Aucun message'}`,
        updatedBy: 'client',
        clientNotified: false
      });
      
      console.log('Sauvegarde de la mise à jour de statut...');
      await statusUpdate.save();
      console.log('Mise à jour de statut sauvegardée avec succès');
      
      console.log('Sauvegarde du ticket avec les nouveaux documents...');
      try {
        // Désactiver la vérification de version pour éviter les erreurs de version
        ticket.increment(); // Incrémenter la version pour éviter les conflits
        await ticket.save();
        console.log('Ticket sauvegardé avec succès');
      } catch (saveError) {
        if (saveError.name === 'VersionError') {
          // En cas d'erreur de version, récupérer la version la plus récente du ticket et réappliquer les modifications
          console.log('Erreur de version détectée, récupération de la dernière version du ticket...');
          // Utiliser findOneAndUpdate pour éviter les erreurs de version
          const result = await Ticket.findOneAndUpdate(
            { ticketNumber }, 
            { $push: { documents: { $each: uploadedFiles } } },
            { new: true, runValidators: true }
          );
          
          if (!result) {
            throw new Error('Ticket non trouvé après erreur de version');
          }
          
          console.log(`Documents ajoutés avec succès. Total documents: ${result.documents.length}`);
          console.log('Ticket sauvegardé avec succès après résolution de l\'erreur de version');
        } else {
          // Si ce n'est pas une erreur de version, relancer l'erreur
          throw saveError;
        }
      }
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      throw error; // Relancer l'erreur pour qu'elle soit capturée par le bloc catch principal
    }
    
    // Envoyer un email au service SAV pour notifier des nouvelles informations
    // Note: cette fonction devrait être implémentée dans emailService.js
    // sendClientResponseEmail(ticket, message, uploadedFiles);
    
    res.json({ 
      success: true, 
      message: 'Informations complémentaires ajoutées avec succès',
      ticket: ticket
    });
    
  } catch (error) {
    console.error('Erreur lors de l\'ajout d\'informations complémentaires:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'ajout d\'informations complémentaires' });
  }
});

// Route pour supprimer un ticket (admin uniquement)
app.delete('/api/admin/tickets/:ticketId', requireAuth, async (req, res) => {
  try {
    const ticketId = req.params.ticketId;
    console.log('Tentative de suppression du ticket avec ID:', ticketId);
    console.log('URL de la requête:', req.originalUrl);
    console.log('Méthode de la requête:', req.method);
    console.log('Headers de la requête:', req.headers);
    
    // Vérifier si l'ID est un ObjectId MongoDB valide
    const isValidObjectId = mongoose.Types.ObjectId.isValid(ticketId);
    console.log('L\'ID est-il un ObjectId MongoDB valide ?', isValidObjectId);
    
    let ticket;
    
    if (isValidObjectId) {
      // Recherche par ID MongoDB
      console.log('Recherche du ticket par ID MongoDB...');
      ticket = await Ticket.findById(ticketId);
    } else {
      // Si l'ID n'est pas un ObjectId valide, essayer de chercher par numéro de ticket
      console.log('ID non valide, tentative de recherche par numéro de ticket...');
      if (ticketId.startsWith('CPF-')) {
        ticket = await Ticket.findOne({ ticketNumber: ticketId });
      } else {
        console.error('Format d\'identifiant non reconnu:', ticketId);
        return res.status(400).json({
          success: false,
          message: 'Format d\'identifiant non reconnu'
        });
      }
    }
    
    // Afficher quelques tickets pour débogage
    const allTickets = await Ticket.find({}).limit(5);
    console.log('Exemple de tickets disponibles:', allTickets.map(t => ({ 
      id: t._id.toString(), 
      number: t.ticketNumber 
    })));
    
    if (!ticket) {
      console.log('Ticket non trouvé avec identifiant:', ticketId);
      return res.status(404).json({
        success: false,
        message: 'Ticket non trouvé'
      });
    }
    
    console.log('Ticket trouvé:', ticket.ticketNumber, 'avec ID:', ticket._id.toString());
    
    console.log('Ticket trouvé, suppression de l\'historique des statuts...');
    // Supprimer également l'historique des statuts associé au ticket
    await StatusUpdate.deleteMany({ ticketId: ticketId });
    
    console.log('Suppression du ticket...');
    // Supprimer le ticket
    await Ticket.findByIdAndDelete(ticketId);
    
    console.log('Ticket supprimé avec succès');
    res.status(200).json({
      success: true,
      message: 'Ticket supprimé avec succès'
    });
    
  } catch (error) {
    console.error('Erreur lors de la suppression du ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Une erreur est survenue lors de la suppression du ticket'
    });
  }
});

// Initialiser les routes de statistiques pour le dashboard
setupStatsRoutes(app, requireAuth);

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
});
