/**
 * Gestion de l'authentification côté client
 */

// Vérifier l'authentification au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
  // Récupérer le token depuis localStorage
  const authToken = localStorage.getItem('authToken');
  const userRole = localStorage.getItem('userRole');
  const userName = localStorage.getItem('userName');
  
  if (!authToken) {
    // Rediriger vers la page de connexion si pas de token
    window.location.href = '/admin/login.html';
    return;
  }
  
  // Vérifier si le token est valide
  verifyToken(authToken)
    .then(isValid => {
      if (!isValid) {
        // Token invalide, rediriger vers la page de connexion
        logoutUser();
        return;
      }
      
      // Configurer l'interface selon le rôle
      setupInterface(userRole, userName);
    })
    .catch(error => {
      console.error('Erreur de vérification du token:', error);
      logoutUser();
    });
    
  // Ajouter le bouton de déconnexion
  addLogoutButton();
});

// Vérifier si le token est valide
async function verifyToken(token) {
  try {
    const response = await fetch('/api/auth/verify', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('Erreur de vérification du token:', error);
    return false;
  }
}

// Déconnexion de l'utilisateur
function logoutUser() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userName');
  window.location.href = '/admin/login.html';
}

// Configurer l'interface selon le rôle
function setupInterface(role, userName) {
  console.log('Configuration de l\'interface pour le rôle:', role);
  
  // Ajouter le nom de l'utilisateur à l'interface
  const userNameElement = document.getElementById('user-name');
  if (userNameElement) {
    // Afficher le nom d'utilisateur avec un préfixe selon le rôle
    const rolePrefix = role === 'admin' ? 'Admin: ' : 'Agent SAV: ';
    userNameElement.textContent = rolePrefix + (userName || 'Utilisateur');
    
    // Ajouter une classe CSS selon le rôle pour le style
    userNameElement.classList.remove('admin-role', 'agent-role');
    userNameElement.classList.add(role === 'admin' ? 'admin-role' : 'agent-role');
  }
  
  // Éléments réservés aux administrateurs
  const adminOnlyElements = document.querySelectorAll('.admin-only');
  
  if (role !== 'admin') {
    // Cacher les éléments réservés aux admins
    adminOnlyElements.forEach(element => {
      element.style.display = 'none';
    });
    console.log('Éléments admin masqués');
  }
  
  // Afficher l'interface après vérification
  document.body.classList.remove('loading');
  document.body.classList.add('authenticated');
  
  // Ajouter le rôle à la balise body pour le CSS
  document.body.setAttribute('data-role', role);
  
  console.log('Interface configurée pour le rôle:', role);
}

// Ajouter le bouton de déconnexion à l'interface
function addLogoutButton() {
  // Vérifier si un bouton de déconnexion existe déjà
  if (document.getElementById('logout-button')) {
    return;
  }
  
  // Créer le bouton de déconnexion
  const logoutButton = document.createElement('button');
  logoutButton.id = 'logout-button';
  logoutButton.innerHTML = '<i class="fas fa-sign-out-alt"></i> Déconnexion';
  logoutButton.classList.add('logout-button');
  
  // Ajouter le style pour le bouton
  const style = document.createElement('style');
  style.textContent = `
    .logout-button {
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 8px 12px;
      background-color: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 1000;
      font-size: 14px;
      color: #333;
    }
    
    .logout-button:hover {
      background-color: #e9ecef;
    }
    
    /* Ajouter un conteneur pour l'utilisateur connecté */
    .user-info {
      position: fixed;
      top: 10px;
      right: 140px;
      padding: 8px 12px;
      background-color: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
      color: #333;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 1000;
    }
    
    .user-info i {
      color: #1a73e8;
    }
    
    /* Style pour cacher l'interface pendant le chargement */
    body.loading .main-content {
      opacity: 0.5;
      pointer-events: none;
    }
    
    /* Style pour montrer l'interface après authentification */
    body.authenticated .main-content {
      opacity: 1;
      pointer-events: auto;
    }
  `;
  document.head.appendChild(style);
  
  // Ajouter un élément pour afficher l'utilisateur connecté
  const userInfo = document.createElement('div');
  userInfo.classList.add('user-info');
  userInfo.innerHTML = '<i class="fas fa-user"></i> <span id="user-name">Utilisateur</span>';
  document.body.appendChild(userInfo);
  
  // Ajouter l'événement de déconnexion
  logoutButton.addEventListener('click', () => {
    logoutUser();
  });
  
  // Ajouter le bouton au document
  document.body.appendChild(logoutButton);
}

// Fonction pour créer un nouvel agent SAV (admin uniquement)
async function createAgentUser(username, password, name, email = '') {
  try {
    const token = localStorage.getItem('authToken');
    if (!token) {
      throw new Error('Non authentifié');
    }
    
    const response = await fetch('/api/auth/create-agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        username, 
        password, 
        name,
        email
      })
    });
    
    return await response.json();
  } catch (error) {
    console.error('Erreur de création d\'agent:', error);
    return { 
      success: false, 
      message: 'Erreur lors de la création de l\'agent: ' + error.message 
    };
  }
}

// Exposer les fonctions nécessaires
window.authManager = {
  logout: logoutUser,
  createAgentUser,
  verifyToken
};
