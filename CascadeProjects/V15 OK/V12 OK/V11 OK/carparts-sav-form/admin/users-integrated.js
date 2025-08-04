/**
 * Gestion des utilisateurs - Interface intégrée au dashboard
 * Version intégrée au layout principal du dashboard
 */

document.addEventListener('DOMContentLoaded', () => {
    // Vérifier si l'utilisateur est connecté et a les droits d'administrateur
    const userRole = localStorage.getItem('userRole');
    
    // Initialiser les événements uniquement si l'utilisateur est administrateur
    if (userRole === 'admin') {
        initIntegratedUserManagement();
    } else {
        // Cacher complètement la section et l'entrée de menu pour les non-admins
        const usersSection = document.getElementById('users');
        const usersNavItem = document.querySelector('a[href="#users"]').parentElement;
        
        if (usersSection) usersSection.remove();
        if (usersNavItem) usersNavItem.style.display = 'none';
    }
});

// Initialisation de la gestion des utilisateurs intégrée
function initIntegratedUserManagement() {
    // Récupérer les références aux éléments
    const addUserBtn = document.getElementById('add-user-btn');
    const userForm = document.getElementById('user-form');
    const cancelUserBtn = document.getElementById('cancel-user-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmResetBtn = document.getElementById('confirm-reset-btn');
    const cancelResetBtn = document.getElementById('cancel-reset-btn');
    
    // Initialiser les modals
    const userModal = document.getElementById('user-modal');
    const deleteModal = document.getElementById('delete-modal');
    const resetPasswordModal = document.getElementById('reset-password-modal');
    
    // Éviter les erreurs de référence null
    if (!userModal || !deleteModal || !resetPasswordModal) {
        console.error("Impossible de trouver les modals nécessaires pour la gestion des utilisateurs.");
        return;
    }
    
    // Gestion de l'affichage de la section utilisateurs
    const usersLink = document.querySelector('a[href="#users"]');
    if (usersLink) {
        usersLink.addEventListener('click', function(e) {
            e.preventDefault();
            showUsersSection();
        });
    }

    // Ouvrir le formulaire d'ajout d'utilisateur
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => {
            openUserForm();
        });
    }
    
    // Gérer les modals
    document.querySelectorAll('.modal .close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modalElement = this.closest('.modal');
            if (modalElement) {
                modalElement.style.display = 'none';
                
                // Réinitialiser le conteneur de mot de passe si c'est le modal de réinitialisation
                if (modalElement.id === 'reset-password-modal') {
                    const newPasswordContainer = document.getElementById('new-password-container');
                    if (newPasswordContainer) {
                        newPasswordContainer.style.display = 'none';
                    }
                }
            }
        });
    });
    
    // Fermer le formulaire utilisateur
    if (cancelUserBtn) {
        cancelUserBtn.addEventListener('click', () => {
            closeUserForm();
        });
    }
    
    // Annuler la suppression
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            if (deleteModal) {
                deleteModal.style.display = 'none';
            }
        });
    }
    
    // Annuler la réinitialisation du mot de passe
    if (cancelResetBtn) {
        cancelResetBtn.addEventListener('click', () => {
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
}

// Fonction pour afficher la section utilisateurs
function showUsersSection() {
    console.log('Affichage de la section utilisateurs...');
    
    // Cacher toutes les sections principales
    hideAllSections();
    
    // Masquer les vues spécifiques
    const views = ['list-view', 'kanban-view', 'ticket-details'];
    views.forEach(viewId => {
        const element = document.getElementById(viewId);
        if (element) element.style.display = 'none';
    });
    
    // Assurer que le dashboard est visible
    const adminDashboard = document.querySelector('.admin-dashboard');
    if (adminDashboard) adminDashboard.style.display = 'block';
    
    // Activer l'item de navigation utilisateurs
    updateActiveNavItem('users');
    
    // Afficher la section utilisateurs
    const usersSection = document.getElementById('users');
    if (usersSection) {
        usersSection.style.display = 'block';
        
        // Faire défiler jusqu'à la section
        setTimeout(() => {
            usersSection.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        
        // Vérifier les droits admin puis charger les utilisateurs
        checkAdminRights().then(isAdmin => {
            if (isAdmin) {
                loadUsers();
            }
        });
    } else {
        console.error('Section utilisateurs non trouvée dans le DOM!');
    }
}

// Vérification des droits administrateur en décodant le JWT
async function checkAdminRights() {
    try {
        const token = localStorage.getItem('authToken');
        
        if (!token) {
            showUserFormMessage("Vous devez être connecté pour accéder à cette fonctionnalité", "error");
            return false;
        }
        
        // Décoder le token JWT pour vérifier les droits
        // Format JWT: header.payload.signature
        const payload = token.split('.')[1];
        const decodedPayload = JSON.parse(atob(payload));
        
        if (decodedPayload.role !== 'admin') {
            showUserFormMessage("Vous n'avez pas les droits pour accéder à cette fonctionnalité", "error");
            return false;
        }
        
        return true;
    } catch (error) {
        console.error("Erreur lors de la vérification des droits:", error);
        showUserFormMessage("Erreur d'authentification", "error");
        return false;
    }
}

// Charger la liste des utilisateurs depuis l'API
async function loadUsers() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showUserFormMessage('Vous devez être connecté pour accéder à cette fonctionnalité', 'error');
            return;
        }
        
        console.log('Chargement des utilisateurs...');
        const response = await fetch('/api/auth/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('Statut de la réponse:', response.status);
        
        if (response.status === 401) {
            // Token expiré ou invalide
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            showUserFormMessage('Votre session a expiré. Veuillez vous reconnecter.', 'error');
            return;
        }
        
        if (response.status === 403) {
            // Non autorisé
            showUserFormMessage("Vous n'avez pas les droits nécessaires pour accéder à cette fonctionnalité.", 'error');
            return;
        }
        
        if (!response.ok) {
            throw new Error(`Erreur serveur: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            renderUsersList(data.users);
        } else {
            showUserFormMessage(data.message || 'Erreur lors du chargement des utilisateurs', 'error');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des utilisateurs:', error);
        showUserFormMessage('Erreur lors du chargement des utilisateurs: ' + error.message, 'error');
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
        const createdAt = new Date(user.createdAt).toLocaleString('fr-FR');
        const lastLogin = user.lastLogin ? new Date(user.lastLogin).toLocaleString('fr-FR') : 'Jamais';
        
        // Formatage du rôle
        const roleName = user.role === 'admin' ? 'Administrateur' : 'Agent SAV';
        
        row.innerHTML = `
            <td>${user.username}</td>
            <td>${user.name}</td>
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

// Fonction globale pour éditer un utilisateur
window.editUser = function(userId) {
    openUserForm(userId);
};

// Fonction globale pour supprimer un utilisateur
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

// Fonction globale pour réinitialiser le mot de passe
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
            document.getElementById('user-name').value = data.user.name;
            document.getElementById('user-role').value = data.user.role;
        }
    } catch (error) {
        console.error('Erreur:', error);
        showUserFormMessage(error.message, 'error');
    }
}

// Fermer le formulaire d'utilisateur
function closeUserForm() {
    const userModal = document.getElementById('user-modal');
    if (userModal) userModal.style.display = 'none';
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
        
        // Ajouter le mot de passe uniquement pour un nouvel utilisateur
        if (!userId && password) {
            userData.password = password;
        }
        
        const url = userId ? `/api/auth/users/${userId}` : '/api/auth/users';
        const method = userId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(userData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Erreur lors de l\'enregistrement de l\'utilisateur');
        }
        
        const data = await response.json();
        
        if (data.success) {
            closeUserForm();
            loadUsers();
            showUserFormMessage(userId ? 'Utilisateur modifié avec succès' : 'Utilisateur créé avec succès', 'success');
        } else {
            showUserFormMessage(data.message, 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showUserFormMessage(error.message, 'error');
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
            showUserFormMessage('Utilisateur supprimé avec succès', 'success');
        } else {
            showUserFormMessage(data.message, 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showUserFormMessage(error.message, 'error');
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
            // Afficher le mot de passe temporaire dans le modal
            const newPasswordElement = document.getElementById('new-password');
            const newPasswordContainer = document.getElementById('new-password-container');
            
            if (newPasswordElement && newPasswordContainer) {
                newPasswordElement.textContent = data.temporaryPassword;
                newPasswordContainer.style.display = 'block';
                
                // Configurer le bouton de copie
                const copyPasswordBtn = document.getElementById('copy-password-btn');
                if (copyPasswordBtn) {
                    // Supprimer les anciens event listeners
                    const newCopyBtn = copyPasswordBtn.cloneNode(true);
                    copyPasswordBtn.parentNode.replaceChild(newCopyBtn, copyPasswordBtn);
                    
                    // Ajouter le nouvel event listener
                    newCopyBtn.addEventListener('click', () => {
                        navigator.clipboard.writeText(data.temporaryPassword)
                            .then(() => {
                                alert('Mot de passe copié dans le presse-papiers');
                            })
                            .catch(err => {
                                console.error('Impossible de copier le mot de passe:', err);
                            });
                    });
                }
                
                // Changer le texte du bouton de confirmation
                const confirmResetBtn = document.getElementById('confirm-reset-btn');
                if (confirmResetBtn) {
                    confirmResetBtn.textContent = 'Fermer';
                    
                    // Supprimer les anciens event listeners
                    const newConfirmBtn = confirmResetBtn.cloneNode(true);
                    confirmResetBtn.parentNode.replaceChild(newConfirmBtn, confirmResetBtn);
                    
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

// Afficher un message dans le formulaire
function showUserFormMessage(message, type = 'success') {
    // Créer un élément de message s'il n'existe pas
    let messageEl = document.getElementById('user-form-message');
    
    if (!messageEl) {
        messageEl = document.createElement('div');
        messageEl.id = 'user-form-message';
        messageEl.className = `form-message`;
        
        // Trouver un endroit où l'ajouter
        const usersSection = document.getElementById('users');
        if (usersSection) {
            // Ajouter au début de la section
            if (usersSection.firstChild) {
                usersSection.insertBefore(messageEl, usersSection.firstChild);
            } else {
                usersSection.appendChild(messageEl);
            }
        }
    }
    
    // Configurer le message
    messageEl.textContent = message;
    messageEl.className = `form-message ${type}`;
    messageEl.style.display = 'block';
    
    // Disparaît après 5 secondes
    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 5000);
}

// Cacher toutes les sections
function hideAllSections() {
    // Cacher la section tickets
    const ticketDetails = document.getElementById('ticket-details');
    if (ticketDetails) ticketDetails.style.display = 'none';
    
    // Cacher les autres sections
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.style.display = 'none';
    });
}

// Mettre à jour l'élément de navigation actif
function updateActiveNavItem(sectionId) {
    const navItems = document.querySelectorAll('.horizontal-nav li');
    navItems.forEach(item => {
        item.classList.remove('active');
        
        const link = item.querySelector('a');
        if (link && link.getAttribute('href') === `#${sectionId}`) {
            item.classList.add('active');
        }
    });
}
