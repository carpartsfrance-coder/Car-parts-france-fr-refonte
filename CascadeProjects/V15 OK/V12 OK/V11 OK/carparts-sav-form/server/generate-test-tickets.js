/**
 * Script pour générer des tickets de test dans la base de données
 * Exécuter avec: node generate-test-tickets.js
 */

const mongoose = require('mongoose');
const connectDB = require('./db');
const Ticket = require('./models/ticket');
const StatusUpdate = require('./models/status');

// Connexion à la base de données
connectDB();

// Données aléatoires pour la génération de tickets
const firstNames = ['Jean', 'Pierre', 'Marie', 'Sophie', 'Thomas', 'Émilie', 'Lucas', 'Léa', 'Nicolas', 'Julie'];
const lastNames = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau'];
const emailDomains = ['gmail.com', 'yahoo.fr', 'hotmail.com', 'outlook.fr', 'orange.fr', 'free.fr', 'sfr.fr'];
const carMakes = ['Renault', 'Peugeot', 'Citroën', 'Volkswagen', 'BMW', 'Mercedes', 'Audi', 'Toyota', 'Ford', 'Opel'];
const carModels = {
  'Renault': ['Clio', 'Megane', 'Captur', 'Kadjar', 'Scenic'],
  'Peugeot': ['208', '308', '3008', '508', '5008'],
  'Citroën': ['C3', 'C4', 'C5', 'Berlingo', 'DS3'],
  'Volkswagen': ['Golf', 'Polo', 'Passat', 'Tiguan', 'T-Roc'],
  'BMW': ['Série 1', 'Série 3', 'Série 5', 'X1', 'X3'],
  'Mercedes': ['Classe A', 'Classe C', 'Classe E', 'GLA', 'GLC'],
  'Audi': ['A3', 'A4', 'A6', 'Q3', 'Q5'],
  'Toyota': ['Yaris', 'Corolla', 'RAV4', 'C-HR', 'Prius'],
  'Ford': ['Fiesta', 'Focus', 'Kuga', 'Puma', 'Mondeo'],
  'Opel': ['Corsa', 'Astra', 'Mokka', 'Grandland', 'Crossland']
};
const partTypes = ['boite_vitesses', 'moteur', 'mecatronique', 'boite_transfert', 'pont', 'autres'];
const symptoms = [
  'Bruit anormal', 'Fuite d\'huile', 'Ne démarre pas', 'Vibrations', 'Perte de puissance',
  'Passage de vitesse difficile', 'Surchauffe', 'Voyant moteur allumé', 'À-coups', 'Fumée à l\'échappement'
];
const statuses = ['nouveau', 'en_analyse', 'info_complementaire', 'validé', 'refusé', 'en_cours_traitement', 'expédié', 'clôturé'];
const priorities = ['faible', 'moyen', 'élevé', 'urgent'];

// Fonction pour générer un nombre aléatoire entre min et max
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Fonction pour obtenir un élément aléatoire d'un tableau
function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Fonction pour générer une date aléatoire entre deux dates
function getRandomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

// Fonction pour générer un numéro d'immatriculation aléatoire
function generateRandomRegistration() {
  const letters1 = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letters2 = getRandomElement(letters1) + getRandomElement(letters1);
  const numbers = getRandomInt(100, 999);
  const letters3 = getRandomElement(letters1) + getRandomElement(letters1);
  return `${letters2}-${numbers}-${letters3}`;
}

// Fonction pour générer un numéro de commande aléatoire
function generateRandomOrderNumber() {
  return `ORD-${getRandomInt(10000, 99999)}`;
}

// Fonction pour générer un VIN aléatoire
function generateRandomVIN() {
  const chars = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';
  let vin = '';
  for (let i = 0; i < 17; i++) {
    vin += chars[Math.floor(Math.random() * chars.length)];
  }
  return vin;
}

// Fonction pour générer un ticket aléatoire
async function generateRandomTicket() {
  const firstName = getRandomElement(firstNames);
  const lastName = getRandomElement(lastNames);
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${getRandomElement(emailDomains)}`;
  const phone = `0${getRandomInt(6, 7)}${getRandomInt(10000000, 99999999)}`;
  
  const make = getRandomElement(carMakes);
  const model = getRandomElement(carModels[make]);
  const year = getRandomInt(2010, 2025);
  
  const partType = getRandomElement(partTypes);
  const symptom = getRandomElement(symptoms);
  
  const createdAt = getRandomDate(new Date(2024, 0, 1), new Date());
  const status = getRandomElement(statuses);
  const priority = getRandomElement(priorities);
  
  // Générer un ticket avec le modèle Mongoose
  const ticket = new Ticket({
    ticketNumber: Ticket.generateTicketNumber(),
    clientInfo: {
      firstName,
      lastName,
      email,
      phone
    },
    orderInfo: {
      orderNumber: generateRandomOrderNumber(),
      orderDate: getRandomDate(new Date(2023, 0, 1), createdAt)
    },
    vehicleInfo: {
      make,
      model,
      year,
      vin: generateRandomVIN(),
      registrationNumber: generateRandomRegistration(),
      installationDate: getRandomDate(new Date(2023, 0, 1), createdAt)
    },
    partInfo: {
      partType,
      symptom,
      failureTime: `${getRandomInt(1, 12)} mois`,
      errorCodes: getRandomInt(0, 1) ? `P${getRandomInt(1000, 9999)}` : '',
      professionalInstallation: Math.random() > 0.5,
      oilFilled: Math.random() > 0.3,
      oilQuantity: getRandomInt(3, 8),
      oilReference: Math.random() > 0.5 ? `OIL-${getRandomInt(1000, 9999)}` : '',
      newParts: Math.random() > 0.7,
      newPartsDetails: Math.random() > 0.7 ? 'Remplacement des joints et filtres' : ''
    },
    currentStatus: status,
    priority,
    createdAt,
    updatedAt: getRandomDate(createdAt, new Date()),
    internalNotes: Math.random() > 0.5 ? 'Notes internes pour le traitement du dossier.' : ''
  });
  
  try {
    const savedTicket = await ticket.save();
    console.log(`Ticket créé: ${savedTicket.ticketNumber}`);
    
    // Générer des mises à jour de statut aléatoires
    if (status !== 'nouveau') {
      const statusHistory = [];
      const possibleStatuses = statuses.slice(0, statuses.indexOf(status) + 1);
      
      for (let i = 0; i < possibleStatuses.length; i++) {
        if (Math.random() > 0.3 || i === possibleStatuses.length - 1) {
          const statusDate = i === 0 ? createdAt : getRandomDate(createdAt, new Date());
          
          const statusUpdate = new StatusUpdate({
            ticketId: savedTicket._id,
            status: possibleStatuses[i],
            comment: `Mise à jour du statut vers ${possibleStatuses[i]}`,
            updatedBy: 'Système (génération automatique)',
            updatedAt: statusDate
          });
          
          await statusUpdate.save();
          statusHistory.push(possibleStatuses[i]);
        }
      }
      
      console.log(`Historique des statuts pour ${savedTicket.ticketNumber}: ${statusHistory.join(' -> ')}`);
    }
    
    return savedTicket;
  } catch (error) {
    console.error(`Erreur lors de la création du ticket:`, error);
    return null;
  }
}

// Fonction principale pour générer plusieurs tickets
async function generateTestTickets(count) {
  console.log(`Génération de ${count} tickets de test...`);
  
  const tickets = [];
  for (let i = 0; i < count; i++) {
    const ticket = await generateRandomTicket();
    if (ticket) tickets.push(ticket);
  }
  
  console.log(`${tickets.length} tickets ont été générés avec succès.`);
  return tickets;
}

// Exécuter la génération de tickets
generateTestTickets(30)
  .then(() => {
    console.log('Génération de tickets terminée.');
    mongoose.connection.close();
    process.exit(0);
  })
  .catch(error => {
    console.error('Erreur lors de la génération des tickets:', error);
    mongoose.connection.close();
    process.exit(1);
  });
