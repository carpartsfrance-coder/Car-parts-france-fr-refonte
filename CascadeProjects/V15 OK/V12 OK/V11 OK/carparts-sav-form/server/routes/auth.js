const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Route de connexion
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Vérifier si l'utilisateur existe
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Nom d\'utilisateur ou mot de passe incorrect' 
      });
    }
    
    // Vérifier le mot de passe
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Nom d\'utilisateur ou mot de passe incorrect' 
      });
    }
    
    // Mettre à jour la date de dernière connexion
    user.lastLogin = new Date();
    await user.save();
    
    // Créer le token JWT
    const token = jwt.sign(
      { userId: user._id, role: user.role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '8h' }
    );
    
    res.json({ 
      success: true, 
      token, 
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role
      } 
    });
    
  } catch (error) {
    console.error('Erreur d\'authentification:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la connexion' 
    });
  }
});

// Route pour vérifier si un token est valide
router.get('/verify', requireAuth, async (req, res) => {
  res.json({ 
    success: true, 
    user: req.user 
  });
});

// Route pour créer un utilisateur agent SAV (admin uniquement)
router.post('/create-agent', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, name, email } = req.body;
    
    // Vérifier si l'utilisateur existe déjà
    const userExists = await User.findOne({ username });
    if (userExists) {
      return res.status(400).json({ 
        success: false, 
        message: 'Ce nom d\'utilisateur existe déjà' 
      });
    }
    
    // Créer le nouvel utilisateur
    const user = new User({
      username,
      password,
      name,
      email,
      role: 'agent_sav'
    });
    
    await user.save();
    
    res.status(201).json({ 
      success: true, 
      message: 'Agent SAV créé avec succès'
    });
    
  } catch (error) {
    console.error('Erreur création agent:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la création de l\'agent' 
    });
  }
});

// Liste des utilisateurs (admin uniquement)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json({ 
      success: true, 
      users 
    });
  } catch (error) {
    console.error('Erreur récupération utilisateurs:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération des utilisateurs' 
    });
  }
});

// Route pour créer un utilisateur (admin uniquement)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, name, role } = req.body;
    
    // Valider les données
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Le nom d\'utilisateur et le mot de passe sont requis' 
      });
    }
    
    // Vérifier si l'utilisateur existe déjà
    const userExists = await User.findOne({ username });
    if (userExists) {
      return res.status(400).json({ 
        success: false, 
        message: 'Ce nom d\'utilisateur existe déjà' 
      });
    }
    
    // Créer le nouvel utilisateur
    const user = new User({
      username,
      password,
      name: name || '',
      role: role || 'user'
    });
    
    await user.save();
    
    // Retourner le succès sans le mot de passe
    const userResponse = user.toObject();
    delete userResponse.password;
    
    res.status(201).json({ 
      success: true, 
      message: 'Utilisateur créé avec succès',
      user: userResponse
    });
    
  } catch (error) {
    console.error('Erreur création utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'utilisateur'
    });
  }
});

// Obtenir les détails d'un utilisateur spécifique (admin uniquement)
router.get('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Erreur récupération détails utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des détails de l\'utilisateur'
    });
  }
});

// Mettre à jour un utilisateur (admin uniquement)
router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, name, email } = req.body;
    
    // Vérifier si l'utilisateur existe
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
    
    // Vérifier si le nom d'utilisateur est déjà utilisé par un autre utilisateur
    if (username !== user.username) {
      const userExists = await User.findOne({ username });
      if (userExists) {
        return res.status(400).json({
          success: false,
          message: 'Ce nom d\'utilisateur est déjà utilisé'
        });
      }
    }
    
    // Mettre à jour les champs
    user.username = username;
    user.name = name;
    if (email) user.email = email;
    
    // Mettre à jour le mot de passe uniquement s'il est fourni
    if (password) {
      user.password = password;
    }
    
    await user.save();
    
    res.json({
      success: true,
      message: 'Utilisateur mis à jour avec succès'
    });
  } catch (error) {
    console.error('Erreur mise à jour utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de l\'utilisateur'
    });
  }
});

// Route pour réinitialiser le mot de passe d'un utilisateur (admin uniquement)
router.post('/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
    
    // Générer un mot de passe aléatoire temporaire
    const crypto = require('crypto');
    const temporaryPassword = crypto.randomBytes(4).toString('hex'); // 8 caractères
    
    // Mettre à jour le mot de passe de l'utilisateur
    user.password = temporaryPassword;
    await user.save();
    
    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès',
      temporaryPassword: temporaryPassword
    });
  } catch (error) {
    console.error('Erreur réinitialisation mot de passe:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la réinitialisation du mot de passe'
    });
  }
});

// Supprimer un utilisateur (admin uniquement)
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
    
    // Empêcher la suppression du dernier administrateur
    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Impossible de supprimer le dernier administrateur du système'
        });
      }
    }
    
    // Empêcher la suppression de son propre compte
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas supprimer votre propre compte'
      });
    }
    
    await User.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Utilisateur supprimé avec succès'
    });
  } catch (error) {
    console.error('Erreur suppression utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de l\'utilisateur'
    });
  }
});

module.exports = router;
