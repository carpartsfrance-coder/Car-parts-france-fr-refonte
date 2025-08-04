/**
 * Gestion des utilisateurs - Page dédiée
 * Version page indépendante avec sa propre URL
 */

document.addEventListener('DOMContentLoaded', () => {
    // Solution radicale: Trouver l'en-tête spécifique de cette page et reconstruire complètement sa structure
    const usersPageHeader = document.getElementById('users-page-header');
    
    if (usersPageHeader) {
        // Trouver le div user-info dans l'en-tête et le supprimer complètement
        const userInfoToRemove = usersPageHeader.querySelector('.user-info');
        if (userInfoToRemove) {
            console.log('Suppression complète de l\'ancien .user-info');
            userInfoToRemove.remove();
        }
        
        // Créer un nouveau conteneur pour nos informations utilisateur
        const newUserInfo = document.createElement('div');
        newUserInfo.className = 'users-page-info';
        newUserInfo.style.display = 'flex';
        newUserInfo.style.alignItems = 'center';
        newUserInfo.style.gap = '15px';
        
        // Placer le nouveau conteneur à la fin de l'en-tête
        usersPageHeader.appendChild(newUserInfo);
        
        console.log('Nouveau conteneur user-info créé avec classe unique');
    }
    
    // Vérifier si l'utilisateur est connecté et a les droits d'administrateur
    checkAuth();
    
    // Initialiser les événements pour la gestion des utilisateurs
    initUserManagement();
});

// Vérifier si l'utilisateur est connecté
function checkAuth() {
    const authToken = localStorage.getItem('authToken');
    const userRole = localStorage.getItem('userRole');
    
    if (!authToken) {
        // Afficher le formulaire de connexion
        document.getElementById('admin-login').style.display = 'flex';
        document.getElementById('users-section').style.display = 'none';
        return;
    }
    
    // Vérifier s'il s'agit d'un accès direct à la page (non via redirection)
    if (userRole !== 'admin') {
        console.log('Accès non autorisé à la page utilisateurs (rôle: ' + userRole + ')');
        
        // Au lieu de rediriger, juste masquer les éléments de gestion des utilisateurs
        document.getElementById('users-section').style.display = 'none';
        
        // Créer une alerte d'accès non autorisé
        const mainContent = document.querySelector('.admin-content');
        if (mainContent) {
            const alertDiv = document.createElement('div');
            alertDiv.className = 'access-denied';
            alertDiv.style.backgroundColor = '#f8d7da';
            alertDiv.style.color = '#721c24';
            alertDiv.style.padding = '20px';
            alertDiv.style.margin = '20px';
            alertDiv.style.borderRadius = '5px';
            alertDiv.style.textAlign = 'center';
            
            const icon = document.createElement('i');
            icon.className = 'fas fa-exclamation-triangle';
            icon.style.marginRight = '10px';
            alertDiv.appendChild(icon);
            
            const message = document.createTextNode('Accès refusé : Vous n\'avez pas les droits pour accéder à cette page.');
            alertDiv.appendChild(message);
            
            // Ajouter un lien de retour à la page principale
            const backLink = document.createElement('div');
            backLink.innerHTML = '<a href="index.html" style="display: block; margin-top: 15px; color: #721c24; text-decoration: underline;"><i class="fas fa-arrow-left"></i> Retour au tableau de bord</a>';
            alertDiv.appendChild(backLink);
            
            // Insérer en début de contenu
            mainContent.prepend(alertDiv);
        }
        
        return;
    }
    
    // Utilisateur connecté et admin
    document.getElementById('admin-login').style.display = 'none';
    document.getElementById('users-section').style.display = 'block';
    
    // Mettre à jour le nom de l'utilisateur dans l'en-tête
    const username = localStorage.getItem('userName');
    
    // Trouver notre nouveau conteneur pour les infos utilisateur
    const userPageInfo = document.querySelector('.users-page-info');
    if (userPageInfo && username) {
        // Vider le conteneur pour éviter les duplications
        userPageInfo.innerHTML = '';
        
        // Créer l'affichage du nom utilisateur
        const nameSpan = document.createElement('span');
        nameSpan.className = 'admin-name-display';
        nameSpan.style.color = 'white';
        nameSpan.style.fontWeight = '500';
        nameSpan.textContent = username;
        
        // Créer le bouton de déconnexion
        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'btn-logout-custom';
        logoutBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
        logoutBtn.style.color = 'white';
        logoutBtn.style.border = 'none';
        logoutBtn.style.padding = '6px 12px';
        logoutBtn.style.borderRadius = '4px';
        logoutBtn.style.cursor = 'pointer';
        logoutBtn.style.fontSize = '14px';
        logoutBtn.style.display = 'flex';
        logoutBtn.style.alignItems = 'center';
        
        // Ajouter l'icône
        const icon = document.createElement('i');
        icon.className = 'fas fa-sign-out-alt';
        icon.style.marginRight = '5px';
        
        // Assembler les éléments
        logoutBtn.appendChild(icon);
        logoutBtn.appendChild(document.createTextNode(' Déconnexion'));
        userPageInfo.appendChild(nameSpan);
        userPageInfo.appendChild(logoutBtn);
        
        // Ajouter l'événement de déconnexion au bouton
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            localStorage.removeItem('userName');
            window.location.href = 'login.html';
        });
        
        console.log('Informations utilisateur ajoutées au nouveau conteneur');
    }
    
    // Charger la liste des utilisateurs
    loadUsers();
}

// Fonction de connexion
async function login(username, password) {
    try {
        // Obtenir le JWT en appelant l'API
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        if (!response.ok) {
            throw new Error('Identifiants incorrects');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Stocker le token et les informations utilisateur
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userRole', data.user.role);
            localStorage.setItem('userName', data.user.name || data.user.username);
            
            // Vérifier si l'utilisateur est admin
            if (data.user.role === 'admin') {
                // Rafraîchir la page pour afficher le contenu admin
                window.location.reload();
            } else {
                // Rediriger vers la page principale car non-admin
                showMessage('Vous n\'avez pas les droits pour accéder à cette page.', 'error');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2000);
            }
        } else {
            throw new Error(data.message || 'Erreur de connexion');
        }
    } catch (error) {
        console.error('Erreur de connexion:', error);
        const loginError = document.getElementById('login-error');
        if (loginError) {
            loginError.textContent = error.message;
            loginError.style.display = 'block';
        }
    }
}

// Fonction de déconnexion
function logout() {
    // Supprimer les informations d'authentification
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userName');
    
    // Rediriger vers la page de connexion
    window.location.href = 'index.html';
}

// Initialisation de la gestion des utilisateurs
function initUserManagement() {
    // Récupérer les références aux éléments
    const loginForm = document.getElementById('login-form');
    const logoutBtn = document.getElementById('logout-btn');
    const addUserBtn = document.getElementById('add-user-btn');
    const userForm = document.getElementById('user-form');
    const cancelUserBtn = document.getElementById('cancel-user-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmResetBtn = document.getElementById('confirm-reset-btn');
    const cancelResetBtn = document.getElementById('cancel-reset-btn');
    
    // Configurer le formulaire de connexion
    if (loginForm) {
        loginForm.addEventListener('submit', e => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            login(username, password);
        });
    }
    
    // Configurer le bouton de déconnexion
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            logout();
        });
    }
    
    // Bouton d'ajout d'utilisateur
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => {
            openUserForm();
        });
    }
    
    // Annuler l'ajout/modification d'utilisateur
    if (cancelUserBtn) {
        cancelUserBtn.addEventListener('click', () => {
            closeUserForm();
        });
    }
    
    // Annuler la suppression
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            const deleteModal = document.getElementById('delete-modal');
            if (deleteModal) {
                deleteModal.style.display = 'none';
            }
        });
    }
    
    // Annuler la réinitialisation du mot de passe
    if (cancelResetBtn) {
        cancelResetBtn.addEventListener('click', () => {
            const resetPasswordModal = document.getElementById('reset-password-modal');
            if (resetPasswordModal) {
                resetPasswordModal.style.display = 'none';
            }
        });
    }
    
    // Soumettre le formulaire d'utilisateur
    if (userForm) {
        userForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveUser();
        });
    }
    
    // Configurer le bouton de copie de mot de passe
    const copyPasswordBtn = document.getElementById('copy-password');
    if (copyPasswordBtn) {
        copyPasswordBtn.addEventListener('click', () => {
            const tempPassword = document.getElementById('temp-password');
            if (tempPassword) {
                // Copier le mot de passe dans le presse-papier
                const textarea = document.createElement('textarea');
                textarea.value = tempPassword.textContent;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                
                // Informer l'utilisateur
                alert('Mot de passe copié dans le presse-papier !');
            }
        });
    }
}

// Charger la liste des utilisateurs depuis l'API
async function loadUsers() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showMessage('Vous devez être connecté pour accéder à cette fonctionnalité', 'error');
            return;
        }
        
        console.log('Chargement des utilisateurs...');
        const response = await fetch('/api/auth/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('Statut de la réponse:', response.status);
        
        // Gérer les erreurs d'authentification et d'autorisation
        if (response.status === 401) {
            showMessage('Session expirée. Veuillez vous reconnecter.', 'error');
            logout();
            return;
        }
        
        if (response.status === 403) {
            showMessage('Vous n\'avez pas les droits pour accéder à cette fonctionnalité', 'error');
            return;
        }
        
        if (!response.ok) {
            throw new Error(`Erreur serveur: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            renderUsersList(data.users);
        } else {
            showMessage(data.message || 'Erreur lors du chargement des utilisateurs', 'error');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des utilisateurs:', error);
        showMessage('Erreur lors du chargement des utilisateurs: ' + error.message, 'error');
    }
}

// Afficher la liste des utilisateurs dans le tableau
function renderUsersList(users) {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;
    
    usersList.innerHTML = '';
    
    if (users.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="6" style="text-align: center;">Aucun utilisateur trouvé</td>';
        usersList.appendChild(row);
        return;
    }
    
    users.forEach(user => {
        const row = document.createElement('tr');
        
        // Formatage des dates
        const createdAt = user.createdAt ? new Date(user.createdAt).toLocaleDateString('fr-FR', {
            year: 'numeric', month: 'long', day: 'numeric'
        }) : 'Non disponible';
        
        const lastLogin = user.lastLogin ? new Date(user.lastLogin).toLocaleDateString('fr-FR', {
            year: 'numeric', month: 'long', day: 'numeric', 
            hour: '2-digit', minute: '2-digit'
        }) : 'Jamais';
        
        // Traduction du rôle
        const roleTranslations = {
            'admin': 'Administrateur',
            'staff': 'Staff',
            'user': 'Utilisateur'
        };
        const roleName = roleTranslations[user.role] || user.role;
        
        row.innerHTML = `
            <td>${user.username}</td>
            <td>${user.name || '-'}</td>
            <td>${roleName}</td>
            <td>${createdAt}</td>
            <td>${lastLogin}</td>
            <td>
                <button class="action-btn edit" onclick="editUser('${user._id}')"><i class="fas fa-edit"></i></button>
                <button class="action-btn delete" onclick="deleteUser('${user._id}', '${user.username}')"><i class="fas fa-trash-alt"></i></button>
                <button class="action-btn reset" onclick="resetUserPassword('${user._id}', '${user.username}')"><i class="fas fa-key"></i></button>
            </td>
        `;
        
        usersList.appendChild(row);
    });
}

// Ouvrir le formulaire d'ajout/modification d'utilisateur
function openUserForm(userId = null) {
    const userModal = document.getElementById('user-modal');
    const modalTitle = document.getElementById('modal-title');
    const userForm = document.getElementById('user-form');
    const userIdInput = document.getElementById('user-id');
    const passwordGroup = document.getElementById('password-group');
    
    if (userModal) {
        // Réinitialiser le formulaire
        if (userForm) userForm.reset();
        
        // Configurer le formulaire pour ajout ou modification
        if (modalTitle) modalTitle.textContent = userId ? 'Modifier un utilisateur' : 'Ajouter un utilisateur';
        if (userIdInput) userIdInput.value = userId || '';
        if (passwordGroup) passwordGroup.style.display = userId ? 'none' : 'block';
        
        // Si on modifie un utilisateur, charger ses données
        if (userId) {
            loadUserDetails(userId);
        }
        
        // Afficher le modal
        userModal.style.display = 'block';
    }
}

// Fermer le formulaire d'utilisateur
function closeUserForm() {
    const userModal = document.getElementById('user-modal');
    if (userModal) userModal.style.display = 'none';
}

// Charger les détails d'un utilisateur pour modification
async function loadUserDetails(userId) {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        
        const response = await fetch(`/api/auth/users/${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des détails utilisateur');
        }
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('user-username').value = data.user.username;
            document.getElementById('user-name').value = data.user.name || '';
            document.getElementById('user-role').value = data.user.role;
        }
    } catch (error) {
        console.error('Erreur:', error);
        showMessage(error.message, 'error');
    }
}

// Enregistrer un utilisateur (création ou modification)
async function saveUser() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        
        const userId = document.getElementById('user-id').value;
        const username = document.getElementById('user-username').value;
        const name = document.getElementById('user-name').value;
        const role = document.getElementById('user-role').value;
        const password = document.getElementById('user-password').value;
        
        const userData = {
            username,
            name,
            role
        };
        
        // Ajouter le mot de passe uniquement s'il est fourni
        if (password) {
            userData.password = password;
        }
        
        const method = userId ? 'PUT' : 'POST';
        const url = userId ? `/api/auth/users/${userId}` : '/api/auth/users';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(userData)
        });
        
        console.log('Réponse du serveur:', response.status, response.statusText);
        
        // Lire le corps de la réponse une seule fois
        let responseData;
        try {
            // Essayer de lire comme JSON d'abord
            const responseText = await response.text();
            try {
                // Essayer de convertir en JSON si possible
                responseData = responseText ? JSON.parse(responseText) : {};
                console.log('Données de réponse (parsées):', responseData);
            } catch (parseError) {
                // Si impossible de parser en JSON, garder le texte brut
                responseData = { rawText: responseText };
                console.log('Données de réponse (texte brut):', responseText);
            }
        } catch (readError) {
            console.error('Erreur de lecture du corps de la réponse:', readError);
            responseData = {};
        }
        
        // Traiter différents types d'erreurs HTTP
        if (!response.ok) {
            if (response.status === 401) {
                showMessage('Session expirée. Veuillez vous reconnecter.', 'error');
                logout();
                return;
            }
            
            const errorMessage = responseData.message || 
                               responseData.rawText || 
                               `Erreur serveur (${response.status}): ${response.statusText}`;
            throw new Error(errorMessage);
        }
        
        // Données valides si on arrive ici
        console.log('Données de réponse:', responseData);
        
        if (responseData.success) {
            closeUserForm();
            loadUsers();
            showMessage(userId ? 'Utilisateur modifié avec succès' : 'Utilisateur créé avec succès', 'success');
        } else {
            showMessage(responseData.message || 'Erreur inconnue lors de l\'opération', 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showMessage(error.message, 'error');
    }
}

// Exécuter la suppression d'un utilisateur
async function performDeleteUser(userId) {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        
        const response = await fetch(`/api/auth/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Erreur lors de la suppression');
        }
        
        const data = await response.json();
        
        if (data.success) {
            loadUsers();
            showMessage('Utilisateur supprimé avec succès', 'success');
        } else {
            showMessage(data.message, 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showMessage(error.message, 'error');
    }
}

// Exécuter la réinitialisation du mot de passe
async function performPasswordReset(userId) {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        
        const response = await fetch(`/api/auth/users/${userId}/reset-password`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Erreur lors de la réinitialisation du mot de passe');
        }
        
        const data = await response.json();
        
        if (data.success) {
            const tempPasswordContainer = document.getElementById('new-password-container');
            const tempPasswordEl = document.getElementById('temp-password');
            const confirmResetBtn = document.getElementById('confirm-reset-btn');
            
            if (tempPasswordContainer && tempPasswordEl) {
                // Afficher le mot de passe temporaire
                tempPasswordContainer.style.display = 'block';
                tempPasswordEl.textContent = data.tempPassword;
                
                // Changer le texte du bouton
                if (confirmResetBtn) {
                    // Supprimer les anciens event listeners
                    const newConfirmBtn = confirmResetBtn.cloneNode(true);
                    confirmResetBtn.parentNode.replaceChild(newConfirmBtn, confirmResetBtn);
                    
                    // Changer le texte
                    newConfirmBtn.textContent = 'Fermer';
                    
                    // Ajouter le nouvel event listener pour fermer
                    newConfirmBtn.addEventListener('click', () => {
                        document.getElementById('reset-password-modal').style.display = 'none';
                    });
                }
            }
        } else {
            alert(data.message || 'Erreur lors de la réinitialisation du mot de passe');
        }
    } catch (error) {
        console.error('Erreur lors de la réinitialisation du mot de passe:', error);
        alert('Erreur: ' + error.message);
    }
}

// Afficher un message
function showMessage(message, type = 'success') {
    // Créer un élément de message s'il n'existe pas
    let messageEl = document.getElementById('user-message');
    
    if (!messageEl) {
        messageEl = document.createElement('div');
        messageEl.id = 'user-message';
        messageEl.className = `message ${type}`;
        
        // Trouver un endroit où l'ajouter
        const usersSection = document.getElementById('users-section');
        if (usersSection) {
            // Ajouter au début de la section
            const sectionHeader = usersSection.querySelector('.section-header');
            if (sectionHeader) {
                usersSection.insertBefore(messageEl, sectionHeader.nextSibling);
            } else {
                usersSection.prepend(messageEl);
            }
        } else {
            // Ajouter au début du body si pas d'autre option
            document.body.prepend(messageEl);
        }
    }
    
    // Configurer le message
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';
    
    // Disparaît après 5 secondes
    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 5000);
}

// Fonctions globales exposées pour l'utilisation en HTML
window.editUser = function(userId) {
    openUserForm(userId);
};

window.deleteUser = function(userId, userName) {
    const deleteModal = document.getElementById('delete-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    
    if (deleteModal) {
        deleteModal.style.display = 'block';
        
        // Configurer le bouton de confirmation pour cette suppression spécifique
        if (confirmDeleteBtn) {
            // Supprimer les anciens event listeners
            const newConfirmBtn = confirmDeleteBtn.cloneNode(true);
            confirmDeleteBtn.parentNode.replaceChild(newConfirmBtn, confirmDeleteBtn);
            
            // Ajouter le nouvel event listener
            newConfirmBtn.addEventListener('click', () => {
                performDeleteUser(userId);
                deleteModal.style.display = 'none';
            });
        }
    }
};

window.resetUserPassword = function(userId, userName) {
    const resetPasswordModal = document.getElementById('reset-password-modal');
    const confirmResetBtn = document.getElementById('confirm-reset-btn');
    const newPasswordContainer = document.getElementById('new-password-container');
    
    if (resetPasswordModal) {
        if (newPasswordContainer) {
            newPasswordContainer.style.display = 'none';
        }
        
        resetPasswordModal.style.display = 'block';
        
        // Configurer le bouton de confirmation
        if (confirmResetBtn) {
            // Supprimer les anciens event listeners
            const newConfirmBtn = confirmResetBtn.cloneNode(true);
            confirmResetBtn.parentNode.replaceChild(newConfirmBtn, confirmResetBtn);
            
            // S'assurer que le texte est correct
            newConfirmBtn.textContent = 'Réinitialiser';
            
            // Ajouter le nouvel event listener
            newConfirmBtn.addEventListener('click', () => {
                performPasswordReset(userId, userName);
            });
        }
    }
};
