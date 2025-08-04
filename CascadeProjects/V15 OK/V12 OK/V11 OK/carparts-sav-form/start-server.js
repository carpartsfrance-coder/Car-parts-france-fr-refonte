/**
 * Script de démarrage du serveur avec initialisation d'un compte administrateur
 * 
 * Ce script vérifie qu'un administrateur existe avant de démarrer le serveur.
 * Si aucun administrateur n'existe, il en crée un avec les identifiants par défaut.
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const readline = require('readline');
const bcrypt = require('bcrypt');

// Charger les variables d'environnement
require('dotenv').config();

// Créer une interface de ligne de commande
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Vérifier la présence des variables d'environnement essentielles
function checkEnvironmentVariables() {
  const requiredVars = ['MONGO_URI', 'JWT_SECRET'];
  const missingVars = [];

  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.error('\x1b[31m%s\x1b[0m', `❌ Variables d'environnement manquantes: ${missingVars.join(', ')}`);
    console.log('\x1b[33m%s\x1b[0m', '⚠️  Création du fichier .env avec des valeurs par défaut...');
    
    // Créer un fichier .env avec des valeurs par défaut
    let envContent = '';
    
    // MongoDB URI
    if (!process.env.MONGO_URI) {
      envContent += 'MONGO_URI=mongodb://localhost:27017/carparts-sav\n';
    }
    
    // JWT Secret
    if (!process.env.JWT_SECRET) {
      // Générer un JWT secret aléatoire
      const crypto = require('crypto');
      const jwtSecret = crypto.randomBytes(64).toString('hex');
      envContent += `JWT_SECRET=${jwtSecret}\n`;
    }
    
    // Écrire le fichier .env
    fs.appendFileSync(path.resolve(__dirname, '.env'), envContent);
    
    console.log('\x1b[32m%s\x1b[0m', '✅ Fichier .env créé avec succès');
    
    // Recharger les variables d'environnement
    require('dotenv').config();
    return true;
  }
  
  return true;
}

// Se connecter à MongoDB
async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('\x1b[32m%s\x1b[0m', '✅ Connexion à MongoDB établie');
    return true;
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `❌ Erreur de connexion à MongoDB: ${error.message}`);
    return false;
  }
}

// Vérifier s'il existe un utilisateur admin
async function checkAdminExists() {
  try {
    // Définir dynamiquement le modèle utilisateur
    let User;
    
    try {
      User = mongoose.model('User');
    } catch (e) {
      // Le modèle n'existe pas encore, le définir
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
      
      // Méthode pour comparer les mots de passe
      userSchema.methods.comparePassword = async function(candidatePassword) {
        return await bcrypt.compare(candidatePassword, this.password);
      };
      
      User = mongoose.model('User', userSchema);
    }
    
    // Vérifier si un administrateur existe
    const adminCount = await User.countDocuments({ role: 'admin' });
    return adminCount > 0;
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `❌ Erreur lors de la vérification des administrateurs: ${error.message}`);
    return false;
  }
}

// Créer un utilisateur administrateur
async function createAdminUser() {
  return new Promise((resolve) => {
    console.log('\x1b[33m%s\x1b[0m', '⚠️  Aucun administrateur trouvé. Création d\'un compte administrateur...');
    
    rl.question('Nom d\'utilisateur (admin): ', (username) => {
      const adminUsername = username || 'admin';
      
      rl.question('Mot de passe (admin123): ', (password) => {
        const adminPassword = password || 'admin123';
        
        rl.question('Nom complet (Administrateur): ', (name) => {
          const adminName = name || 'Administrateur';
          
          rl.question('Email (optionnel): ', async (email) => {
            try {
              // Obtenir le modèle utilisateur
              const User = mongoose.model('User');
              
              // Créer l'administrateur
              const admin = new User({
                username: adminUsername,
                password: adminPassword,
                name: adminName,
                email: email || '',
                role: 'admin'
              });
              
              await admin.save();
              console.log('\x1b[32m%s\x1b[0m', '✅ Administrateur créé avec succès!');
              console.log('\x1b[36m%s\x1b[0m', `📝 Identifiants: ${adminUsername} / ${adminPassword}`);
              console.log('\x1b[33m%s\x1b[0m', '⚠️  IMPORTANT: Changez ce mot de passe après la première connexion!');
              resolve(true);
            } catch (error) {
              console.error('\x1b[31m%s\x1b[0m', `❌ Erreur lors de la création de l'administrateur: ${error.message}`);
              resolve(false);
            }
          });
        });
      });
    });
  });
}

// Démarrer le serveur Node.js
function startServer() {
  console.log('\x1b[36m%s\x1b[0m', '🚀 Démarrage du serveur...');
  
  // Utiliser nodemon pour le développement si disponible, sinon node
  const serverProcess = exec('npx nodemon server/server.js || node server/server.js', (error) => {
    if (error) {
      console.error('\x1b[31m%s\x1b[0m', `❌ Erreur lors du démarrage du serveur: ${error.message}`);
      process.exit(1);
    }
  });
  
  // Transmettre la sortie du processus serveur à la console
  serverProcess.stdout.pipe(process.stdout);
  serverProcess.stderr.pipe(process.stderr);
  
  // Gérer l'arrêt propre du serveur
  process.on('SIGINT', () => {
    serverProcess.kill();
    mongoose.connection.close();
    rl.close();
    console.log('\n\x1b[36m%s\x1b[0m', '👋 Arrêt du serveur, au revoir!');
    process.exit(0);
  });
}

// Fonction principale
async function main() {
  console.log('\x1b[36m%s\x1b[0m', '🔧 Initialisation du serveur SAV Car Parts France...');
  
  // Vérifier les variables d'environnement
  const envOk = checkEnvironmentVariables();
  if (!envOk) return;
  
  // Se connecter à la base de données
  const dbConnected = await connectToDatabase();
  if (!dbConnected) return;
  
  // Vérifier si un administrateur existe
  const adminExists = await checkAdminExists();
  
  if (!adminExists) {
    // Créer un administrateur s'il n'existe pas
    const adminCreated = await createAdminUser();
    if (!adminCreated) return;
  } else {
    console.log('\x1b[32m%s\x1b[0m', '✅ Un administrateur existe déjà dans le système');
  }
  
  // Fermer l'interface readline
  rl.close();
  
  // Démarrer le serveur
  startServer();
}

// Exécuter la fonction principale
main().catch(error => {
  console.error('\x1b[31m%s\x1b[0m', `❌ Erreur non gérée: ${error.message}`);
  process.exit(1);
});
