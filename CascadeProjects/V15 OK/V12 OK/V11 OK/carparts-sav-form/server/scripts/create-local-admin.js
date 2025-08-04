/**
 * Script pour créer un administrateur local avec des identifiants connus
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Connexion à MongoDB local
mongoose.connect('mongodb://localhost:27017/carparts_sav', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connexion à MongoDB locale établie'))
.catch(err => {
  console.error('❌ Erreur de connexion:', err);
  process.exit(1);
});

// Schéma et modèle utilisateur
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

// Fonction pour hacher le mot de passe avant sauvegarde
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

const User = mongoose.models.User || mongoose.model('User', userSchema);

// Identifiants administrateur à créer
const newAdmin = {
  username: 'admintest',
  password: 'admin123',
  name: 'Admin Test',
  role: 'admin'
};

// Créer ou mettre à jour l'administrateur
const createAdmin = async () => {
  try {
    // Vérifier si l'administrateur existe déjà
    let admin = await User.findOne({ username: newAdmin.username });
    
    if (admin) {
      console.log(`L'administrateur '${newAdmin.username}' existe déjà. Mise à jour du mot de passe.`);
      admin.password = newAdmin.password;
      await admin.save();
    } else {
      admin = new User(newAdmin);
      await admin.save();
      console.log(`Nouvel administrateur '${newAdmin.username}' créé avec succès.`);
    }
    
    console.log(`\n✅ IDENTIFIANTS DE CONNEXION:`);
    console.log(`   Nom d'utilisateur: ${newAdmin.username}`);
    console.log(`   Mot de passe: ${newAdmin.password}`);
    console.log(`   Rôle: ${newAdmin.role}\n`);
    
    // Fermer la connexion
    setTimeout(() => {
      mongoose.connection.close();
      console.log('Connexion à la base de données fermée.');
    }, 1000);
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    mongoose.connection.close();
  }
};

// Exécuter la fonction
createAdmin();
