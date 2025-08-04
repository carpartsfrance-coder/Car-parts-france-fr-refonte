// Rendre certaines variables et fonctions accessibles globalement pour kanban.js
window.authToken = localStorage.getItem('authToken');

// Traduction des types de pièces (globale)
window.partTypeTranslations = {
    'boite_vitesses': 'Boîte de vitesses',
    'moteur': 'Moteur',
    'mecatronique': 'Mécatronique',
    'boite_transfert': 'Boîte de transfert',
    'pont': 'Pont',
    'autres': 'Autres pièces'
};

// Traductions des statuts (globale)
window.statusTranslations = {
    'nouveau': 'Nouveau',
    'en_analyse': 'En analyse',
    'info_complementaire': 'Info complémentaire',
    'validé': 'Validé',
    'refusé': 'Refusé',
    'en_cours_traitement': 'En traitement',
    'expédié': 'Expédié',
    'clôturé': 'Clôturé'
};

// Traductions des priorités (globale)
window.priorityTranslations = {
    'urgent': 'Urgent',
    'élevé': 'Élevé',
    'moyen': 'Moyen',
    'faible': 'Faible'
};

// Fonction pour formater une date (globale)
window.formatDate = function(dateString) {
    const options = { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString('fr-FR', options);
};

// Fonction pour supprimer un ticket (globale)
window.deleteTicket = async function(ticketId, ticketNumber, event) {
    // Si l'événement est fourni, empêcher le comportement par défaut
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    try {
        console.log('Suppression du ticket:', ticketId, ticketNumber);
        
        // Vérifier que l'ID du ticket est valide
        if (!ticketId) {
            throw new Error('ID du ticket manquant');
        }
        
        // Demander confirmation avant de supprimer
        const confirmed = confirm(`Êtes-vous sûr de vouloir supprimer le ticket ${ticketNumber} ? Cette action est irréversible.`);
        
        if (!confirmed) {
            return; // Annuler si l'utilisateur n'a pas confirmé
        }
        
        console.log('Envoi de la requête DELETE pour le ticket:', ticketId);
        
        // Utiliser une URL relative qui fonctionnera sur n'importe quel domaine
        const deleteUrl = `/api/admin/tickets/${ticketId}`;
        console.log('URL de suppression (relative):', deleteUrl);
        
        try {
            const response = await fetch(deleteUrl, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Basic ${authToken}`,
                    'Content-Type': 'application/json'
                },
                // Ajouter des options pour s'assurer que les cookies sont envoyés
                credentials: 'same-origin'
            });
            
            console.log('Statut de la réponse:', response.status);
            
            // Gérer les réponses non-JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                console.error('Réponse non-JSON reçue:', text);
                throw new Error(`Erreur serveur: ${response.status} ${response.statusText}`);
            }
            
            if (!response.ok) {
                if (response.status === 404) {
                    // Cas spécifique pour les tickets non trouvés
                    showNotification('error', `Le ticket ${ticketNumber} n'existe plus dans la base de données. La page va être rechargée.`);
                    setTimeout(() => {
                        window.location.reload();
                    }, 3000);
                    return;
                } else if (response.status === 401) {
                    throw new Error('Accès non autorisé. Veuillez vous reconnecter.');
                } else {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Erreur lors de la suppression du ticket');
                }
            }
        } catch (fetchError) {
            console.error('Erreur lors de la requête fetch:', fetchError);
            console.error('Message d\'erreur:', fetchError.message);
            console.error('Stack trace:', fetchError.stack);
            
            if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('NetworkError')) {
                showNotification('error', 'Erreur de connexion au serveur. Vérifiez que le serveur est en cours d\'exécution sur le port 3000.');
                throw new Error('Erreur de connexion au serveur');
            }
            
            // Afficher une notification avec le message d'erreur
            showNotification('error', `Erreur: ${fetchError.message || 'Erreur inconnue lors de la suppression'}`);
            throw fetchError;
        }
        
        // Afficher une notification de succès
        window.showNotification(`Le ticket ${ticketNumber} a été supprimé avec succès`, 'success');
        
        // Éviter tout rechargement automatique de la page
        
        // Vérifier quelle vue est actuellement active
        const isKanbanActive = document.getElementById('kanban-view') && 
                            window.getComputedStyle(document.getElementById('kanban-view')).display !== 'none';
        const isListActive = document.getElementById('list-view') && 
                          window.getComputedStyle(document.getElementById('list-view')).display !== 'none';
        
        console.log('Vue active:', isKanbanActive ? 'Kanban' : (isListActive ? 'Liste' : 'Inconnue'));
        
        // Si nous sommes dans la vue Kanban, rafraîchir la vue
        if (isKanbanActive) {
            console.log('Vue Kanban détectée, rafraîchissement...');
            if (typeof refreshKanbanView === 'function') {
                refreshKanbanView();
            }
        } else {
            console.log('Vue liste détectée, suppression de la ligne...');
            console.log('ID du ticket à supprimer:', ticketId);
            
            // Afficher toutes les lignes de tickets disponibles pour débogage
            const allRows = document.querySelectorAll('tr.ticket-row');
            console.log('Nombre total de lignes de tickets:', allRows.length);
            allRows.forEach(row => {
                console.log('Ligne trouvée avec ID:', row.getAttribute('data-ticket-id'), 
                          'Contenu:', row.textContent.substring(0, 30) + '...');
            });
            
            // Trouver la ligne du ticket dans le tableau (plusieurs sélecteurs possibles)
            let ticketRow = document.querySelector(`tr[data-ticket-id="${ticketId}"]`);
            console.log('Résultat de recherche avec tr[data-ticket-id]:', ticketRow);
            
            if (!ticketRow) {
                ticketRow = document.querySelector(`.ticket-row[data-id="${ticketId}"]`);
                console.log('Résultat de recherche avec .ticket-row[data-id]:', ticketRow);
            }
            
            if (!ticketRow) {
                console.log('Recherche par contenu textuel...');
                // Essayer de trouver par le numéro de ticket
                const rows = document.querySelectorAll('tr');
                for (const row of rows) {
                    if (row.textContent.includes(ticketNumber)) {
                        ticketRow = row;
                        console.log('Ligne trouvée par contenu textuel:', row);
                        break;
                    }
                }
            }
            
            if (ticketRow) {
                console.log('Ligne de ticket trouvée:', ticketRow);
                // Désactiver tous les boutons d'action dans cette ligne
                const actionButtons = ticketRow.querySelectorAll('button');
                actionButtons.forEach(button => {
                    button.disabled = true;
                    button.style.opacity = '0.5';
                    button.style.cursor = 'not-allowed';
                });
                
                // Animation de suppression
                ticketRow.style.transition = 'all 0.5s ease';
                ticketRow.style.backgroundColor = '#ffcccc';
                
                setTimeout(() => {
                    ticketRow.style.opacity = '0';
                    ticketRow.style.height = '0';
                    ticketRow.style.overflow = 'hidden';
                    
                    setTimeout(() => {
                        ticketRow.remove();
                        // Mettre à jour les compteurs
                        if (typeof updateTicketCounters === 'function') {
                            updateTicketCounters();
                        }
                    }, 500);
                }, 300);
            } else {
                console.log('Ligne du ticket non trouvée dans le DOM');
            }
        }
        
    } catch (error) {
        console.error('Erreur lors de la suppression du ticket:', error);
        console.error('Message d\'erreur:', error.message);
        console.error('Stack trace:', error.stack);
        showNotification('error', `Erreur lors de la suppression du ticket ${ticketNumber}: ${error.message || 'Erreur inconnue'}`);
        if (error.message === 'Unauthorized') {
            logout();
        }
    }
};

// Fonction auxiliaire pour mettre à jour les compteurs de tickets
window.updateTicketCounters = function() {
    // Récupérer tous les tickets actuellement affichés
    const tickets = document.querySelectorAll('.ticket-row');
    
    // Compteurs
    let pendingCount = 0;
    let resolvedCount = 0;
    let urgentCount = 0;
    
    // Analyser chaque ticket
    tickets.forEach(ticket => {
        const status = ticket.getAttribute('data-status');
        const priority = ticket.getAttribute('data-priority');
        const dateCreated = ticket.getAttribute('data-date');
        
        if (status === 'clôturé') {
            resolvedCount++;
        } else {
            pendingCount++;
            
            // Vérifier si le ticket est urgent (nouveau et plus de 2 jours)
            if (status === 'nouveau' && dateCreated) {
                const ticketDate = new Date(dateCreated);
                const now = new Date();
                const diffTime = Math.abs(now - ticketDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays >= 2 || priority === 'urgent') {
                    urgentCount++;
                }
            }
        }
    });
    
    // Mettre à jour les compteurs dans l'interface
    const pendingElement = document.getElementById('pending-tickets');
    const resolvedElement = document.getElementById('resolved-tickets');
    const urgentElement = document.getElementById('urgent-tickets');
    
    if (pendingElement) pendingElement.textContent = pendingCount;
    if (resolvedElement) resolvedElement.textContent = resolvedCount;
    if (urgentElement) urgentElement.textContent = urgentCount;
};

// Fonction pour afficher les détails d'un ticket (globale)
window.viewTicket = async function(ticketId) {
    try {
        window.currentTicketId = ticketId;
        
        // Récupérer les détails du ticket
        const response = await fetch(`/api/admin/tickets/${ticketId}`, {
            headers: {
                'Authorization': `Basic ${window.authToken}`
            }
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Unauthorized');
            }
            throw new Error('Erreur lors de la récupération des détails du ticket');
        }
        
        const ticket = await response.json();
        
        // Masquer la liste des tickets et afficher les détails
        document.getElementById('admin-dashboard').style.display = 'none';
        document.getElementById('ticket-details').style.display = 'block';
        
        // Remplir les détails du ticket
        window.displayTicketDetails(ticket);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des détails du ticket:', error);
        if (error.message === 'Unauthorized') {
            logout();
        }
        window.showNotification('Erreur lors de la récupération des détails du ticket', 'error');
    }
};

// Fonction pour afficher les détails d'un ticket (globale)
window.displayTicketDetails = function(ticket, statusHistory) {
    // Mettre à jour le fil d'Ariane
    document.getElementById('breadcrumb-ticket-number').textContent = ticket.ticketNumber;
    
    // Informations générales
    document.getElementById('detail-ticket-number').textContent = ticket.ticketNumber;
    
    // Afficher la priorité actuelle
    console.log('Mise à jour de la priorité');
    const priorityElement = document.getElementById('detail-ticket-priority');
    const currentPriorityElement = document.getElementById('detail-ticket-current-priority');
    
    // Débuggage détaillé
    console.log('Détails du ticket pour la priorité:', ticket);
    console.log('Elément priorité trouvé dans le DOM:', priorityElement ? 'Oui' : 'Non');
    console.log('Elément priorité caché trouvé dans le DOM:', currentPriorityElement ? 'Oui' : 'Non');
    
    // Définir une priorité à utiliser (depuis le ticket ou par défaut)
    const ticketPriority = ticket.priority || 'moyen';
    console.log('Priorité du ticket utilisée:', ticketPriority);
    
    // Mettre à jour l'élément d'affichage de la priorité
    if (priorityElement) {
        const priorityText = window.priorityTranslations[ticketPriority] || ticketPriority;
        priorityElement.textContent = `Priorité: ${priorityText}`;
        priorityElement.className = `priority-badge priority-${ticketPriority}`;
        priorityElement.style.display = 'inline-block';
    } else {
        console.error('L\'\u00e9lément priorité est introuvable dans le DOM');
    }
    
    // Dictionnaire de traduction des priorités
    const priorityTranslations = {
        'eleve': 'Élevée',
        'moyen': 'Moyenne',
        'faible': 'Faible'
    };
    
    // Stocker la priorité actuelle dans l'élément caché et mettre à jour l'indicateur visible
    if (currentPriorityElement) {
        currentPriorityElement.textContent = ticketPriority;
        currentPriorityElement.setAttribute('data-priority', ticketPriority);
        console.log('Priorité actuelle stockée dans l\'\u00e9lément caché:', ticketPriority);
        console.log('Vérification de l\'attribut data-priority:', currentPriorityElement.getAttribute('data-priority'));
    } else {
        console.error('L\'\u00e9lément caché pour la priorité est introuvable');
    }
    
    // Mise à jour de l'indicateur visible de priorité (qu'on ait trouvé l'élément caché ou non)
    const visiblePriorityElement = document.getElementById('visible-current-priority');
    if (visiblePriorityElement) {
        const priorityText = priorityTranslations[ticketPriority] || ticketPriority;
        visiblePriorityElement.textContent = priorityText;
        visiblePriorityElement.className = `priority-${ticketPriority}`;
        console.log('Indicateur de priorité visible mis à jour avec:', priorityText);
    } else {
        console.error('L\'\u00e9lément visible-current-priority n\'existe pas dans le DOM');
    }
    
    // Stocker le statut actuel du ticket dans l'élément invisible et mettre à jour l'indicateur visible
    const statusElement = document.getElementById('detail-ticket-status');
    const visibleStatusElement = document.getElementById('visible-current-status');
    
    // Dictionnaire de traduction des statuts
    const statusTranslations = {
        'nouveau': 'Nouveau',
        'en_cours': 'En cours de traitement',
        'en_attente_client': 'En attente du client',
        'en_attente_fournisseur': 'En attente du fournisseur',
        'resolu': 'Résolu',
        'ferme': 'Fermé',
        'info_complementaire': 'Informations complémentaires requises'
    };
    
    console.log('Mise à jour du statut visible:', ticket.currentStatus);
    
    if (statusElement) {
        // Vérifions que currentStatus existe et n'est pas vide
        if (ticket.currentStatus) {
            const translatedStatus = statusTranslations[ticket.currentStatus] || ticket.currentStatus;
            statusElement.textContent = translatedStatus;
            statusElement.setAttribute('data-status', ticket.currentStatus);
            console.log('Statut actuel stocké dans l\'élément:', ticket.currentStatus);
            console.log('Statut traduit:', translatedStatus);
            
            // Mise à jour de l'indicateur visible
            if (visibleStatusElement) {
                visibleStatusElement.textContent = translatedStatus;
                visibleStatusElement.className = `status-${ticket.currentStatus}`;
                console.log('Indicateur de statut visible mis à jour avec:', translatedStatus);
            } else {
                console.error('L\'élément visible-current-status n\'existe pas dans le DOM');
            }
        } else {
            console.error('Le ticket n\'a pas de currentStatus valide:', ticket);
            if (visibleStatusElement) {
                visibleStatusElement.textContent = 'Non défini';
            }
        }
    } else {
        console.error('L\'élément detail-ticket-status n\'existe pas dans le DOM');
    }
    
    // Informations client
    document.getElementById('detail-client-name').textContent = `${ticket.clientInfo.firstName} ${ticket.clientInfo.lastName}`;
    document.getElementById('detail-client-email').textContent = ticket.clientInfo.email;
    document.getElementById('detail-client-phone').textContent = ticket.clientInfo.phone;
    document.getElementById('detail-order-number').textContent = ticket.orderInfo.orderNumber;
    
    // Informations véhicule
    document.getElementById('detail-vehicle-vin').textContent = ticket.vehicleInfo.vin || 'Non spécifié';
    document.getElementById('detail-installation-date').textContent = ticket.vehicleInfo.installationDate ? formatDate(ticket.vehicleInfo.installationDate) : 'Non spécifié';
    
    // Informations pièce et problème
    document.getElementById('detail-part-type').textContent = partTypeTranslations[ticket.partInfo.partType] || ticket.partInfo.partType;
    document.getElementById('detail-symptom').textContent = ticket.partInfo.symptom || 'Non spécifié';
    document.getElementById('detail-failure-time').textContent = ticket.partInfo.failureTime || 'Non spécifié';
    document.getElementById('detail-error-codes').textContent = ticket.partInfo.errorCodes || 'Non spécifié';
    document.getElementById('detail-pro-installation').textContent = ticket.partInfo.professionalInstallation ? 'Oui' : 'Non';
    document.getElementById('detail-oil-filled').textContent = ticket.partInfo.oilFilled ? 'Oui' : 'Non';
    document.getElementById('detail-oil-quantity').textContent = ticket.partInfo.oilQuantity ? `${ticket.partInfo.oilQuantity} L` : 'Non spécifié';
    document.getElementById('detail-oil-reference').textContent = ticket.partInfo.oilReference || 'Non spécifié';
    document.getElementById('detail-new-parts').textContent = ticket.partInfo.newParts ? 'Oui' : 'Non';
    document.getElementById('detail-parts-details').textContent = ticket.partInfo.newPartsDetails || 'Non spécifié';
    
    // Notes internes
    document.getElementById('internal-notes').value = ticket.internalNotes || '';
};

// Fonction de notification (globale)
window.showNotification = function(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
};
// Fonction pour initialiser le volet latéral des filtres
function initFiltersSidebar() {
    const toggleBtn = document.getElementById('toggle-filters-sidebar');
    const filtersSidebar = document.getElementById('filters-sidebar');
    const mainContent = document.querySelector('.dashboard-main-content');
    
    // Vérifier si les éléments existent
    if (toggleBtn && filtersSidebar) {
        // Gérer le clic sur le bouton de bascule
        toggleBtn.addEventListener('click', function() {
            // Basculer la classe 'collapsed' sur la sidebar
            filtersSidebar.classList.toggle('collapsed');
            
            // Modifier l'icône du bouton
            const icon = toggleBtn.querySelector('i');
            if (icon) {
                if (filtersSidebar.classList.contains('collapsed')) {
                    icon.className = 'fas fa-chevron-right';
                    console.log('Volet fermé, icône changée en chevron-right');
                } else {
                    icon.className = 'fas fa-chevron-left';
                    console.log('Volet ouvert, icône changée en chevron-left');
                }
            }
            
            // Ajuster le padding du contenu principal si nécessaire
            if (mainContent) {
                mainContent.style.transition = 'padding-left 0.3s ease';
            }
            
            // Débug
            console.log('Toggle sidebar - État collapsed:', filtersSidebar.classList.contains('collapsed'));
        });
        
        // Ajouter un bouton mobile pour les écrans plus petits
        if (window.innerWidth <= 992) {
            const mobileToggle = document.createElement('button');
            mobileToggle.className = 'filters-sidebar-toggle-mobile';
            mobileToggle.innerHTML = '<i class="fas fa-filter"></i>';
            document.body.appendChild(mobileToggle);
            
            mobileToggle.addEventListener('click', function() {
                filtersSidebar.classList.toggle('active');
            });
        }
    }
    
    // Fermer la sidebar en cliquant en dehors (pour les appareils mobiles)
    document.addEventListener('click', function(e) {
        if (window.innerWidth <= 992 && filtersSidebar && filtersSidebar.classList.contains('active')) {
            if (!filtersSidebar.contains(e.target) && e.target.id !== 'toggle-filters-sidebar' && !e.target.closest('.filters-sidebar-toggle-mobile')) {
                filtersSidebar.classList.remove('active');
            }
        }
    });
}

function initCollapsibleFilters() {
    const toggleFilters = document.getElementById('toggle-filters');
    const filtersContent = document.getElementById('filters-content');
    const toggleIcon = document.querySelector('.toggle-icon i');
    
    // Vérifier si les éléments existent
    if (!toggleFilters || !filtersContent || !toggleIcon) return;
    
    // Récupérer l'état précédent des filtres (ouvert ou fermé)
    const isCollapsed = localStorage.getItem('filtersCollapsed') === 'true';
    
    // Appliquer l'état initial
    if (isCollapsed) {
        filtersContent.classList.add('collapsed');
        toggleIcon.classList.remove('fa-chevron-down');
        toggleIcon.classList.add('fa-chevron-right');
    }
    
    // Ajouter l'événement de clic pour basculer l'état
    toggleFilters.addEventListener('click', function() {
        filtersContent.classList.toggle('collapsed');
        
        // Mettre à jour l'icône
        const isCollapsed = filtersContent.classList.contains('collapsed');
        toggleIcon.classList.toggle('fa-chevron-down', !isCollapsed);
        toggleIcon.classList.toggle('fa-chevron-right', isCollapsed);
        
        // Sauvegarder l'état dans le localStorage
        localStorage.setItem('filtersCollapsed', isCollapsed);
    });
    
    // Initialiser les onglets de filtres
    initFilterTabs();
}

// Fonction pour initialiser les onglets de filtres
function initFilterTabs() {
    const tabButtons = document.querySelectorAll('.filter-tab-btn');
    const tabContents = document.querySelectorAll('.filter-tab-content');
    
    // Vérifier si les éléments existent
    if (!tabButtons.length || !tabContents.length) return;
    
    // Récupérer l'onglet actif précédent
    const activeTab = localStorage.getItem('activeFilterTab') || 'basic';
    
    // Activer l'onglet par défaut ou celui sauvegardé
    activateTab(activeTab);
    
    // Ajouter les événements de clic pour chaque bouton d'onglet
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            activateTab(tabName);
            
            // Sauvegarder l'onglet actif dans le localStorage
            localStorage.setItem('activeFilterTab', tabName);
        });
    });
    
    // Synchroniser les filtres entre les onglets
    setupFilterSync();
    
    // Fonction pour activer un onglet spécifique
    function activateTab(tabName) {
        // Désactiver tous les onglets
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        // Activer l'onglet sélectionné
        const selectedButton = document.querySelector(`.filter-tab-btn[data-tab="${tabName}"]`);
        const selectedContent = document.getElementById(`tab-${tabName}`);
        
        if (selectedButton && selectedContent) {
            selectedButton.classList.add('active');
            selectedContent.classList.add('active');
        }
    }
}

// Fonction pour synchroniser les filtres entre les onglets
function setupFilterSync() {
    // Synchroniser les filtres de statut
    const statusFilter = document.getElementById('status-filter');
    const statusFilterFull = document.getElementById('status-filter-full');
    
    if (statusFilter && statusFilterFull) {
        statusFilter.addEventListener('change', function() {
            statusFilterFull.value = this.value;
        });
        
        statusFilterFull.addEventListener('change', function() {
            statusFilter.value = this.value;
        });
    }
    
    // Synchroniser les filtres de type de pièce
    const partFilter = document.getElementById('part-filter');
    const partFilterFull = document.getElementById('part-filter-full');
    
    if (partFilter && partFilterFull) {
        partFilter.addEventListener('change', function() {
            partFilterFull.value = this.value;
        });
        
        partFilterFull.addEventListener('change', function() {
            partFilter.value = this.value;
        });
    }
}    

document.addEventListener('DOMContentLoaded', function() {
    // Initialiser le volet des filtres latéral
    initFiltersSidebar();
    
    // Initialiser les filtres collapsibles
    initCollapsibleFilters();
    
    // Gestion des onglets dans la vue détaillée
    function initTabsSystem() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                
                // Désactiver tous les onglets
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                // Activer l'onglet sélectionné
                button.classList.add('active');
                document.getElementById(`tab-${tabId}`).classList.add('active');
            });
        });
    }
    
    // Initialisation des variables globales
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const adminLogin = document.getElementById('admin-login');
    const ticketDetails = document.getElementById('ticket-details');
    const logoutBtn = document.getElementById('logout-btn');
    const backToListBtn = document.getElementById('back-to-list');
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('status-filter');
    const partFilter = document.getElementById('part-filter');
    const ticketsList = document.getElementById('tickets-list');
    const pagination = document.getElementById('pagination');
    // Ces éléments seront initialisés plus tard quand le DOM sera prêt
    let updateStatusForm = null;
    let newStatusSelect = null;
    let additionalInfoGroup = null;
    let saveNotesBtn = null;
    
    // Variables globales
    let currentPage = 1;
    let totalPages = 1;
    let currentTicketId = null;
    let authToken = window.authToken;
    
    // Traduction des types de pièces
    const partTypeTranslations = {
        'boite_vitesses': 'Boîte de vitesses',
        'moteur': 'Moteur',
        'mecatronique': 'Mécatronique',
        'boite_transfert': 'Boîte de transfert',
        'pont': 'Pont',
        'autres': 'Autres pièces'
    };
    
    // Traductions des statuts et types de pièces
    const statusTranslations = {
        'nouveau': 'Nouveau',
        'en_analyse': 'En analyse',
        'info_complementaire': 'Info complémentaire',
        'validé': 'Validé',
        'refusé': 'Refusé',
        'en_cours_traitement': 'En traitement',
        'expédié': 'Expédié',
        'clôturé': 'Clôturé'
    };
    
    // Traductions des priorités
    const priorityTranslations = {
        'faible': 'Faible',
        'moyen': 'Moyenne',
        'élevé': 'Élevée',
        'urgent': 'Urgente'
    };
    
    // Icônes pour les statuts
    const statusIcons = {
        'nouveau': 'fa-file',
        'en_analyse': 'fa-magnifying-glass',
        'info_complementaire': 'fa-circle-question',
        'validé': 'fa-check',
        'refusé': 'fa-xmark',
        'en_cours_traitement': 'fa-gear',
        'expédié': 'fa-truck',
        'clôturé': 'fa-flag-checkered'
    };
    
    // Icônes pour les types de documents
    const documentTypeIcons = {
        'lecture_obd': 'fa-microchip',
        'photo_piece': 'fa-image',
        'factures_pieces': 'fa-receipt',
        'media_transmission': 'fa-film',
        'factures_transmission': 'fa-file-invoice-dollar',
        'photos_moteur': 'fa-camera',
        'factures_entretien': 'fa-wrench',
        'documents_autres': 'fa-file'
    };
    
    // Traductions pour les types de documents
    const documentTypeTranslations = {
        'lecture_obd': 'Lecture OBD',
        'photo_piece': 'Photos de la pièce',
        'factures_pieces': 'Factures des pièces',
        'media_transmission': 'Vidéo symptôme',
        'factures_transmission': 'Factures de transmission',
        'photos_moteur': 'Photos du moteur',
        'factures_entretien': 'Factures d\'entretien',
        'documents_autres': 'Autres documents'
    };
    
    // Ordre d'affichage des types de documents
    const documentTypeOrder = [
        'factures_pieces',
        'factures_transmission',
        'factures_entretien',
        'lecture_obd',
        'media_transmission',
        'photo_piece',
        'photos_moteur',
        'documents_autres'
    ];
    
    // Fonction pour formater une date
    function formatDate(dateString) {
        const options = { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        return new Date(dateString).toLocaleDateString('fr-FR', options);
    }
    
    // Vérifier si l'utilisateur est connecté
    function checkAuth() {
        if (authToken) {
            adminLogin.style.display = 'none';
            document.querySelector('.admin-dashboard').style.display = 'block';
            loadDashboard();
        } else {
            adminLogin.style.display = 'flex';
            document.querySelector('.admin-dashboard').style.display = 'none';
            ticketDetails.style.display = 'none';
        }
    }
    
    // Fonction de connexion
    async function login(username, password) {
        try {
            // Créer le token Basic Auth
            const token = btoa(`${username}:${password}`);
            
            // Tester la connexion en récupérant la liste des tickets
            const response = await fetch('/api/admin/tickets', {
                headers: {
                    'Authorization': `Basic ${token}`
                }
            });
            
            if (response.ok) {
                // Stocker le token et afficher le tableau de bord
                localStorage.setItem('authToken', token);
                authToken = token;
                checkAuth();
            } else {
                throw new Error('Identifiants incorrects');
            }
        } catch (error) {
            loginError.textContent = error.message;
            loginError.style.display = 'block';
        }
    }
    
    // Fonction de déconnexion
    function logout() {
        localStorage.removeItem('authToken');
        authToken = null;
        checkAuth();
    }
    
    // Charger le tableau de bord
    // Fonction simplifiée pour charger uniquement les tickets et statistiques de base
    async function loadDashboard() {
        try {
            await loadTickets();
            await loadStats();
        } catch (error) {
            console.error('Erreur lors du chargement des tickets:', error);
            if (error.message === 'Unauthorized') {
                logout();
            }
        }
    }
    
    // Charger les statistiques
    async function loadStats() {
        try {
            // Utiliser limit=0 pour récupérer tous les tickets sans pagination
            const response = await fetch('/api/admin/tickets?limit=0', {
                headers: {
                    'Authorization': `Basic ${authToken}`
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized');
                }
                throw new Error('Erreur lors de la récupération des statistiques');
            }
            
            const data = await response.json();
            
            // Compter les tickets par statut
            let totalTickets = data.tickets.length; // Utiliser la longueur réelle des tickets reçus
            let pendingTickets = 0;
            let resolvedTickets = 0;
            let urgentTickets = 0;
            let otherStatusTickets = 0;
            
            // Définir les statuts pour chaque catégorie
            const pendingStatuses = ['nouveau', 'en_analyse', 'info_complementaire', 'en_cours_traitement'];
            const resolvedStatuses = ['validé', 'expédié', 'clôturé'];
            
            // Log pour débogage
            console.log(`Nombre total de tickets reçus: ${totalTickets}`);
            
            data.tickets.forEach(ticket => {
                // Log pour débogage
                console.log(`Ticket ${ticket.ticketNumber} - Statut: ${ticket.currentStatus} - Priorité: ${ticket.priority || 'non définie'}`);
                
                // Compter par catégorie de statut
                if (pendingStatuses.includes(ticket.currentStatus)) {
                    pendingTickets++;
                } else if (resolvedStatuses.includes(ticket.currentStatus)) {
                    resolvedTickets++;
                } else {
                    otherStatusTickets++;
                    console.log(`Ticket avec statut non catégorisé: ${ticket.ticketNumber} - ${ticket.currentStatus}`);
                }
                
                // Considérer comme urgent les tickets nouveaux de plus de 48h ou avec priorité "urgent"
                const ticketDate = new Date(ticket.createdAt);
                const now = new Date();
                const diffTime = Math.abs(now - ticketDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if ((ticket.currentStatus === 'nouveau' && diffDays >= 2) || ticket.priority === 'urgent') {
                    urgentTickets++;
                }
            });
            
            // Vérifier la cohérence des statistiques
            const calculatedTotal = pendingTickets + resolvedTickets + otherStatusTickets;
            console.log(`Statistiques calculées: En attente=${pendingTickets}, Résolus=${resolvedTickets}, Autres=${otherStatusTickets}, Total calculé=${calculatedTotal}, Total reçu=${totalTickets}`);
            
            if (calculatedTotal !== totalTickets) {
                console.warn(`Incohérence dans les statistiques: Total calculé (${calculatedTotal}) != Total reçu (${totalTickets})`);
            }
            
            // Utiliser le total calculé pour plus de cohérence
            document.getElementById('total-tickets').textContent = totalTickets;
            document.getElementById('pending-tickets').textContent = pendingTickets;
            document.getElementById('resolved-tickets').textContent = resolvedTickets;
            document.getElementById('urgent-tickets').textContent = urgentTickets;
            
            // Afficher un message dans la console pour les statuts non catégorisés
            if (otherStatusTickets > 0) {
                console.warn(`Attention: ${otherStatusTickets} tickets ont un statut qui n'est ni "en attente" ni "résolu".`);
            }
            
        } catch (error) {
            console.error('Erreur lors du chargement des statistiques:', error);
            throw error;
        }
    }
    
    // Fonction pour mettre à jour l'indicateur de statut actuel
    function updateCurrentStatusIndicator(currentStatus) {
        console.log('Mise à jour de l\'indicateur de statut actuel:', currentStatus);
        
        // Dictionnaire de traduction des statuts
        const statusTranslations = {
            'nouveau': 'Nouveau',
            'en_cours': 'En cours de traitement',
            'en_attente_client': 'En attente du client',
            'en_attente_fournisseur': 'En attente du fournisseur',
            'resolu': 'Résolu',
            'ferme': 'Fermé',
            'info_complementaire': 'Informations complémentaires requises',
            'en_analyse': 'En analyse',
            'validé': 'Validé',
            'refusé': 'Refusé',
            'en_cours_traitement': 'En cours de traitement',
            'expédié': 'Expédié',
            'clôturé': 'Clôturé'
        };

        try {
            // Récupérer l'indicateur visible et l'élément caché
            const visibleStatusElement = document.getElementById('visible-current-status');
            const statusElement = document.getElementById('detail-ticket-status');
            
            if (!currentStatus) {
                console.error('Aucun statut actuel fourni');
                currentStatus = 'nouveau'; // Valeur par défaut
            }
            
            const translatedStatus = statusTranslations[currentStatus] || currentStatus;
            console.log('Statut traduit:', translatedStatus);
            
            // Mettre à jour l'indicateur visible avec le style badge
            if (visibleStatusElement) {
                visibleStatusElement.textContent = translatedStatus;
                // Appliquer la classe du badge de statut
                visibleStatusElement.className = `status-badge status-${currentStatus}`;
                console.log('Indicateur de statut visible mis à jour avec:', translatedStatus);
            } else {
                console.error('Element visible-current-status introuvable dans le DOM');
            }
            
            // Mettre à jour l'élément caché
            if (statusElement) {
                statusElement.textContent = currentStatus;
                statusElement.setAttribute('data-status', currentStatus);
                console.log('Statut actuel stocké dans l\'\u00e9lément caché:', currentStatus);
            } else {
                console.error('Element detail-ticket-status introuvable dans le DOM');
            }
        } catch (error) {
            console.error('Erreur lors de la mise à jour de l\'indicateur de statut:', error);
        }
    }
    
    // Variable pour éviter les chargements multiples
    let isTicketsLoading = false;
    
    // Fonction pour charger les tickets en fonction des filtres
    async function loadTickets(page = 1, filters = {}) {
        // Éviter les appels multiples simultanés
        if (isTicketsLoading) {
            console.log('Un chargement est déjà en cours, abandon du chargement redondant');
            return;
        }
        
        try {
            isTicketsLoading = true;
            currentPage = page;
            
            console.log('loadTickets appelé avec les filtres:', filters);
            // Ajouter une trace de la pile d'appel pour identifier qui appelle cette fonction
            console.log('Trace d\'appel:', new Error().stack);
            
            // Construire l'URL avec les paramètres
            let url = `/api/admin/tickets?page=${page}&limit=10`;
            
            // Ajouter les filtres à l'URL
            if (filters.search) url += `&search=${encodeURIComponent(filters.search)}`;
            if (filters.status) url += `&status=${encodeURIComponent(filters.status)}`;
            if (filters.partType) url += `&partType=${encodeURIComponent(filters.partType)}`;
            if (filters.ticketNumber) url += `&ticketNumber=${encodeURIComponent(filters.ticketNumber)}`;
            if (filters.orderNumber) url += `&orderNumber=${encodeURIComponent(filters.orderNumber)}`;
            if (filters.clientFirstName) url += `&clientFirstName=${encodeURIComponent(filters.clientFirstName)}`;
            if (filters.clientName) url += `&clientName=${encodeURIComponent(filters.clientName)}`;
            if (filters.dateFrom) url += `&dateFrom=${encodeURIComponent(filters.dateFrom)}`;
            if (filters.dateTo) url += `&dateTo=${encodeURIComponent(filters.dateTo)}`;
            if (filters.priority) url += `&priority=${encodeURIComponent(filters.priority)}`;
            
            console.log('URL de requête construite:', url);
            
            // Vérifier que le token d'authentification est disponible
            if (!authToken) {
                console.error('Erreur: Token d\'authentification manquant');
                logout(); // Rediriger vers la page de connexion
                return;
            }
            
            console.log('Token d\'authentification utilisé:', authToken);
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Basic ${authToken}`
                }
            });
            
            console.log('Statut de la réponse:', response.status);
            
            if (!response.ok) {
                if (response.status === 401) {
                    console.error('Erreur 401: Non autorisé');
                    throw new Error('Unauthorized');
                }
                console.error('Erreur HTTP:', response.status);
                throw new Error('Erreur lors de la récupération des tickets');
            }
            
            const data = await response.json();
            console.log('Données reçues du serveur:', data);
            
            // Mettre à jour la pagination
            totalPages = data.pagination.pages;
            updatePagination();
            
            // Afficher les tickets
            displayTickets(data.tickets);
            
            // Rafraîchir la vue Kanban si elle existe
            if (typeof window.refreshKanbanView === 'function') {
                window.refreshKanbanView();
            }
            
        } catch (error) {
            console.error('Erreur lors du chargement des tickets:', error);
            showNotification('Erreur lors du chargement des tickets', 'error');
            throw error;
        } finally {
            // Réinitialiser l'indicateur pour permettre les chargements futurs
            isTicketsLoading = false;
            console.log('Chargement des tickets terminé, indicateur réinitialisé');
        }
    }
    
    // Afficher la liste des tickets
    function displayTickets(tickets) {
        ticketsList.innerHTML = '';
        
        // Supprimer le compteur de résultats précédent s'il existe
        const existingResultCount = document.querySelector('.result-count');
        if (existingResultCount) {
            existingResultCount.remove();
        }
        
        // Créer un élément pour afficher le nombre de résultats
        const resultCount = document.createElement('div');
        resultCount.className = 'result-count';
        
        // Vérifier si des filtres sont appliqués
        const activeFilters = [];
        if (document.getElementById('status-filter').value) activeFilters.push(`Statut: ${statusTranslations[document.getElementById('status-filter').value] || document.getElementById('status-filter').value}`);
        if (document.getElementById('part-filter').value) activeFilters.push(`Type: ${partTypeTranslations[document.getElementById('part-filter').value] || document.getElementById('part-filter').value}`);
        if (document.getElementById('priority-filter').value) activeFilters.push(`Priorité: ${priorityTranslations[document.getElementById('priority-filter').value] || document.getElementById('priority-filter').value}`);
        if (document.getElementById('ticket-number-filter').value) activeFilters.push(`N° Ticket: ${document.getElementById('ticket-number-filter').value}`);
        if (document.getElementById('order-number-filter').value) activeFilters.push(`N° Commande: ${document.getElementById('order-number-filter').value}`);
        if (document.getElementById('client-firstname-filter').value) activeFilters.push(`Prénom: ${document.getElementById('client-firstname-filter').value}`);
        if (document.getElementById('client-name-filter').value) activeFilters.push(`Nom: ${document.getElementById('client-name-filter').value}`);
        if (document.getElementById('date-from').value || document.getElementById('date-to').value) {
            const dateFilter = [];
            if (document.getElementById('date-from').value) dateFilter.push(`Du: ${document.getElementById('date-from').value}`);
            if (document.getElementById('date-to').value) dateFilter.push(`Au: ${document.getElementById('date-to').value}`);
            activeFilters.push(`Dates: ${dateFilter.join(' ')}`);
        }
        if (document.getElementById('search-input').value) activeFilters.push(`Recherche: "${document.getElementById('search-input').value}"`);
        
        // Construire le message de résultats
        let resultMessage = `<strong>${tickets.length} ticket(s) trouvé(s)</strong>`;
        
        // Ajouter les filtres actifs au message si présents
        if (activeFilters.length > 0) {
            resultMessage += `<br><span class="active-filters">Filtres actifs: ${activeFilters.join(' | ')}</span>`;
        }
        
        resultCount.innerHTML = resultMessage;
        resultCount.style.margin = '15px 0';
        resultCount.style.padding = '10px';
        resultCount.style.backgroundColor = '#f8f9fa';
        resultCount.style.border = '1px solid #dee2e6';
        resultCount.style.borderRadius = '4px';
        
        // Insérer avant la table des tickets
        const ticketsTable = document.querySelector('.tickets-table');
        ticketsTable.parentNode.insertBefore(resultCount, ticketsTable);
        
        if (tickets.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="7" style="text-align: center;">Aucun ticket trouvé</td>';
            ticketsList.appendChild(emptyRow);
            return;
        }
        
        tickets.forEach(ticket => {
            const row = document.createElement('tr');
            row.className = 'ticket-row';
            row.setAttribute('data-ticket-id', ticket._id);
            row.setAttribute('data-status', ticket.currentStatus);
            row.setAttribute('data-priority', ticket.priority || 'moyen');
            row.setAttribute('data-date', ticket.createdAt);
            
            // Appliquer un style en fonction de la priorité
            if (ticket.priority) {
                switch(ticket.priority) {
                    case 'urgent':
                        row.classList.add('priority-urgent');
                        break;
                    case 'élevé':
                        row.classList.add('priority-high');
                        break;
                    case 'moyen':
                        row.classList.add('priority-medium');
                        break;
                    case 'faible':
                        row.classList.add('priority-low');
                        break;
                }
            }
            
            // Formater la date
            const createdAt = formatDate(ticket.createdAt);
            
            // Créer la cellule de priorité
            const priorityCell = document.createElement('td');
            const priorityBadge = document.createElement('span');
            priorityBadge.className = `priority-badge priority-${ticket.priority || 'moyen'}`;
            priorityBadge.textContent = priorityTranslations[ticket.priority] || priorityTranslations['moyen'];
            priorityCell.appendChild(priorityBadge);
            
            // Créer la cellule de statut avec badge
            const statusCell = document.createElement('td');
            const statusBadge = document.createElement('span');
            statusBadge.className = `status-badge status-${ticket.currentStatus}`;
            statusBadge.textContent = statusTranslations[ticket.currentStatus] || ticket.currentStatus;
            statusCell.appendChild(statusBadge);
            
            // Créer la cellule d'actions
            const actionsCell = document.createElement('td');
            const viewButton = document.createElement('button');
            viewButton.className = 'btn-view';
            viewButton.innerHTML = '<i class="fas fa-eye"></i>';
            viewButton.title = 'Voir les détails';
            viewButton.addEventListener('click', () => viewTicket(ticket._id));
            actionsCell.appendChild(viewButton);
            
            // Ajouter un bouton de suppression
            const deleteButton = document.createElement('button');
            deleteButton.className = 'btn-delete';
            deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
            deleteButton.title = 'Supprimer le ticket';
            deleteButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                deleteTicket(ticket._id, ticket.ticketNumber, event);
                return false;
            });
            actionsCell.appendChild(deleteButton);
            
            // Créer les cellules individuellement pour éviter d'écraser les attributs
            const tdTicketNumber = document.createElement('td');
            tdTicketNumber.textContent = ticket.ticketNumber;
            
            const tdClientName = document.createElement('td');
            tdClientName.textContent = `${ticket.clientInfo.firstName} ${ticket.clientInfo.lastName}`;
            
            const tdPartType = document.createElement('td');
            tdPartType.textContent = partTypeTranslations[ticket.partInfo.partType] || ticket.partInfo.partType;
            
            const tdCreatedAt = document.createElement('td');
            tdCreatedAt.textContent = createdAt;
            
            // Ajouter les cellules à la ligne
            row.appendChild(tdTicketNumber);
            row.appendChild(tdClientName);
            row.appendChild(tdPartType);
            row.appendChild(tdCreatedAt);
            row.appendChild(priorityCell);
            row.appendChild(statusCell);
            row.appendChild(actionsCell);
            
            ticketsList.appendChild(row);
        });
    }
    
    // Mettre à jour la pagination
    function updatePagination() {
        pagination.innerHTML = '';
        
        // Bouton précédent
        const prevButton = document.createElement('button');
        prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevButton.disabled = currentPage === 1;
        prevButton.addEventListener('click', () => {
            if (currentPage > 1) {
                loadTickets(currentPage - 1, collectFilters());
            }
        });
        pagination.appendChild(prevButton);
        
        // Pages
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);
        
        for (let i = startPage; i <= endPage; i++) {
            const pageButton = document.createElement('button');
            pageButton.textContent = i;
            if (i === currentPage) {
                pageButton.className = 'active';
            }
            pageButton.addEventListener('click', () => {
                loadTickets(i, collectFilters());
            });
            pagination.appendChild(pageButton);
        }
        
        // Bouton suivant
        const nextButton = document.createElement('button');
        nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextButton.disabled = currentPage === totalPages;
        nextButton.addEventListener('click', () => {
            if (currentPage < totalPages) {
                loadTickets(currentPage + 1, collectFilters());
            }
        });
        pagination.appendChild(nextButton);
    }
    
    // Voir les détails d'un ticket
    async function viewTicket(ticketId) {
        try {
            currentTicketId = ticketId;
            console.log('Récupération des détails du ticket ID:', ticketId);
            
            // Récupérer les détails du ticket
            const response = await fetch(`/api/admin/tickets/${ticketId}`, {
                headers: {
                    'Authorization': `Basic ${authToken}`
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized');
                }
                throw new Error('Erreur lors de la récupération des détails du ticket');
            }
            
            const data = await response.json();
            console.log('Données du ticket reçues:', data);
            
            const ticket = data.ticket;
            const statusHistory = data.statusHistory;
            
            // Vérifier si les données du ticket sont valides
            if (!ticket || typeof ticket !== 'object') {
                console.error('Données du ticket invalides:', ticket);
                alert('Erreur: Les données du ticket sont invalides ou manquantes.');
                return;
            }
            
            console.log('Ticket complet:', JSON.stringify(ticket));
            console.log('Statut actuel du ticket:', ticket.currentStatus);
            console.log('Historique des statuts:', statusHistory);
            
            console.log('Affichage des détails du ticket...');
            
            // Afficher les détails du ticket
            displayTicketDetails(ticket, statusHistory);
            
            // Afficher la vue détaillée
            console.log('Basculement vers la vue détaillée');
            
            // S'assurer que la dashboard est cachée et que la vue détaillée est visible
            const dashboardElement = document.querySelector('.admin-dashboard');
            if (!dashboardElement) {
                console.error('Element admin-dashboard introuvable');
            } else {
                dashboardElement.style.display = 'none';
                console.log('Dashboard cachée');
            }
            
            // Vérification de l'élément ticket-details
            if (!ticketDetails) {
                console.error('Element ticket-details introuvable');
            } else {
                // Forcer l'affichage
                ticketDetails.style.cssText = 'display: block !important; z-index: 9999; position: relative;';
                console.log('Style appliqué à ticket-details:', ticketDetails.style.cssText);
            }
            
            console.log('Vue détaillée affichée');
            
        } catch (error) {
            console.error('Erreur lors de la récupération des détails du ticket:', error);
            if (error.message === 'Unauthorized') {
                logout();
            }
        }
    }

    // Mettre à jour la pagination
    function updatePagination() {
        const pagination = document.getElementById('pagination');
        pagination.innerHTML = '';
        
        // Bouton précédent
        const prevButton = document.createElement('button');
        prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevButton.disabled = currentPage === 1;
        prevButton.addEventListener('click', () => {
            if (currentPage > 1) {
                loadTickets(currentPage - 1, collectFilters());
            }
        });
        pagination.appendChild(prevButton);
        
        // Boutons de page
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);
        
        for (let i = startPage; i <= endPage; i++) {
            const pageButton = document.createElement('button');
            pageButton.textContent = i;
            pageButton.className = i === currentPage ? 'active' : '';
            pageButton.addEventListener('click', () => {
                loadTickets(i, collectFilters());
            });
            pagination.appendChild(pageButton);
        }
        
        // Bouton suivant
        const nextButton = document.createElement('button');
        nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextButton.disabled = currentPage === totalPages;
        nextButton.addEventListener('click', () => {
            if (currentPage < totalPages) {
                loadTickets(currentPage + 1, collectFilters());
            }
        });
        pagination.appendChild(nextButton);
    }
    
    // Fonction pour afficher les détails d'un ticket
    function displayTicketDetails(ticket, statusHistory) {
        console.log('Début de displayTicketDetails', { ticket, statusHistory });
        
        try {
            // Mettre à jour le fil d'Ariane
            console.log('Mise à jour du fil d\'Ariane avec le numéro de ticket:', ticket.ticketNumber);
            const breadcrumbElement = document.getElementById('breadcrumb-ticket-number');
            if (!breadcrumbElement) {
                console.error('Element breadcrumb-ticket-number introuvable');
            } else {
                breadcrumbElement.textContent = ticket.ticketNumber;
            }
        
            // Informations générales
            console.log('Mise à jour des informations générales');
            const detailTicketNumberElement = document.getElementById('detail-ticket-number');
            if (!detailTicketNumberElement) {
                console.error('Element detail-ticket-number introuvable');
            } else {
                detailTicketNumberElement.textContent = ticket.ticketNumber;
            }
        
            // Afficher la priorité actuelle
            console.log('Mise à jour de la priorité');
            const priorityElement = document.getElementById('detail-ticket-priority');
            
            // Dictionnaire de traduction des priorités
            const priorityTranslations = {
                'eleve': 'Élevée',
                'moyen': 'Moyenne',
                'faible': 'Faible',
                'élevé': 'Élevée',
                'urgent': 'Urgente'
            };
            
            // Définir la priorité du ticket (ou par défaut)
            const ticketPriority = ticket.priority || 'moyen';
            console.log('Priorité du ticket:', ticketPriority);
            
            // Mise à jour de l'indicateur visible de priorité
            const visiblePriorityElement = document.getElementById('visible-current-priority');
            if (visiblePriorityElement) {
                const priorityText = priorityTranslations[ticketPriority] || ticketPriority;
                visiblePriorityElement.textContent = priorityText;
                // Appliquer la classe du badge de priorité
                visiblePriorityElement.className = `priority-badge priority-${ticketPriority}`;
                console.log('Indicateur de priorité mis à jour avec:', priorityText);
            } else {
                console.error('Element visible-current-priority introuvable');
            }
            
            // Mettre à jour l'élément de priorité régulière
            if (!priorityElement) {
                console.error('Element detail-ticket-priority introuvable');
            } else if (ticket.priority) {
                const priorityText = priorityTranslations[ticket.priority] || ticket.priority;
                priorityElement.textContent = `Priorité: ${priorityText}`;
                priorityElement.className = `priority-badge priority-${ticket.priority}`;
                priorityElement.style.display = 'inline-block';
            } else {
                priorityElement.textContent = 'Priorité: Moyenne';
                priorityElement.className = 'priority-badge priority-moyen';
                priorityElement.style.display = 'inline-block';
            }
            
            // Stocker la priorité actuelle dans l'élément caché
            const currentPriorityElement = document.getElementById('detail-ticket-current-priority');
            if (currentPriorityElement) {
                currentPriorityElement.textContent = ticketPriority;
                currentPriorityElement.setAttribute('data-priority', ticketPriority);
                console.log('Priorité stockée dans l\'\u00e9lément caché:', ticketPriority);
            } else {
                console.error('Element detail-ticket-current-priority introuvable');
            }
        
            // Informations client
            console.log('Mise à jour des informations client');
            try {
                const clientNameElement = document.getElementById('detail-client-name');
                if (!clientNameElement) {
                    console.error('Element detail-client-name introuvable');
                } else if (ticket.clientInfo && ticket.clientInfo.firstName && ticket.clientInfo.lastName) {
                    clientNameElement.textContent = `${ticket.clientInfo.firstName} ${ticket.clientInfo.lastName}`;
                }
                
                const clientEmailElement = document.getElementById('detail-client-email');
                if (!clientEmailElement) {
                    console.error('Element detail-client-email introuvable');
                } else if (ticket.clientInfo && ticket.clientInfo.email) {
                    clientEmailElement.textContent = ticket.clientInfo.email;
                }
                
                const clientPhoneElement = document.getElementById('detail-client-phone');
                if (!clientPhoneElement) {
                    console.error('Element detail-client-phone introuvable');
                } else if (ticket.clientInfo && ticket.clientInfo.phone) {
                    clientPhoneElement.textContent = ticket.clientInfo.phone;
                }
                
                const orderNumberElement = document.getElementById('detail-order-number');
                if (!orderNumberElement) {
                    console.error('Element detail-order-number introuvable');
                } else if (ticket.orderInfo && ticket.orderInfo.orderNumber) {
                    orderNumberElement.textContent = ticket.orderInfo.orderNumber;
                }
            } catch (error) {
                console.error('Erreur lors de la mise à jour des informations client:', error);
            }
        
            // Informations véhicule
            console.log('Mise à jour des informations véhicule');
            try {
                const vehicleVinElement = document.getElementById('detail-vehicle-vin');
                if (!vehicleVinElement) {
                    console.error('Element detail-vehicle-vin introuvable');
                } else {
                    vehicleVinElement.textContent = (ticket.vehicleInfo && ticket.vehicleInfo.vin) ? ticket.vehicleInfo.vin : 'Non spécifié';
                }
                
                const installationDateElement = document.getElementById('detail-installation-date');
                if (!installationDateElement) {
                    console.error('Element detail-installation-date introuvable');
                } else {
                    installationDateElement.textContent = (ticket.vehicleInfo && ticket.vehicleInfo.installationDate) ? formatDate(ticket.vehicleInfo.installationDate) : 'Non spécifié';
                }
            } catch (error) {
                console.error('Erreur lors de la mise à jour des informations véhicule:', error);
            }
        
            // Informations pièce et problème
            console.log('Mise à jour des informations pièce et problème');
            try {
                // Afficher le type de réclamation
                const claimTypeElement = document.getElementById('detail-claim-type');
                if (!claimTypeElement) {
                    console.error('Element detail-claim-type introuvable');
                } else {
                    // Traduction des types de réclamation
                    const claimTypeTranslations = {
                        'piece_defectueuse': 'Pièce défectueuse',
                        'probleme_livraison': 'Problème de livraison',
                        'erreur_reference': 'Erreur de référence',
                        'autre': 'Autre type de réclamation'
                    };
                    
                    const claimType = ticket.claimType || 'Non spécifié';
                    claimTypeElement.textContent = claimTypeTranslations[claimType] || claimType;
                    
                    // Afficher les informations spécifiques au type de réclamation
                    if (ticket.claimTypeData && ticket.claimType) {
                        console.log('Données spécifiques au type de réclamation:', ticket.claimTypeData);
                        
                        // Créer ou mettre à jour la section des données spécifiques
                        let specificDataHTML = '<div class="claim-specific-data"><h4>Détails spécifiques</h4><div class="info-grid">';
                        
                        switch(ticket.claimType) {
                            case 'piece_defectueuse':
                                // Déjà géré par les champs standards
                                break;
                            case 'probleme_livraison':
                                // Les champs numéro de suivi et transporteur ont été supprimés
                                if (ticket.claimTypeData.deliveryDate) specificDataHTML += `<div class="info-item"><label>Date de livraison</label><p>${formatDate(ticket.claimTypeData.deliveryDate)}</p></div>`;
                                if (ticket.claimTypeData.deliveryProblemType) specificDataHTML += `<div class="info-item"><label>Type de problème</label><p>${ticket.claimTypeData.deliveryProblemType}</p></div>`;
                                if (ticket.claimTypeData.deliveryProblemDescription) specificDataHTML += `<div class="info-item"><label>Description</label><p>${ticket.claimTypeData.deliveryProblemDescription}</p></div>`;
                                // Ajouter une remarque pour les tickets existants qui peuvent avoir ces anciennes données
                                if (ticket.claimTypeData.trackingNumber) specificDataHTML += `<div class="info-item"><label>N° de suivi (ancien)</label><p>${ticket.claimTypeData.trackingNumber}</p></div>`;
                                if (ticket.claimTypeData.carrier) specificDataHTML += `<div class="info-item"><label>Transporteur (ancien)</label><p>${ticket.claimTypeData.carrier}</p></div>`;
                                break;
                            case 'erreur_reference':
                                if (ticket.claimTypeData.receivedReference) specificDataHTML += `<div class="info-item"><label>Référence reçue</label><p>${ticket.claimTypeData.receivedReference}</p></div>`;
                                if (ticket.claimTypeData.expectedReference) specificDataHTML += `<div class="info-item"><label>Référence attendue</label><p>${ticket.claimTypeData.expectedReference}</p></div>`;
                                if (ticket.claimTypeData.compatibilityIssue) specificDataHTML += `<div class="info-item"><label>Problème de compatibilité</label><p>${ticket.claimTypeData.compatibilityIssue}</p></div>`;
                                if (ticket.claimTypeData.referenceErrorDescription) specificDataHTML += `<div class="info-item"><label>Description</label><p>${ticket.claimTypeData.referenceErrorDescription}</p></div>`;
                                break;
                            case 'autre':
                                if (ticket.claimTypeData.otherProblemType) specificDataHTML += `<div class="info-item"><label>Type de problème</label><p>${ticket.claimTypeData.otherProblemType}</p></div>`;
                                if (ticket.claimTypeData.otherProblemDescription) specificDataHTML += `<div class="info-item"><label>Description</label><p>${ticket.claimTypeData.otherProblemDescription}</p></div>`;
                                break;
                        }
                        
                        specificDataHTML += '</div></div>';
                        
                        // Ajouter les données spécifiques après les informations de la pièce
                        const partTabContent = document.getElementById('tab-part');
                        
                        // Vérifier si la section existe déjà
                        const existingSection = document.querySelector('.claim-specific-data');
                        if (existingSection) {
                            existingSection.outerHTML = specificDataHTML;
                        } else if (partTabContent) {
                            // Ajouter après la section principale
                            const ticketSection = partTabContent.querySelector('.ticket-section');
                            if (ticketSection) {
                                // Seulement ajouter s'il y a des données spécifiques à afficher
                                if (specificDataHTML.includes('<div class="info-item">')) {
                                    ticketSection.insertAdjacentHTML('beforeend', specificDataHTML);
                                }
                            }
                        }
                    }
                }
                
                const elementsToUpdate = [
                    { id: 'detail-part-type', value: () => (ticket.partInfo && ticket.partInfo.partType) ? (window.partTypeTranslations ? partTypeTranslations[ticket.partInfo.partType] || ticket.partInfo.partType : ticket.partInfo.partType) : 'Non spécifié' },
                    { id: 'detail-symptom', value: () => (ticket.partInfo && ticket.partInfo.symptom) ? ticket.partInfo.symptom : 'Non spécifié' },
                    { id: 'detail-failure-time', value: () => (ticket.partInfo && ticket.partInfo.failureTime) ? ticket.partInfo.failureTime : 'Non spécifié' },
                    { id: 'detail-error-codes', value: () => (ticket.partInfo && ticket.partInfo.errorCodes) ? ticket.partInfo.errorCodes : 'Non spécifié' },
                    { id: 'detail-pro-installation', value: () => (ticket.partInfo && ticket.partInfo.professionalInstallation !== undefined) ? (ticket.partInfo.professionalInstallation ? 'Oui' : 'Non') : 'Non spécifié' },
                    { id: 'detail-oil-filled', value: () => (ticket.partInfo && ticket.partInfo.oilFilled !== undefined) ? (ticket.partInfo.oilFilled ? 'Oui' : 'Non') : 'Non spécifié' },
                    { id: 'detail-oil-quantity', value: () => (ticket.partInfo && ticket.partInfo.oilQuantity) ? `${ticket.partInfo.oilQuantity} L` : 'Non spécifié' },
                    { id: 'detail-oil-reference', value: () => (ticket.partInfo && ticket.partInfo.oilReference) ? ticket.partInfo.oilReference : 'Non spécifié' },
                    { id: 'detail-new-parts', value: () => (ticket.partInfo && ticket.partInfo.newParts !== undefined) ? (ticket.partInfo.newParts ? 'Oui' : 'Non') : 'Non spécifié' },
                    { id: 'detail-parts-details', value: () => (ticket.partInfo && ticket.partInfo.newPartsDetails) ? ticket.partInfo.newPartsDetails : 'Non spécifié' }
                ];
                
                elementsToUpdate.forEach(item => {
                    const element = document.getElementById(item.id);
                    if (!element) {
                        console.error(`Element ${item.id} introuvable`);
                    } else {
                        try {
                            element.textContent = item.value();
                        } catch (error) {
                            console.error(`Erreur lors de la mise à jour de ${item.id}:`, error);
                            element.textContent = 'Erreur';
                        }
                    }
                });
            } catch (error) {
                console.error('Erreur lors de la mise à jour des informations pièce et problème:', error);
            }
        
            // Notes internes
            console.log('Mise à jour des notes internes');
            try {
                const notesElement = document.getElementById('internal-notes');
                if (!notesElement) {
                    console.error('Element internal-notes introuvable');
                } else if (ticket.internalNotes) {
                    notesElement.value = ticket.internalNotes;
                } else {
                    notesElement.value = '';
                }
                
                // Mise à jour explicite de l'indicateur de statut actuel
                updateCurrentStatusIndicator(ticket.currentStatus);
            } catch (error) {
                console.error('Erreur lors de la mise à jour des notes internes:', error);
            }
        
            // Documents
            console.log('Mise à jour des documents');
            try {
                const documentsList = document.getElementById('documents-list');
                if (!documentsList) {
                    console.error('Element documents-list introuvable');
                    return;
                }
                
                documentsList.innerHTML = '';
                
                if (ticket.documents && ticket.documents.length > 0) {
            // Regrouper les documents par type
            const documentsByType = {};
            
            // Initialiser les groupes de documents
            documentTypeOrder.forEach(type => {
                documentsByType[type] = [];
            });
            
            // Ajouter les documents à leurs groupes respectifs
            ticket.documents.forEach(doc => {
                const docType = doc.type || 'documents_autres';
                if (!documentsByType[docType]) {
                    documentsByType[docType] = [];
                }
                documentsByType[docType].push(doc);
            });
            
            // Afficher les documents par groupe dans l'ordre défini
            documentTypeOrder.forEach(type => {
                const docs = documentsByType[type];
                if (docs && docs.length > 0) {
                    // Créer un en-tête pour le groupe de documents
                    const groupHeader = document.createElement('div');
                    groupHeader.className = 'document-group-header';
                    groupHeader.innerHTML = `
                        <h4>
                            <i class="fas ${documentTypeIcons[type] || 'fa-file'}"></i>
                            ${documentTypeTranslations[type] || type}
                            <span class="document-count">(${docs.length})</span>
                        </h4>
                    `;
                    documentsList.appendChild(groupHeader);
                    
                    // Créer un conteneur pour les documents de ce groupe
                    const groupContainer = document.createElement('div');
                    groupContainer.className = 'document-group';
                    
                    // Ajouter chaque document au groupe
                    docs.forEach(doc => {
                        const docItem = document.createElement('div');
                        docItem.className = 'document-item';
                        
                        const docIcon = document.createElement('div');
                        docIcon.className = 'document-icon';
                        docIcon.innerHTML = `<i class="fas ${documentTypeIcons[doc.type] || 'fa-file'}"></i>`;
                        
                        const docName = document.createElement('div');
                        docName.className = 'document-name';
                        docName.textContent = doc.fileName;
                        
                        const docActions = document.createElement('div');
                        docActions.className = 'document-actions';
                        
                        // Vérifier si le chemin du fichier est défini
                        let filePath = '';
                        if (doc.filePath) {
                            // Extraire uniquement la partie relative du chemin (après 'uploads/')
                            filePath = doc.filePath.includes('uploads/') 
                                ? '/uploads/' + doc.filePath.split('uploads/')[1] 
                                : '/uploads/' + doc.filePath.split('/').pop();
                        } else if (doc.fileId) {
                            // Si filePath n'est pas défini mais fileId oui, utiliser fileId
                            filePath = `/uploads/${doc.fileId}`;
                        }
                        
                        // Créer un conteneur pour la prévisualisation
                        const docPreview = document.createElement('div');
                        docPreview.className = 'document-preview';
                        
                        // Déterminer le type de fichier pour la prévisualisation
                        const fileExtension = doc.fileName ? doc.fileName.split('.').pop().toLowerCase() : '';
                        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExtension);
                        const isPDF = fileExtension === 'pdf';
                        
                        if (filePath && isImage) {
                            // Prévisualisation d'image
                            docPreview.innerHTML = `<img src="${filePath}" alt="${doc.fileName}" class="document-thumbnail">`;
                        } else if (filePath && isPDF) {
                            // Icône PDF avec miniature
                            docPreview.innerHTML = `
                                <div class="pdf-preview">
                                    <i class="fas fa-file-pdf"></i>
                                    <span>PDF</span>
                                </div>
                            `;
                        } else {
                            // Icône par défaut pour les autres types de fichiers
                            docPreview.innerHTML = `<i class="fas ${documentTypeIcons[doc.type] || 'fa-file'} document-icon-large"></i>`;
                        }
                        
                        // Ajouter les actions (liens)
                        if (filePath) {
                            docActions.innerHTML = `<a href="${filePath}" target="_blank" class="btn-view-doc">Voir</a>`;
                        } else {
                            // Si ni filePath ni fileId ne sont définis, désactiver le lien
                            docActions.innerHTML = `<span class="disabled-link" title="Fichier non disponible">Voir</span>`;
                        }
                        
                        docItem.appendChild(docPreview);
                        docItem.appendChild(docName);
                        docItem.appendChild(docActions);
                        
                        groupContainer.appendChild(docItem);
                    });
                    
                    documentsList.appendChild(groupContainer);
                }
            });
                } else {
                    documentsList.innerHTML = '<p>Aucun document joint</p>';
                }
            } catch (error) {
                console.error('Erreur lors de la mise à jour des documents:', error);
            }
        
            // Historique des statuts
            console.log('Mise à jour de l\'historique des statuts');
            try {
                const statusTimeline = document.getElementById('detail-status-timeline');
                if (!statusTimeline) {
                    console.error('Element detail-status-timeline introuvable');
                    return;
                }
                
                statusTimeline.innerHTML = '';
                
                if (statusHistory && statusHistory.length > 0) {
            statusHistory.forEach((status, index) => {
                const statusItem = document.createElement('div');
                statusItem.className = 'status-item';
                if (index === 0) statusItem.classList.add('active');
                
                const statusDot = document.createElement('div');
                statusDot.className = 'status-dot';
                const icon = document.createElement('i');
                icon.className = `fas ${statusIcons[status.status] || 'fa-circle-info'}`;
                statusDot.appendChild(icon);
                
                const statusContent = document.createElement('div');
                statusContent.className = 'status-content';
                
                const statusDate = document.createElement('div');
                statusDate.className = 'status-date';
                statusDate.textContent = formatDate(status.updatedAt);
                
                const statusTitle = document.createElement('div');
                statusTitle.className = 'status-title';
                statusTitle.textContent = statusTranslations[status.status] || status.status;
                
                const statusDescription = document.createElement('div');
                statusDescription.className = 'status-description';
                statusDescription.textContent = status.comment || 'Mise à jour du statut';
                
                // Ajouter des informations supplémentaires si demandées
                if (status.additionalInfoRequested) {
                    const additionalInfo = document.createElement('div');
                    additionalInfo.className = 'additional-info';
                    additionalInfo.innerHTML = `<strong>Informations demandées:</strong> ${status.additionalInfoRequested}`;
                    statusContent.appendChild(additionalInfo);
                }
                
                statusContent.appendChild(statusDate);
                statusContent.appendChild(statusTitle);
                statusContent.appendChild(statusDescription);
                
                statusItem.appendChild(statusDot);
                statusItem.appendChild(statusContent);
                
                statusTimeline.appendChild(statusItem);
            });
                } else {
                    statusTimeline.innerHTML = '<p>Aucun historique de statut disponible</p>';
                }
                
                // Réinitialiser le formulaire de mise à jour de statut
                const form = document.getElementById('update-status-form');
                if (form) {
                    form.reset();
                    console.log('Formulaire de mise à jour du statut réinitialisé');
                } else {
                    console.error('Formulaire de mise à jour du statut non trouvé lors de la réinitialisation');
                }
                
                console.log('Affichage des détails du ticket terminé');
                // Les gestionnaires d'événements sont déjà configurés via la délégation d'événements
            } catch (error) {
                console.error('Erreur lors de la mise à jour de l\'historique des statuts:', error);
            }
        } catch (error) {
            console.error('Erreur globale dans displayTicketDetails:', error);
            alert('Erreur lors de l\'affichage des détails du ticket. Veuillez consulter la console pour plus d\'informations.');
        }
    }
    
    // Mettre à jour le statut d'un ticket
    async function updateTicketStatus(ticketId, status, comment, additionalInfoRequested, clientNotified, priority) {
        try {
            const response = await fetch(`/api/admin/tickets/${ticketId}/status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${authToken}`
                },
                body: JSON.stringify({
                    status,
                    comment,
                    additionalInfoRequested,
                    clientNotified,
                    priority,
                    updatedBy: 'admin'
                })
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized');
                }
                throw new Error('Erreur lors de la mise à jour du statut');
            }
            
            // Recharger les détails du ticket
            viewTicket(ticketId);
            
            // Rafraîchir la vue Kanban si elle existe
            if (typeof window.refreshKanbanView === 'function') {
                window.refreshKanbanView();
            }
            
        } catch (error) {
            console.error('Erreur lors de la mise à jour du statut:', error);
            if (error.message === 'Unauthorized') {
                logout();
            }
            alert('Une erreur est survenue lors de la mise à jour du statut');
        }
    }
    
    // Enregistrer les notes internes
    async function saveInternalNotes(ticketId, notes) {
        try {
            const response = await fetch(`/api/admin/tickets/${ticketId}/notes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${authToken}`
                },
                body: JSON.stringify({
                    notes
                })
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized');
                }
                throw new Error('Erreur lors de l\'enregistrement des notes');
            }
            
            alert('Notes enregistrées avec succès');
            
        } catch (error) {
            console.error('Erreur lors de l\'enregistrement des notes:', error);
            if (error.message === 'Unauthorized') {
                logout();
            }
            alert('Une erreur est survenue lors de l\'enregistrement des notes');
        }
    }
    
    // Événements
    
    // Connexion
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        login(username, password);
    });
    
    // Déconnexion
    logoutBtn.addEventListener('click', () => {
        logout();
    });
    
    // Initialiser le système d'onglets
    initTabsSystem();
    
    // Retour à la liste
    document.getElementById('back-to-list').addEventListener('click', () => {
        ticketDetails.style.display = 'none';
        document.querySelector('.admin-dashboard').style.display = 'block';
    });
    
    document.getElementById('breadcrumb-tickets').addEventListener('click', (e) => {
        e.preventDefault();
        ticketDetails.style.display = 'none';
        document.querySelector('.admin-dashboard').style.display = 'block';
    });
    
    // Gestionnaire d'événement pour le bouton de suppression dans la vue détaillée
    document.getElementById('delete-ticket-detail').addEventListener('click', (event) => {
        const ticketId = currentTicketId;
        const ticketNumber = document.getElementById('detail-ticket-number').textContent;
        
        if (confirm(`Êtes-vous sûr de vouloir supprimer le ticket ${ticketNumber} ? Cette action est irréversible.`)) {
            deleteTicket(ticketId, ticketNumber, event);
            // Retourner à la liste après la suppression
            ticketDetails.style.display = 'none';
            document.querySelector('.admin-dashboard').style.display = 'block';
        }
    });
    
    // Fonction pour collecter tous les filtres
    function collectFilters() {
        const ticketNumberValue = document.getElementById('ticket-number-filter').value;
        const orderNumberValue = document.getElementById('order-number-filter').value;
        const clientFirstNameValue = document.getElementById('client-firstname-filter').value;
        const clientNameValue = document.getElementById('client-name-filter').value;
        const dateFromValue = document.getElementById('date-from').value;
        const dateToValue = document.getElementById('date-to').value;
        const priorityValue = document.getElementById('priority-filter')?.value || '';
        
        console.log('Filtres collectés:');
        console.log('- Statut:', statusFilter.value);
        console.log('- Type de pièce:', partFilter.value);
        console.log('- N° Ticket:', ticketNumberValue);
        console.log('- N° Commande:', orderNumberValue);
        console.log('- Prénom client:', clientFirstNameValue);
        console.log('- Nom client:', clientNameValue);
        console.log('- Date du:', dateFromValue);
        console.log('- Date au:', dateToValue);
        console.log('- Priorité:', priorityValue);
        
        return {
            search: searchInput.value,
            status: statusFilter.value,
            partType: partFilter.value,
            ticketNumber: ticketNumberValue,
            orderNumber: orderNumberValue,
            clientFirstName: clientFirstNameValue,
            clientName: clientNameValue,
            dateFrom: dateFromValue,
            dateTo: dateToValue,
            priority: priorityValue
        };
    }



    // Recherche
    searchBtn.addEventListener('click', () => {
        loadTickets(1, collectFilters());
    });
    
    // Appliquer les filtres
    const applyFiltersBtn = document.getElementById('apply-filters');
    if (applyFiltersBtn) {
        console.log('Bouton "Appliquer les filtres" trouvé, ajout du gestionnaire d\'événements');
        applyFiltersBtn.addEventListener('click', (e) => {
            console.log('Bouton "Appliquer les filtres" cliqué');
            e.preventDefault(); // Empêcher le comportement par défaut
            loadTickets(1, collectFilters());
        });
    } else {
        console.error('Bouton "Appliquer les filtres" non trouvé dans le DOM');
    }
    
    // Effacer les filtres
    const clearFiltersBtn = document.getElementById('clear-filters');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Réinitialiser tous les filtres
            document.getElementById('status-filter').value = '';
            document.getElementById('part-filter').value = '';
            document.getElementById('priority-filter').value = '';
            document.getElementById('ticket-number-filter').value = '';
            document.getElementById('order-number-filter').value = '';
            document.getElementById('client-firstname-filter').value = '';
            document.getElementById('client-name-filter').value = '';
            document.getElementById('date-from').value = '';
            document.getElementById('date-to').value = '';
            document.getElementById('search-input').value = '';
            
            // Recharger les tickets sans filtres
            loadTickets(1);
            
            // Prévisualiser les résultats après réinitialisation
            previewFilterResults();
        });
    } else {
        console.error('Bouton "Effacer les filtres" non trouvé dans le DOM');
    }
    
    // Ajouter des écouteurs d'événements pour la prévisualisation en temps réel
    const filterElements = [
        'status-filter', 'part-filter', 'priority-filter', 'ticket-number-filter',
        'order-number-filter', 'client-firstname-filter', 'client-name-filter',
        'date-from', 'date-to', 'search-input'
    ];
    
    // Fonction pour ajouter un délai avant d'exécuter la prévisualisation (debounce)
    let previewTimeout;
    const debouncedPreview = () => {
        clearTimeout(previewTimeout);
        previewTimeout = setTimeout(() => {
            previewFilterResults();
        }, 300); // Attendre 300ms après la dernière modification
    };
    
    // Ajouter les écouteurs à tous les éléments de filtre
    filterElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            if (element.tagName === 'SELECT') {
                element.addEventListener('change', debouncedPreview);
            } else {
                element.addEventListener('input', debouncedPreview);
                element.addEventListener('keyup', debouncedPreview);
            }
        }
    });
    
    // Ajouter des gestionnaires d'événements pour les touches Entrée sur les champs de recherche
    document.getElementById('ticket-number-filter').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadTickets(1, collectFilters());
        }
    });
    
    document.getElementById('order-number-filter').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadTickets(1, collectFilters());
        }
    });
    
    document.getElementById('client-name-filter').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadTickets(1, collectFilters());
        }
    });
    
    // Réinitialiser les filtres
    const resetFiltersButton = document.getElementById('clear-filters');
    if (resetFiltersButton) {
        resetFiltersButton.addEventListener('click', () => {
        // Réinitialiser tous les champs de filtres
        searchInput.value = '';
        statusFilter.value = '';
        partFilter.value = '';
        document.getElementById('ticket-number-filter').value = '';
        document.getElementById('order-number-filter').value = '';
        document.getElementById('client-name-filter').value = '';
        document.getElementById('date-from').value = '';
        document.getElementById('date-to').value = '';
        
        // Recharger les tickets sans filtres
        loadTickets(1, {});
        });
    }
    
    // Recherche avec touche Entrée
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadTickets(1, collectFilters());
        }
    });
    
    // Recherche avancée avec touche Entrée pour les autres champs
    const filterInputs = [
        document.getElementById('ticket-number-filter'),
        document.getElementById('order-number-filter'),
        document.getElementById('client-name-filter')
    ];
    
    filterInputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                loadTickets(1, collectFilters());
            }
        });
    });
    
    // Utiliser une approche par délégation d'événements pour le formulaire et les boutons
    // Cette méthode est plus robuste car elle fonctionne même si les éléments ne sont pas encore
    // dans le DOM au moment où le code est exécuté
    
    // Gestionnaire pour le changement de statut (afficher/masquer les infos complémentaires)
    document.addEventListener('change', function(e) {
        // Si l'élément qui a changé est le sélecteur de statut
        if (e.target && e.target.id === 'new-status') {
            console.log('Changement détecté sur le sélecteur de statut:', e.target.value);
            const additionalInfoGroup = document.getElementById('additional-info-group');
            if (additionalInfoGroup) {
                additionalInfoGroup.style.display = 
                    e.target.value === 'info_complementaire' ? 'block' : 'none';
            }
        }
    });
    
    // Gestionnaire pour la soumission du formulaire de mise à jour du statut
    document.addEventListener('submit', function(e) {
        // Si l'élément qui a été soumis est le formulaire de mise à jour du statut
        if (e.target && e.target.id === 'update-status-form') {
            e.preventDefault();
            console.log('Soumission du formulaire de mise à jour du statut détectée');
            
            const statusValue = document.getElementById('new-status')?.value;
            const comment = document.getElementById('status-comment')?.value || '';
            const additionalInfo = document.getElementById('additional-info')?.value || '';
            const notifyClient = document.getElementById('notify-client')?.checked || false;
            
            // Gestion de la priorité : si vide, on utilise la priorité actuelle
            let priority = document.getElementById('ticket-priority')?.value;
            console.log('Valeur sélectionnée dans le menu priorité:', priority);
            
            if (!priority) {
                console.log('Option "Conserver la priorité actuelle" sélectionnée, recherche de la priorité actuelle...');
                
                // Essayer différentes approches pour récupérer la priorité actuelle
                
                // Approche 1: Récupérer à partir de l'élément caché
                const currentPriorityElement = document.getElementById('detail-ticket-current-priority');
                console.log('Elément de priorité caché trouvé:', currentPriorityElement ? 'Oui' : 'Non');
                
                if (currentPriorityElement && currentPriorityElement.getAttribute('data-priority')) {
                    priority = currentPriorityElement.getAttribute('data-priority');
                    console.log('Priorité actuelle récupérée depuis data-priority:', priority);
                } else {
                    // Approche 2: Récupérer via l'élément d'affichage de la priorité
                    const displayPriorityElement = document.getElementById('detail-ticket-priority');
                    
                    if (displayPriorityElement && displayPriorityElement.className) {
                        // Extraire la priorité à partir de la classe CSS (priority-XXX)
                        const priorityClass = displayPriorityElement.className.split(' ')
                            .find(cls => cls.startsWith('priority-') && cls !== 'priority-badge');
                            
                        if (priorityClass) {
                            priority = priorityClass.replace('priority-', '');
                            console.log('Priorité récupérée depuis la classe CSS:', priority);
                        }
                    }
                    
                    if (!priority) {
                        // Approche 3: Méthode de secours - récupérer la priorité via API
                        console.log('Impossible de récupérer la priorité localement, tentative via API');
                        
                        // Nous utilisons une approche avec Promise pour pouvoir attendre la réponse
                        return new Promise((resolve, reject) => {
                            fetch(`/api/admin/tickets/${currentTicketId}`, {
                                headers: {
                                    'Authorization': `Basic ${authToken}`
                                }
                            })
                            .then(response => response.json())
                            .then(data => {
                                if (data.ticket && data.ticket.priority) {
                                    const apiPriority = data.ticket.priority;
                                    console.log('Priorité récupérée depuis API:', apiPriority);
                                    
                                    // Maintenant on peut mettre à jour avec les bonnes infos
                                    updateTicketStatus(
                                        currentTicketId,
                                        statusValue,
                                        comment,
                                        statusValue === 'info_complementaire' ? additionalInfo : '',
                                        notifyClient,
                                        apiPriority
                                    );
                                    resolve();
                                } else {
                                    console.error('La priorité n\'existe pas dans les données du ticket:', data);
                                    // On utilise une valeur par défaut
                                    updateTicketStatus(
                                        currentTicketId,
                                        statusValue,
                                        comment,
                                        statusValue === 'info_complementaire' ? additionalInfo : '',
                                        notifyClient,
                                        'moyen'
                                    );
                                    resolve();
                                }
                            })
                            .catch(error => {
                                console.error('Erreur lors de la récupération de la priorité:', error);
                                // On utilise une valeur par défaut en cas d'erreur
                                updateTicketStatus(
                                    currentTicketId,
                                    statusValue,
                                    comment,
                                    statusValue === 'info_complementaire' ? additionalInfo : '',
                                    notifyClient,
                                    'moyen'
                                );
                                resolve();
                            });
                        });
                    }
                }
            }
            
            if (!statusValue) {
                alert('Veuillez sélectionner un statut');
                return;
            }
            
            // Vérifions si nous avons trouvé une priorité valide
            if (!priority && !statusValue.startsWith('same_')) {
                // Si la priorité est toujours indéfinie après nos tentatives, utilisons la valeur par défaut
                priority = 'moyen';
                console.log('Utilisation de la priorité par défaut:', priority);
            }
            
            // Si "Conserver le même statut" est sélectionné, récupérer le statut actuel
            if (statusValue === 'same_status') {
                console.log('Option "Conserver le même statut" sélectionnée');
                
                // Récupérer le statut actuel à partir de l'élément dédié
                const currentStatusElement = document.getElementById('detail-ticket-status');
                
                if (currentStatusElement && currentStatusElement.getAttribute('data-status')) {
                    const currentStatus = currentStatusElement.getAttribute('data-status');
                    console.log('Statut actuel récupéré:', currentStatus);
                    
                    // Utiliser le statut actuel pour la mise à jour
                    updateTicketStatus(
                        currentTicketId,
                        currentStatus,
                        comment,
                        currentStatus === 'info_complementaire' ? additionalInfo : '',
                        notifyClient,
                        priority
                    );
                } else {
                    console.log('Statut actuel non disponible dans l\'\u00e9lément HTML, récupération via API');
                    
                    // Faire un appel API pour récupérer le statut actuel du ticket
                    fetch(`/api/admin/tickets/${currentTicketId}`, {
                        headers: {
                            'Authorization': `Basic ${authToken}`
                        }
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.ticket && data.ticket.currentStatus) {
                            const apiStatus = data.ticket.currentStatus;
                            console.log('Statut actuel récupéré depuis API:', apiStatus);
                            
                            updateTicketStatus(
                                currentTicketId,
                                apiStatus,
                                comment,
                                apiStatus === 'info_complementaire' ? additionalInfo : '',
                                notifyClient,
                                priority
                            );
                        } else {
                            alert('Impossible de récupérer le statut actuel. Veuillez choisir un statut spécifique.');
                            console.error('Données du ticket invalides ou statut manquant:', data);
                        }
                    })
                    .catch(error => {
                        alert('Erreur lors de la récupération du statut actuel. Veuillez réessayer.');
                        console.error('Erreur lors de la récupération du statut:', error);
                    });
                }
            } else {
                // Utiliser le statut sélectionné pour la mise à jour
                updateTicketStatus(
                    currentTicketId,
                    statusValue,
                    comment,
                    statusValue === 'info_complementaire' ? additionalInfo : '',
                    notifyClient,
                    priority
                );
            }
        }
    });
    
    // Gestionnaire pour l'enregistrement des notes internes
    document.addEventListener('click', function(e) {
        // Si l'élément cliqué est le bouton d'enregistrement des notes
        if (e.target && (e.target.id === 'save-notes' || e.target.closest('#save-notes'))) {
            console.log('Clic sur le bouton d\'enregistrement des notes détecté');
            const notes = document.getElementById('internal-notes')?.value || '';
            saveInternalNotes(currentTicketId, notes);
        }
    });
    
    // La gestion des événements est maintenant configurée via la délégation d'événements
    // ce qui permet d'attacher les handlers même aux éléments qui ne sont pas encore créés
    
    // Initialisation
    checkAuth();
});
