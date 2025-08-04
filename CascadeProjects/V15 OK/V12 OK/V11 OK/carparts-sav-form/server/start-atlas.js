/**
 * Script de démarrage qui utilise uniquement MongoDB Atlas
 */

// Remplacer la fonction de connexion standard par celle pour Atlas uniquement
const originalDbPath = './db';
const atlasDbPath = './db-atlas';

// Sauvegarder l'original require
const originalRequire = require;

// Intercepter les appels à require pour notre fichier db.js
require = function(path) {
  if (path === originalDbPath) {
    console.log('🔄 Redirection vers la connexion MongoDB Atlas uniquement');
    return originalRequire(atlasDbPath);
  }
  return originalRequire(path);
};

// Charger le serveur principal avec notre connexion Atlas
console.log('🚀 Démarrage du serveur avec connexion MongoDB Atlas uniquement');
require('./server');
