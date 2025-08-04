const mongoose = require('mongoose');
require('dotenv').config();

// URIs de connexion MongoDB
const MONGODB_URI_REMOTE = process.env.MONGODB_URI || 'mongodb+srv://admin:CPF2023@cluster0.p9jbcmx.mongodb.net/carparts_sav';
const MONGODB_URI_LOCAL = 'mongodb://localhost:27017/carparts_sav';

// Options de connexion
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000 // Timeout de 5 secondes pour la sélection du serveur
};

// Connexion à MongoDB
const connectDB = async () => {
  try {
    console.log('Tentative de connexion à MongoDB Atlas...');
    try {
      await mongoose.connect(MONGODB_URI_REMOTE, options);
      console.log('✅ Connexion à MongoDB Atlas établie avec succès');
      return;
    } catch (remoteError) {
      console.warn('Impossible de se connecter à MongoDB Atlas:', remoteError.message);
      console.log('Tentative de connexion à MongoDB local...');
      
      try {
        await mongoose.connect(MONGODB_URI_LOCAL, options);
        console.log('✅ Connexion à MongoDB local établie avec succès');
        return;
      } catch (localError) {
        console.error('❌ Impossible de se connecter à MongoDB local:', localError.message);
        throw new Error('Impossible de se connecter à une base de données MongoDB');
      }
    }
  } catch (error) {
    console.error('❌ Erreur de connexion à MongoDB:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
