/**
 * Script pour créer un administrateur temporaire avec des identifiants connus
 * Exécuter avec: node create-temp-admin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Charger la configuration de connexion
const dbConnect = async () => {
  try {
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
const createTempAdmin = async () => {
  try {
    // Connexion à la base de données
    await dbConnect();
    
    // Charger le modèle User
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
    
    // Méthode pour comparer les mots de passe
    userSchema.methods.comparePassword = async function(candidatePassword) {
      return await bcrypt.compare(candidatePassword, this.password);
    };
    
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
    
    // Récupérer le modèle User
    const User = mongoose.models.User || mongoose.model('User', userSchema);
    
    // Identifiants pour le nouvel admin
    const username = 'admintest';
    const password = 'admin123';
    const name = 'Admin Test';
    
    // Vérifier si l'utilisateur existe déjà
    let user = await User.findOne({ username });
    
    if (user) {
      console.log(`✅ L'utilisateur ${username} existe déjà. Mise à jour du mot de passe.`);
      user.password = password;
      await user.save();
    } else {
      // Créer l'admin
      user = new User({
        username,
        password,
        name,
        role: 'admin'
      });
      
      await user.save();
      console.log(`✅ Nouvel utilisateur administrateur créé: ${username}`);
    }
    
    console.log('✅ Opération terminée avec succès');
    console.log('   Nom d\'utilisateur:', username);
    console.log('   Mot de passe:', password);
    console.log('   Rôle:', 'admin');
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
};

// Exécuter la fonction principale
createTempAdmin();
