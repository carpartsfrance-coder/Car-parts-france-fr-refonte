/**
 * Version modifiée du fichier db.js pour utiliser uniquement MongoDB Atlas
 */
const mongoose = require('mongoose');
require('dotenv').config();

// URI de connexion MongoDB Atlas (valeur par défaut si la variable d'environnement n'est pas définie)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://admin:CPF2023@cluster0.p9jbcmx.mongodb.net/carparts_sav';

// Options de connexion
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000 // Augmenté à 10 secondes pour donner plus de temps à Atlas
};

// Fonction de connexion à MongoDB Atlas uniquement
const connectDB = async () => {
  try {
    console.log('🔄 Tentative de connexion à MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI, options);
    console.log('✅ Connexion à MongoDB Atlas établie avec succès');
  } catch (error) {
    console.error('❌ Erreur de connexion à MongoDB Atlas:', error.message);
    console.error('Détails de l\'erreur:', error);
    process.exit(1);
  }
};

module.exports = connectDB;
