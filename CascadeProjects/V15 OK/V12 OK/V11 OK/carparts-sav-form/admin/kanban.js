// Fonctionnalités pour la vue Kanban
document.addEventListener('DOMContentLoaded', () => {
    // Éléments DOM pour la vue Kanban
    const listViewBtn = document.getElementById('list-view-btn');
    const kanbanViewBtn = document.getElementById('kanban-view-btn');
    const listView = document.getElementById('list-view');
    const kanbanView = document.getElementById('kanban-view');
    const kanbanBoard = document.querySelector('.kanban-board');
    
    // Statuts disponibles pour les colonnes Kanban
    const availableStatuses = [
        { id: 'nouveau', label: 'Nouveau' },
        { id: 'en_analyse', label: 'En analyse' },
        { id: 'info_complementaire', label: 'Info complémentaire' },
        { id: 'validé', label: 'Validé' },
        { id: 'refusé', label: 'Refusé' },
        { id: 'en_cours_traitement', label: 'En traitement' },
        { id: 'expédié', label: 'Expédié' },
        { id: 'clôturé', label: 'Clôturé' }
    ];
    
    // Variable pour stocker les tickets actuels
    let currentTickets = [];
    
    // Basculer entre les vues Liste et Kanban
    listViewBtn.addEventListener('click', () => {
        listViewBtn.classList.add('active');
        kanbanViewBtn.classList.remove('active');
        listView.style.display = 'block';
        kanbanView.style.display = 'none';
    });
    
    kanbanViewBtn.addEventListener('click', () => {
        kanbanViewBtn.classList.add('active');
        listViewBtn.classList.remove('active');
        kanbanView.style.display = 'block';
        listView.style.display = 'none';
        
        // Charger les tickets pour la vue Kanban si ce n'est pas déjà fait
        if (kanbanBoard.children.length === 0) {
            initKanbanBoard();
        }
    });
    
    // Initialiser le tableau Kanban
    function initKanbanBoard() {
        // Créer les colonnes pour chaque statut
        kanbanBoard.innerHTML = '';
        
        availableStatuses.forEach(status => {
            const column = createKanbanColumn(status);
            kanbanBoard.appendChild(column);
        });
        
        // Charger tous les tickets pour la vue Kanban
        loadAllTicketsForKanban();
    }
    
    // Créer une colonne Kanban
    function createKanbanColumn(status) {
        const column = document.createElement('div');
        column.className = `kanban-column ${status.id}`;
        column.dataset.status = status.id;
        
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        header.innerHTML = `
            <h4>${status.label} <span class="count">0</span></h4>
        `;
        
        const body = document.createElement('div');
        body.className = 'kanban-column-body';
        body.dataset.status = status.id;
        
        // Note: Fonctionnalité de glisser-déposer désactivée
        
        column.appendChild(header);
        column.appendChild(body);
        
        return column;
    }
    
    // Charger tous les tickets pour la vue Kanban
    async function loadAllTicketsForKanban() {
        try {
            // Récupérer tous les tickets sans pagination pour la vue Kanban
            const response = await fetch('/api/admin/tickets?limit=1000', {
                headers: {
                    'Authorization': `Basic ${window.authToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des tickets');
            }
            
            const data = await response.json();
            currentTickets = data.tickets;
            
            // Distribuer les tickets dans les colonnes appropriées
            distributeTicketsToColumns(currentTickets);
            
        } catch (error) {
            console.error('Erreur lors du chargement des tickets pour Kanban:', error);
            window.showNotification('Erreur lors du chargement des tickets', 'error');
        }
    }
    
    // Distribuer les tickets dans les colonnes appropriées
    function distributeTicketsToColumns(tickets) {
        // Réinitialiser les compteurs
        const counters = {};
        availableStatuses.forEach(status => {
            counters[status.id] = 0;
        });
        
        // Distribuer les tickets
        tickets.forEach(ticket => {
            const status = ticket.currentStatus;
            const column = document.querySelector(`.kanban-column-body[data-status="${status}"]`);
            
            if (column) {
                const card = createKanbanCard(ticket);
                column.appendChild(card);
                counters[status]++;
            }
        });
        
        // Mettre à jour les compteurs
        availableStatuses.forEach(status => {
            const counter = document.querySelector(`.kanban-column.${status.id} .count`);
            if (counter) {
                counter.textContent = counters[status.id];
            }
        });
    }
    
    // Créer une carte Kanban pour un ticket
    function createKanbanCard(ticket) {
        const card = document.createElement('div');
        card.className = 'kanban-card';
        // Désactiver le glisser-déposer
        card.draggable = false;
        card.dataset.id = ticket._id;
        card.dataset.ticketId = ticket._id;
        card.dataset.status = ticket.currentStatus;
        
        // Formater la date
        const createdAt = window.formatDate(ticket.createdAt);
        
        // Déterminer la classe de priorité
        const priorityClass = ticket.priority || 'moyen';
        const priorityLabel = window.priorityTranslations[ticket.priority] || window.priorityTranslations['moyen'];
        
        // Déterminer le type de pièce
        const partType = window.partTypeTranslations[ticket.partInfo?.partType] || 'Non spécifié';
        
        card.innerHTML = `
            <div class="kanban-card-header">
                <div class="kanban-card-title">#${ticket.ticketNumber}</div>
                <div class="kanban-card-priority ${priorityClass}">${priorityLabel}</div>
            </div>
            <div class="kanban-card-content">
                <div>${ticket.clientInfo.firstName} ${ticket.clientInfo.lastName}</div>
                <div>${partType}</div>
            </div>
            <div class="kanban-card-footer">
                <div class="kanban-card-date">
                    <i class="far fa-clock"></i> ${createdAt}
                </div>
                <div class="kanban-card-actions">
                    <button class="view-ticket-btn" title="Voir les détails">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="delete-ticket-btn" title="Supprimer le ticket">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        
        // Ajouter l'événement pour voir les détails du ticket
        card.querySelector('.view-ticket-btn').addEventListener('click', () => {
            window.viewTicket(ticket._id);
        });
        
        // Ajouter l'événement pour supprimer le ticket
        card.querySelector('.delete-ticket-btn').addEventListener('click', () => {
            window.deleteTicket(ticket._id, ticket.ticketNumber);
        });
        
        return card;
    }
    
    // Fonction pour rafraîchir la vue Kanban
    window.refreshKanbanView = function() {
        if (kanbanView.style.display !== 'none') {
            initKanbanBoard();
        }
    };
});
