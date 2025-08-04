/**
 * Script pour créer un utilisateur administrateur initial
 * Exécuter avec: node scripts/create-admin.js
 */

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

// Charger la configuration de connexion
const dbConnect = async () => {
  try {
    // Si .env n'est pas trouvé dans le répertoire parent, essayer de le charger depuis le répertoire courant
    if (!process.env.MONGO_URI) {
      require('dotenv').config();
    }
    
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!mongoUri) {
      console.error('❌ Variable d\'environnement MONGO_URI ou MONGODB_URI non définie');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connexion à MongoDB établie');
  } catch (error) {
    console.error('❌ Erreur de connexion à MongoDB:', error);
    process.exit(1);
  }
};

// Fonction principale
const createAdmin = async () => {
  try {
    // Connexion à la base de données
    await dbConnect();
    
    // Définir le modèle User dynamiquement
    const userSchema = new mongoose.Schema({
      username: { 
        type: String, 
        required: true,
        unique: true 
      },
      password: { 
        type: String, 
        required: true 
      },
      name: { 
        type: String, 
        required: true 
      },
      email: {
        type: String,
        required: false
      },
      role: { 
        type: String, 
        enum: ['admin', 'agent_sav'], 
        default: 'agent_sav'
      },
      createdAt: { 
        type: Date, 
        default: Date.now 
      },
      lastLogin: {
        type: Date,
        default: null
      }
    });
    
    // Méthode pour hacher le mot de passe
    userSchema.pre('save', async function(next) {
      if (!this.isModified('password')) return next();
      
      try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
      } catch (error) {
        next(error);
      }
    });
    
    // Créer le modèle s'il n'existe pas déjà
    const User = mongoose.models.User || mongoose.model('User', userSchema);
    
    // Vérifier si un admin existe déjà
    const adminExists = await User.findOne({ role: 'admin' });
    
    if (adminExists) {
      console.log('ℹ️ Un administrateur existe déjà:', adminExists.username);
      await mongoose.disconnect();
      return;
    }
    
    // Demander des informations pour le nouvel admin
    const username = process.argv[2] || 'admin';
    const password = process.argv[3] || 'admin123'; // À changer immédiatement après la première connexion
    const name = process.argv[4] || 'Administrateur';
    const email = process.argv[5] || '';
    
    // Créer l'admin
    const admin = new User({
      username,
      password,
      name,
      email,
      role: 'admin'
    });
    
    await admin.save();
    
    console.log('✅ Administrateur créé avec succès:');
    console.log('   Nom d\'utilisateur:', username);
    console.log('   Nom:', name);
    console.log('⚠️  IMPORTANT: Changez le mot de passe après la première connexion!');
    
    // Mettre à jour .env avec la variable JWT_SECRET si elle n'existe pas
    const envPath = path.resolve(__dirname, '../.env');
    let envContent = '';
    
    try {
      envContent = fs.readFileSync(envPath, 'utf8');
    } catch (error) {
      console.error('❌ Fichier .env non trouvé. Création d\'un nouveau fichier.');
      envContent = '';
    }
    
    if (!envContent.includes('JWT_SECRET=')) {
      // Générer un JWT_SECRET aléatoire
      const crypto = require('crypto');
      const jwtSecret = crypto.randomBytes(64).toString('hex');
      
      fs.appendFileSync(envPath, `\n\n# Secret pour JWT (généré automatiquement)\nJWT_SECRET=${jwtSecret}\n`);
      console.log('✅ JWT_SECRET ajouté au fichier .env');
    }
    
    await mongoose.disconnect();
    console.log('✅ Déconnexion de MongoDB');
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
};

// Exécuter la fonction principale
createAdmin();
