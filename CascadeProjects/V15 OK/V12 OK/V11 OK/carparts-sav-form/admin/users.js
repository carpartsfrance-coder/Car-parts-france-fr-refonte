a touj/**
 * Gestion des utilisateurs - Interface d'administration SAV
 */

document.addEventListener('DOMContentLoaded', () => {
    // Vérifier si l'utilisateur est connecté et a les droits d'administrateur
    const userRole = localStorage.getItem('userRole');
    
    // Initialiser les événements uniquement si l'utilisateur est administrateur
    if (userRole === 'admin') {
        initUserManagement();
    }
});

// Initialisation de la gestion des utilisateurs
function initUserManagement() {
    const addUserBtn = document.getElementById('add-user-btn');
    const userForm = document.getElementById('user-form');
    const cancelUserBtn = document.getElementById('cancel-user-btn');
    
    // Initialiser les modals
    const userModal = document.getElementById('user-modal');
    const deleteModal = document.getElementById('delete-modal');
    const resetPasswordModal = document.getElementById('reset-password-modal');
    
    // Afficher la section utilisateurs (version intégrée)
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
        const dashboard = document.getElementById('admin-dashboard');
        if (dashboard) dashboard.style.display = 'block';
        
        // Activer l'item de navigation utilisateurs
        updateActiveNavItem('users');
        
        // Afficher la section utilisateurs
        const usersSection = document.getElementById('users');
        if (usersSection) {
            console.log('Section utilisateurs trouvée');
            usersSection.style.display = 'block';
            
            // Faire défiler jusqu'à la section
            setTimeout(() => {
                usersSection.scrollIntoView({ behavior: 'smooth' });
            }, 100);
            
            // Charger les utilisateurs
            loadUsers();
        } else {
            console.error('Section utilisateurs non trouvée dans le DOM!');
        }
    }
    
    // Attachement de l'événement clic sur le lien utilisateurs
    const usersLink = document.querySelector('a[href="#users"]');
    console.log('Lien utilisateurs trouvé:', usersLink);
    
    if (usersLink) {
        usersLink.addEventListener('click', (e) => {
            console.log('Clic sur l\'onglet utilisateurs détecté');
            e.preventDefault();
            showUsersSection();
        });
        
        // Vérifier si l'URL contient le fragment #users pour activer directement cette section
        if (window.location.hash === '#users') {
            console.log('Fragment #users détecté dans l\'URL, activation automatique');
            showUsersSection();
        }
    } else {
        console.error("ERREUR: Lien vers section users introuvable");
    }
    
    // Ouvrir le formulaire d'ajout d'utilisateur
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => {
            openUserForm();
        });
    }
    
    // Gérer les fermetures de modal
    document.querySelectorAll('.modal .close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modalElement = this.closest('.modal');
            if (modalElement) {
                modalElement.style.display = 'none';
            }
        });
    });
    
    // Annuler le formulaire utilisateur
    if (cancelUserBtn) {
        cancelUserBtn.addEventListener('click', () => {
            closeUserForm();
        });
    }
    
    // Annuler la suppression
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            document.getElementById('delete-modal').style.display = 'none';
        });
    }
    
    // Annuler la réinitialisation du mot de passe
    const cancelResetBtn = document.getElementById('cancel-reset-btn');
    if (cancelResetBtn) {
        cancelResetBtn.addEventListener('click', () => {
            document.getElementById('reset-password-modal').style.display = 'none';
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

// Charger la liste des utilisateurs depuis l'API
async function loadUsers() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            showUserFormMessage('Vous devez être connecté pour accéder à cette fonctionnalité', 'error');
            return;
        }
        
        const response = await fetch('/api/auth/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des utilisateurs');
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
    // Utiliser le nouveau conteneur ou l'ancien
    const tableBody = document.getElementById('users-list-container-special') 
        ? document.getElementById('users-list-container-special').querySelector('tbody#users-list')
        : document.getElementById('users-list');
    
    if (!tableBody) {
        console.error("Impossible de trouver le conteneur pour la liste des utilisateurs");
        return;
    }
    
    console.log('Rendu de la liste des utilisateurs dans l\'élément:', tableBody.id);
    tableBody.innerHTML = '';
    
    if (!users || users.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td colspan="6" class="text-center">Aucun utilisateur trouvé</td>
        `;
        tableBody.appendChild(emptyRow);
        return;
    }
    
    users.forEach(user => {
        const row = document.createElement('tr');
        
        // Formatage des dates
        const createdAt = new Date(user.createdAt);
        let lastLoginDate = 'Jamais connecté';
        
        if (user.lastLogin) {
            const lastLogin = new Date(user.lastLogin);
            lastLoginDate = `${lastLogin.toLocaleDateString()} ${lastLogin.toLocaleTimeString()}`;
        }
        
        // Déterminer la classe CSS du badge de rôle
        const roleClass = user.role === 'admin' ? 'role-admin' : 'role-agent';
        const roleName = user.role === 'admin' ? 'Administrateur' : 'Agent SAV';
        
        row.innerHTML = `
            <td>${user.username}</td>
            <td>${user.fullName || user.name || '-'}</td>
            <td><span class="role-badge ${roleClass}">${roleName}</span></td>
            <td>${createdAt.toLocaleDateString()} ${createdAt.toLocaleTimeString()}</td>
            <td>${lastLoginDate}</td>
            <td class="user-actions-cell">
                <button class="btn-icon edit-user" data-userid="${user._id}" title="Modifier"><i class="fas fa-edit"></i></button>
                <button class="btn-icon reset-password" data-userid="${user._id}" title="Réinitialiser mot de passe"><i class="fas fa-key"></i></button>
                <button class="btn-icon delete-user" data-userid="${user._id}" title="Supprimer"><i class="fas fa-trash-alt"></i></button>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    console.log(`${users.length} utilisateurs affichés dans le tableau`);
    
    // Attacher les événements aux boutons d'action
    attachUserActionEvents();
}

// Ouvrir le formulaire d'ajout d'utilisateur
function openUserForm(userId = null) {
    const userForm = document.getElementById('user-form');
    const modalTitle = document.getElementById('modal-title');
    const userModal = document.getElementById('user-modal');
    const passwordGroup = document.getElementById('password-group');
    
    if (!userForm || !modalTitle || !userModal) return;
    
    // Réinitialiser le formulaire
    userForm.reset();
    
    // Configurer le titre et le mode du formulaire
    modalTitle.textContent = userId ? 'Modifier un utilisateur' : 'Ajouter un utilisateur';
    document.getElementById('user-id').value = userId || '';
    
    // Gérer l'affichage du champ mot de passe
    // En mode édition, le champ de mot de passe est facultatif
    if (passwordGroup) {
        const passwordInput = document.getElementById('user-password');
        if (userId) { // Mode édition
            passwordInput.removeAttribute('required');
            passwordGroup.querySelector('label').textContent = 'Mot de passe (laisser vide pour ne pas modifier)';
        } else { // Mode ajout
            passwordInput.setAttribute('required', 'required');
            passwordGroup.querySelector('label').textContent = 'Mot de passe';
        }
    }
    
    // Afficher le modal
    userModal.style.display = 'block';
    
    // Si c'est une modification, charger les détails de l'utilisateur
    if (userId) {
        loadUserDetails(userId);
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
        
        if (data.success && data.user) {
            document.getElementById('user-username').value = data.user.username;
            document.getElementById('user-name').value = data.user.name;
            document.getElementById('user-email').value = data.user.email || '';
        }
    } catch (error) {
        console.error('Erreur lors du chargement des détails utilisateur:', error);
        showUserFormMessage('Erreur: ' + error.message, 'error');
    }
}

// Fermer le formulaire d'utilisateur
function closeUserForm() {
    document.getElementById('user-modal').style.display = 'none';
}

// Enregistrer un utilisateur (création ou modification)
async function saveUser() {
    try {
        const userId = document.getElementById('user-id').value;
        const username = document.getElementById('user-username').value;
        const password = document.getElementById('user-password').value;
        const name = document.getElementById('user-name').value;
        const email = document.getElementById('user-email').value;
        
        const token = localStorage.getItem('authToken');
        if (!token) {
            showUserFormMessage('Vous devez être connecté pour effectuer cette action', 'error');
            return;
        }
        
        // Données utilisateur
        const userData = {
            username,
            name,
            email
        };
        
        // Ajouter le mot de passe uniquement s'il est fourni (en cas de modification)
        if (password) {
            userData.password = password;
        }
        
        let response;
        
        if (userId) {
            // Modification d'un utilisateur existant
            response = await fetch(`/api/auth/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(userData)
            });
        } else {
            // Création d'un nouvel utilisateur (toujours un agent SAV)
            response = await fetch('/api/auth/create-agent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(userData)
            });
        }
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Erreur lors de l\'enregistrement de l\'utilisateur');
        }
        
        const data = await response.json();
        
        if (data.success) {
            showUserFormMessage(userId ? 'Utilisateur modifié avec succès' : 'Nouvel agent SAV créé avec succès', 'success');
            
            // Recharger la liste des utilisateurs après un court délai
            setTimeout(() => {
                closeUserForm();
                loadUsers();
            }, 1500);
        } else {
            showUserFormMessage(data.message || 'Erreur lors de l\'enregistrement', 'error');
        }
    } catch (error) {
        console.error('Erreur lors de l\'enregistrement de l\'utilisateur:', error);
        showUserFormMessage('Erreur: ' + error.message, 'error');
    }
}

// Supprimer un utilisateur
async function deleteUser(userId, userName) {
    if (!userId) return;
    
    // Afficher le modal de confirmation
    const deleteModal = document.getElementById('delete-modal');
    if (!deleteModal) return;
    
    // Configurer le bouton de confirmation
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn) {
        // Supprimer les anciens event listeners avec clone+replace
        const newConfirmBtn = confirmDeleteBtn.cloneNode(true);
        confirmDeleteBtn.parentNode.replaceChild(newConfirmBtn, confirmDeleteBtn);
        
        // Ajouter le nouvel event listener
        newConfirmBtn.addEventListener('click', async () => {
            await performDeleteUser(userId);
            deleteModal.style.display = 'none';
        });
    }
    
    // Afficher le modal
    deleteModal.style.display = 'block';
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
            throw new Error('Erreur lors de la suppression');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Recharger la liste des utilisateurs
            loadUsers();
        } else {
            alert(data.message || 'Erreur lors de la suppression de l\'utilisateur');
        }
    } catch (error) {
        console.error('Erreur lors de la suppression de l\'utilisateur:', error);
        alert('Erreur: ' + error.message);
    }
}

// Réinitialiser le mot de passe d'un utilisateur
async function resetUserPassword(userId, userName) {
    if (!userId) return;
    
    // Afficher le modal de réinitialisation
    const resetPasswordModal = document.getElementById('reset-password-modal');
    if (!resetPasswordModal) return;
    
    // Configurer le bouton de confirmation
    const confirmResetBtn = document.getElementById('confirm-reset-btn');
    if (confirmResetBtn) {
        // Supprimer les anciens event listeners avec clone+replace
        const newConfirmBtn = confirmResetBtn.cloneNode(true);
        confirmResetBtn.parentNode.replaceChild(newConfirmBtn, confirmResetBtn);
        
        // Ajouter le nouvel event listener
        newConfirmBtn.addEventListener('click', async () => {
            await performPasswordReset(userId, userName);
        });
    }
    
    // Masquer le conteneur de nouveau mot de passe
    const newPasswordContainer = document.getElementById('new-password-container');
    if (newPasswordContainer) {
        newPasswordContainer.style.display = 'none';
    }
    
    // Afficher le modal
    resetPasswordModal.style.display = 'block';
}

// Exécuter la réinitialisation du mot de passe
async function performPasswordReset(userId, userName) {
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
                    copyPasswordBtn.addEventListener('click', () => {
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
    const messageEl = document.getElementById('user-form-message');
    if (messageEl) {
        messageEl.textContent = message;
        messageEl.className = `form-message ${type}`;
    }
}

// Cacher toutes les sections
function hideAllSections() {
    // Cacher la section tickets
    const ticketDetails = document.getElementById('ticket-details');
    if (ticketDetails) ticketDetails.style.display = 'none';
    
    // Cacher les autres sections
    const sections = document.querySelectorAll('.admin-main > div[id]');
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
