const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Vérifier si l'utilisateur est authentifié avec JWT
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Utilisateur non trouvé'
        });
      }
      
      // Mettre à jour la date de dernière connexion
      user.lastLogin = new Date();
      await user.save();
      
      // Ajouter les informations utilisateur à la requête
      req.user = {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role
      };
      
      next();
    } catch (error) {
      console.error('Erreur JWT:', error);
      return res.status(401).json({
        success: false,
        message: 'Token invalide ou expiré'
      });
    }
  } catch (error) {
    console.error('Erreur d\'authentification:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de l\'authentification'
    });
  }
};

// Vérifier si l'utilisateur est un administrateur
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Accès réservé aux administrateurs'
    });
  }
  
  next();
};

// Pour maintenir la compatibilité avec le code existant
const authenticateAdmin = async (req, res, next) => {
  // Vérifier d'abord l'authentification JWT
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // JWT est présent, utiliser le middleware JWT
    return requireAuth(req, res, () => {
      // Vérifier si l'utilisateur est admin
      if (req.user && req.user.role === 'admin') {
        next();
      } else {
        res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs'
        });
      }
    });
  }
  
  // Fallback sur l'authentification Basic pour la compatibilité
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
  
  // Vérifier dans la base de données s'il existe des utilisateurs
  try {
    // Chercher d'abord un utilisateur correspondant
    const user = await User.findOne({ username });
    if (user) {
      const isMatch = await user.comparePassword(password);
      if (isMatch && user.role === 'admin') {
        // Ajouter l'utilisateur à la requête
        req.user = {
          id: user._id,
          username: user.username,
          name: user.name,
          role: user.role
        };
        return next();
      }
    }
    
    // Fallback sur les variables d'environnement (pour la compatibilité)
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      res.status(401).json({
        success: false,
        message: 'Identifiants incorrects'
      });
    }
  } catch (error) {
    console.error('Erreur lors de l\'authentification:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de l\'authentification'
    });
  }
};

module.exports = { requireAuth, requireAdmin, authenticateAdmin };
