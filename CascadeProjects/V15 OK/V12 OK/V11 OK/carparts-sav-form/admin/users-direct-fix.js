/**
 * Script correctif direct pour l'interface utilisateurs SAV
 * Ce script crée une interface flottante autonome sans dépendre de la structure HTML existante
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Script de correctif direct pour utilisateurs chargé!');
    
    // Créer la fonction d'affichage du message
    window.showUserFixMessage = function(message, type = 'info') {
        const messageContainer = document.getElementById('users-fix-messages');
        if (!messageContainer) return;
        
        const msgElement = document.createElement('div');
        msgElement.className = `alert alert-${type}`;
        msgElement.textContent = message;
        
        messageContainer.innerHTML = '';
        messageContainer.appendChild(msgElement);
        
        // Effacer le message après 5 secondes
        setTimeout(() => {
            msgElement.style.opacity = '0';
            setTimeout(() => messageContainer.innerHTML = '', 500);
        }, 5000);
    };
    
    // Fonction pour créer l'interface utilisateurs
    function createUsersInterface() {
        // Vérifier si l'interface existe déjà
        if (document.getElementById('users-fix-interface')) {
            document.getElementById('users-fix-interface').style.display = 'block';
            loadUsersData();
            return;
        }
        
        // Créer un conteneur principal flottant
        const container = document.createElement('div');
        container.id = 'users-fix-interface';
        container.style.position = 'fixed';
        container.style.top = '50px';
        container.style.left = '50%';
        container.style.transform = 'translateX(-50%)';
        container.style.width = '90%';
        container.style.maxWidth = '1200px';
        container.style.backgroundColor = '#fff';
        container.style.borderRadius = '8px';
        container.style.boxShadow = '0 0 20px rgba(0,0,0,0.3)';
        container.style.zIndex = '9999';
        container.style.padding = '20px';
        container.style.maxHeight = '90vh';
        container.style.overflowY = 'auto';
        
        // Créer un header avec titre et bouton de fermeture
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '20px';
        header.style.borderBottom = '1px solid #eee';
        header.style.paddingBottom = '10px';
        
        const title = document.createElement('h2');
        title.innerHTML = '<i class="fas fa-users"></i> Gestion des utilisateurs';
        title.style.margin = '0';
        title.style.color = '#2c3e50';
        
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.fontSize = '28px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.color = '#666';
        closeBtn.onclick = function() {
            container.style.display = 'none';
        };
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        container.appendChild(header);
        
        // Zone de message
        const messageContainer = document.createElement('div');
        messageContainer.id = 'users-fix-messages';
        messageContainer.style.marginBottom = '15px';
        container.appendChild(messageContainer);
        
        // Bouton d'ajout utilisateur
        const addBtn = document.createElement('button');
        addBtn.innerHTML = '<i class="fas fa-plus"></i> Ajouter un utilisateur';
        addBtn.style.backgroundColor = '#007bff';
        addBtn.style.color = 'white';
        addBtn.style.border = 'none';
        addBtn.style.borderRadius = '4px';
        addBtn.style.padding = '10px 15px';
        addBtn.style.marginBottom = '20px';
        addBtn.style.cursor = 'pointer';
        addBtn.onclick = function() {
            openFixUserForm();
        };
        container.appendChild(addBtn);
        
        // Tableau des utilisateurs
        const tableContainer = document.createElement('div');
        tableContainer.style.width = '100%';
        tableContainer.style.overflowX = 'auto';
        
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.marginBottom = '20px';
        
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="border-bottom: 2px solid #ddd; padding: 10px; text-align: left;">Nom d'utilisateur</th>
                <th style="border-bottom: 2px solid #ddd; padding: 10px; text-align: left;">Nom complet</th>
                <th style="border-bottom: 2px solid #ddd; padding: 10px; text-align: left;">Rôle</th>
                <th style="border-bottom: 2px solid #ddd; padding: 10px; text-align: left;">Date de création</th>
                <th style="border-bottom: 2px solid #ddd; padding: 10px; text-align: left;">Dernière connexion</th>
                <th style="border-bottom: 2px solid #ddd; padding: 10px; text-align: center;">Actions</th>
            </tr>
        `;
        
        const tbody = document.createElement('tbody');
        tbody.id = 'users-fix-list';
        
        table.appendChild(thead);
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        container.appendChild(tableContainer);
        
        // Créer le formulaire utilisateur (modal)
        const userFormModal = document.createElement('div');
        userFormModal.id = 'user-fix-modal';
        userFormModal.style.display = 'none';
        userFormModal.style.position = 'fixed';
        userFormModal.style.top = '0';
        userFormModal.style.left = '0';
        userFormModal.style.width = '100%';
        userFormModal.style.height = '100%';
        userFormModal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        userFormModal.style.zIndex = '10000';
        userFormModal.style.alignItems = 'center';
        userFormModal.style.justifyContent = 'center';
        
        const userFormContent = document.createElement('div');
        userFormContent.style.backgroundColor = '#fff';
        userFormContent.style.borderRadius = '8px';
        userFormContent.style.width = '500px';
        userFormContent.style.maxWidth = '90%';
        userFormContent.style.padding = '20px';
        userFormContent.style.position = 'relative';
        
        // Formulaire
        userFormContent.innerHTML = `
            <h3 id="user-fix-form-title">Ajouter un utilisateur</h3>
            <form id="user-fix-form">
                <input type="hidden" id="user-fix-id">
                
                <div style="margin-bottom: 15px;">
                    <label for="user-fix-username" style="display: block; margin-bottom: 5px;">Nom d'utilisateur</label>
                    <input type="text" id="user-fix-username" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label for="user-fix-fullname" style="display: block; margin-bottom: 5px;">Nom complet</label>
                    <input type="text" id="user-fix-fullname" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>
                
                <div style="margin-bottom: 15px;" id="user-fix-password-group">
                    <label for="user-fix-password" style="display: block; margin-bottom: 5px;">Mot de passe</label>
                    <input type="password" id="user-fix-password" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label for="user-fix-role" style="display: block; margin-bottom: 5px;">Rôle</label>
                    <select id="user-fix-role" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <option value="admin">Administrateur</option>
                        <option value="agent">Agent SAV</option>
                    </select>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label for="user-fix-email" style="display: block; margin-bottom: 5px;">Email (optionnel)</label>
                    <input type="email" id="user-fix-email" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                </div>
                
                <div style="display: flex; justify-content: space-between; margin-top: 20px;">
                    <button type="submit" style="background-color: #007bff; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer;">Enregistrer</button>
                    <button type="button" id="cancel-fix-user-form" style="background-color: #6c757d; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer;">Annuler</button>
                </div>
            </form>
        `;
        
        userFormModal.appendChild(userFormContent);
        document.body.appendChild(userFormModal);
        
        // Modal de suppression
        const deleteModal = document.createElement('div');
        deleteModal.id = 'delete-fix-modal';
        deleteModal.style.display = 'none';
        deleteModal.style.position = 'fixed';
        deleteModal.style.top = '0';
        deleteModal.style.left = '0';
        deleteModal.style.width = '100%';
        deleteModal.style.height = '100%';
        deleteModal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        deleteModal.style.zIndex = '10000';
        deleteModal.style.alignItems = 'center';
        deleteModal.style.justifyContent = 'center';
        
        const deleteContent = document.createElement('div');
        deleteContent.style.backgroundColor = '#fff';
        deleteContent.style.borderRadius = '8px';
        deleteContent.style.width = '400px';
        deleteContent.style.maxWidth = '90%';
        deleteContent.style.padding = '20px';
        
        deleteContent.innerHTML = `
            <h3>Supprimer l'utilisateur</h3>
            <p>Êtes-vous sûr de vouloir supprimer l'utilisateur <span id="delete-fix-username"></span>?</p>
            <input type="hidden" id="delete-fix-id">
            <div style="display: flex; justify-content: space-between; margin-top: 20px;">
                <button id="confirm-fix-delete" style="background-color: #dc3545; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer;">Supprimer</button>
                <button id="cancel-fix-delete" style="background-color: #6c757d; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer;">Annuler</button>
            </div>
        `;
        
        deleteModal.appendChild(deleteContent);
        document.body.appendChild(deleteModal);
        
        // Modal de réinitialisation de mot de passe
        const resetModal = document.createElement('div');
        resetModal.id = 'reset-fix-password-modal';
        resetModal.style.display = 'none';
        resetModal.style.position = 'fixed';
        resetModal.style.top = '0';
        resetModal.style.left = '0';
        resetModal.style.width = '100%';
        resetModal.style.height = '100%';
        resetModal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        resetModal.style.zIndex = '10000';
        resetModal.style.alignItems = 'center';
        resetModal.style.justifyContent = 'center';
        
        const resetContent = document.createElement('div');
        resetContent.style.backgroundColor = '#fff';
        resetContent.style.borderRadius = '8px';
        resetContent.style.width = '400px';
        resetContent.style.maxWidth = '90%';
        resetContent.style.padding = '20px';
        
        resetContent.innerHTML = `
            <h3>Réinitialiser le mot de passe</h3>
            <p>Le mot de passe de <span id="reset-fix-username"></span> a été réinitialisé:</p>
            <div style="background-color: #f8f9fa; padding: 10px; border-radius: 4px; margin: 15px 0; font-family: monospace;">
                <p id="new-fix-password" style="margin: 0; word-break: break-all;"></p>
            </div>
            <p style="color: #dc3545;">Notez ce mot de passe, il ne sera plus affiché ultérieurement.</p>
            <div style="display: flex; justify-content: center; margin-top: 20px;">
                <button id="close-fix-reset" style="background-color: #6c757d; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer;">Fermer</button>
            </div>
        `;
        
        resetModal.appendChild(resetContent);
        document.body.appendChild(resetModal);
        
        // Ajouter l'interface au corps du document
        document.body.appendChild(container);
        
        // Initialiser les événements
        initFixEvents();
        
        // Charger les utilisateurs
        loadUsersData();
        
        console.log('Interface utilisateurs créée avec succès');
    }
    
    // Vérifier si l'utilisateur connecté est admin
    function checkAdminRights() {
        try {
            const token = localStorage.getItem('authToken');
            if (!token) return false;
            
            // Décoder le JWT (sans vérification de signature, juste pour voir le contenu)
            const payloadBase64 = token.split('.')[1];
            const payload = JSON.parse(atob(payloadBase64));
            console.log('Décodage du token JWT:', payload);
            
            return payload && payload.role === 'admin';
        } catch (e) {
            console.error('Erreur lors de la vérification des droits admin:', e);
            return false;
        }
    }

    // Fonction pour charger les données utilisateurs
    function loadUsersData() {
        console.log('Chargement des utilisateurs...');
        const token = localStorage.getItem('authToken');
        
        if (!token) {
            showUserFixMessage('Vous devez être connecté pour accéder à cette fonctionnalité', 'error');
            console.error('Token manquant - utilisateur non connecté');
            return;
        }
        
        // Vérifier les droits admin
        if (!checkAdminRights()) {
            showUserFixMessage('Vous n\'avez pas les droits administrateur nécessaires', 'error');
            console.error('Utilisateur sans droits admin tente d\'accéder à la gestion des utilisateurs');
            return;
        }
        
        console.log('Envoi de la requête avec token:', token.substring(0, 15) + '...');
        
        fetch('/api/auth/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => {
            console.log('Réponse du serveur:', response.status, response.statusText);
            if (response.status === 401) {
                // Problème d'authentification
                localStorage.removeItem('authToken'); // Supprimer le token invalide
                showUserFixMessage('Session expirée ou invalide. Veuillez vous reconnecter.', 'error');
                throw new Error('Token invalide ou expiré');
            } else if (response.status === 403) {
                // Problème d'autorisation
                showUserFixMessage('Vous n\'avez pas les droits nécessaires pour accéder à cette ressource', 'error');
                throw new Error('Accès refusé - Droits insuffisants');
            } else if (!response.ok) {
                throw new Error(`Erreur ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Données utilisateurs reçues:', data);
            if (data.success) {
                renderFixUsersList(data.users);
                showUserFixMessage(`${data.users.length} utilisateur(s) chargé(s) avec succès`, 'success');
            } else {
                showUserFixMessage(data.message || 'Erreur lors du chargement des utilisateurs', 'error');
            }
        })
        .catch(error => {
            console.error('Erreur lors du chargement des utilisateurs:', error);
            console.error('Message d\'erreur complet:', error.message);
            console.error('Stack trace:', error.stack);
            showUserFixMessage('Erreur de connexion à l\'API: ' + error.message, 'error');
        });
    }
    
    // Fonction pour afficher les utilisateurs
    function renderFixUsersList(users) {
        const tableBody = document.getElementById('users-fix-list');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        if (!users || users.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="6" style="text-align: center; padding: 15px;">Aucun utilisateur trouvé</td>
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
            
            // Style pour le badge de rôle
            const roleStyle = user.role === 'admin' 
                ? 'background-color: #dc3545; color: white;' 
                : 'background-color: #28a745; color: white;';
            
            const roleName = user.role === 'admin' ? 'Administrateur' : 'Agent SAV';
            
            row.innerHTML = `
                <td style="border-bottom: 1px solid #ddd; padding: 10px;">${user.username}</td>
                <td style="border-bottom: 1px solid #ddd; padding: 10px;">${user.fullName || user.name || '-'}</td>
                <td style="border-bottom: 1px solid #ddd; padding: 10px;">
                    <span style="padding: 3px 8px; border-radius: 4px; font-size: 12px; ${roleStyle}">
                        ${roleName}
                    </span>
                </td>
                <td style="border-bottom: 1px solid #ddd; padding: 10px;">${createdAt.toLocaleDateString()} ${createdAt.toLocaleTimeString()}</td>
                <td style="border-bottom: 1px solid #ddd; padding: 10px;">${lastLoginDate}</td>
                <td style="border-bottom: 1px solid #ddd; padding: 10px; text-align: center;">
                    <button class="fix-edit-btn" data-id="${user._id}" style="background: none; border: none; cursor: pointer; margin: 0 5px;" title="Modifier">
                        <i class="fas fa-edit" style="color: #007bff;"></i>
                    </button>
                    <button class="fix-reset-btn" data-id="${user._id}" data-username="${user.username}" style="background: none; border: none; cursor: pointer; margin: 0 5px;" title="Réinitialiser mot de passe">
                        <i class="fas fa-key" style="color: #ffc107;"></i>
                    </button>
                    <button class="fix-delete-btn" data-id="${user._id}" data-username="${user.username}" style="background: none; border: none; cursor: pointer; margin: 0 5px;" title="Supprimer">
                        <i class="fas fa-trash-alt" style="color: #dc3545;"></i>
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
        
        // Ajouter les événements aux boutons
        document.querySelectorAll('.fix-edit-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                openFixUserForm(this.getAttribute('data-id'));
            });
        });
        
        document.querySelectorAll('.fix-reset-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                resetFixUserPassword(
                    this.getAttribute('data-id'),
                    this.getAttribute('data-username')
                );
            });
        });
        
        document.querySelectorAll('.fix-delete-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                openFixDeleteModal(
                    this.getAttribute('data-id'),
                    this.getAttribute('data-username')
                );
            });
        });
    }
    
    // Initialiser les événements
    function initFixEvents() {
        // Formulaire utilisateur
        document.getElementById('user-fix-form').addEventListener('submit', function(e) {
            e.preventDefault();
            submitFixUserForm();
        });
        
        document.getElementById('cancel-fix-user-form').addEventListener('click', function() {
            document.getElementById('user-fix-modal').style.display = 'none';
        });
        
        // Modal de suppression
        document.getElementById('confirm-fix-delete').addEventListener('click', function() {
            deleteFixUser(document.getElementById('delete-fix-id').value);
        });
        
        document.getElementById('cancel-fix-delete').addEventListener('click', function() {
            document.getElementById('delete-fix-modal').style.display = 'none';
        });
        
        // Modal de réinitialisation
        document.getElementById('close-fix-reset').addEventListener('click', function() {
            document.getElementById('reset-fix-password-modal').style.display = 'none';
        });
    }
    
    // Fonctions d'ouverture de modals
    function openFixUserForm(userId = null) {
        const modal = document.getElementById('user-fix-modal');
        const title = document.getElementById('user-fix-form-title');
        const form = document.getElementById('user-fix-form');
        const passwordGroup = document.getElementById('user-fix-password-group');
        
        // Réinitialiser le formulaire
        form.reset();
        document.getElementById('user-fix-id').value = '';
        
        if (userId) {
            // Mode édition
            title.textContent = 'Modifier un utilisateur';
            document.getElementById('user-fix-id').value = userId;
            
            // Le mot de passe est facultatif en mode édition
            document.getElementById('user-fix-password').removeAttribute('required');
            passwordGroup.querySelector('label').textContent = 'Mot de passe (laisser vide pour ne pas modifier)';
            
            // Charger les données de l'utilisateur
            const token = localStorage.getItem('authToken');
            
            fetch(`/api/auth/users/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const user = data.user;
                    document.getElementById('user-fix-username').value = user.username;
                    document.getElementById('user-fix-fullname').value = user.fullName || user.name || '';
                    document.getElementById('user-fix-email').value = user.email || '';
                    document.getElementById('user-fix-role').value = user.role;
                } else {
                    showUserFixMessage(data.message || 'Erreur lors du chargement des données utilisateur', 'error');
                }
            })
            .catch(error => {
                console.error('Erreur lors du chargement des données utilisateur:', error);
                showUserFixMessage('Erreur: ' + error.message, 'error');
            });
        } else {
            // Mode ajout
            title.textContent = 'Ajouter un utilisateur';
            document.getElementById('user-fix-password').setAttribute('required', 'required');
            passwordGroup.querySelector('label').textContent = 'Mot de passe';
        }
        
        // Afficher le modal
        modal.style.display = 'flex';
    }
    
    function openFixDeleteModal(userId, username) {
        document.getElementById('delete-fix-id').value = userId;
        document.getElementById('delete-fix-username').textContent = username;
        document.getElementById('delete-fix-modal').style.display = 'flex';
    }
    
    // Fonction de soumission du formulaire
    function submitFixUserForm() {
        const userId = document.getElementById('user-fix-id').value;
        const isEdit = !!userId;
        
        const userData = {
            username: document.getElementById('user-fix-username').value,
            fullName: document.getElementById('user-fix-fullname').value,
            email: document.getElementById('user-fix-email').value,
            role: document.getElementById('user-fix-role').value
        };
        
        // Ajouter le mot de passe seulement s'il est renseigné ou en mode création
        const password = document.getElementById('user-fix-password').value;
        if (password || !isEdit) {
            userData.password = password;
        }
        
        const token = localStorage.getItem('authToken');
        const url = isEdit ? `/api/auth/users/${userId}` : '/api/auth/users';
        const method = isEdit ? 'PUT' : 'POST';
        
        fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(userData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showUserFixMessage(
                    isEdit ? 'Utilisateur modifié avec succès' : 'Utilisateur créé avec succès', 
                    'success'
                );
                document.getElementById('user-fix-modal').style.display = 'none';
                loadUsersData(); // Recharger la liste
            } else {
                showUserFixMessage(data.message || 'Erreur lors de l\'opération', 'error');
            }
        })
        .catch(error => {
            console.error('Erreur:', error);
            showUserFixMessage('Erreur: ' + error.message, 'error');
        });
    }
    
    // Fonction de suppression d'utilisateur
    function deleteFixUser(userId) {
        const token = localStorage.getItem('authToken');
        
        fetch(`/api/auth/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showUserFixMessage('Utilisateur supprimé avec succès', 'success');
                document.getElementById('delete-fix-modal').style.display = 'none';
                loadUsersData(); // Recharger la liste
            } else {
                showUserFixMessage(data.message || 'Erreur lors de la suppression', 'error');
            }
        })
        .catch(error => {
            console.error('Erreur:', error);
            showUserFixMessage('Erreur: ' + error.message, 'error');
        });
    }
    
    // Fonction de réinitialisation de mot de passe
    function resetFixUserPassword(userId, username) {
        const token = localStorage.getItem('authToken');
        
        fetch(`/api/auth/users/${userId}/reset-password`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('reset-fix-username').textContent = username;
                document.getElementById('new-fix-password').textContent = data.temporaryPassword;
                document.getElementById('reset-fix-password-modal').style.display = 'flex';
            } else {
                showUserFixMessage(data.message || 'Erreur lors de la réinitialisation du mot de passe', 'error');
            }
        })
        .catch(error => {
            console.error('Erreur:', error);
            showUserFixMessage('Erreur: ' + error.message, 'error');
        });
    }
    
    // Attacher l'événement au lien de menu utilisateurs
    const usersLink = document.querySelector('a[href="#users"]');
    if (usersLink) {
        console.log('Lien de menu utilisateurs trouvé, attachement de l\'événement');
        usersLink.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('Clic sur lien utilisateurs détecté');
            
            // Activer visuellement l'élément de navigation
            document.querySelectorAll('.horizontal-nav li').forEach(item => {
                item.classList.remove('active');
            });
            usersLink.parentElement.classList.add('active');
            
            // Créer et afficher l'interface
            createUsersInterface();
        });
    } else {
        console.error('Lien de menu utilisateurs non trouvé');
    }
    
    // Si le hash de l'URL est #users, déclencher l'affichage directement
    if (window.location.hash === '#users') {
        console.log('Fragment #users détecté dans l\'URL, activation automatique');
        if (usersLink) usersLink.click();
        else createUsersInterface();
    }
});
