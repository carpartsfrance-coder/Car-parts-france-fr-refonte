/**
 * Script pour s'assurer que la section utilisateurs est visible
 */

// S'exécuter une fois le DOM chargé
document.addEventListener('DOMContentLoaded', function() {
    
    // Cibler spécifiquement le lien de navigation vers les utilisateurs
    const usersLink = document.querySelector('a[href="#users"]');
    
    if (usersLink) {
        // Remplacer l'événement click par défaut
        usersLink.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Activer visuellement l'onglet utilisateurs
            document.querySelectorAll('.horizontal-nav li').forEach(item => {
                item.classList.remove('active');
            });
            usersLink.parentElement.classList.add('active');
            
            // Masquer toutes les autres sections
            document.querySelectorAll('.admin-main > div:not(.admin-dashboard), .dashboard-layout > div:not(.filters-sidebar), #kanban-container, .section:not(#users)').forEach(section => {
                section.style.display = 'none';
            });
            
            // Assurer que le dashboard est visible
            document.getElementById('admin-dashboard').style.display = 'block';
            
            // Trouver la section utilisateurs
            const usersSection = document.getElementById('users');
            
            if (usersSection) {
                // Rendre la section ultra-visible
                usersSection.style.display = 'block';
                usersSection.style.visibility = 'visible';
                usersSection.style.position = 'relative';
                usersSection.style.zIndex = '9999';
                usersSection.style.border = '4px solid red';
                usersSection.style.padding = '20px';
                usersSection.style.backgroundColor = '#fff';
                usersSection.style.marginTop = '20px';
                
                // Faire défiler vers la section utilisateurs
                setTimeout(() => {
                    usersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    console.log("Défilement vers la section utilisateurs...");
                    
                    // Charger les utilisateurs via l'API
                    if (typeof loadUsers === 'function') {
                        loadUsers();
                    }
                }, 300);
            }
        });
    }
    
    // Vérifier si nous sommes sur la page utilisateurs via le hash
    if (window.location.hash === '#users') {
        // Simuler un clic sur le lien utilisateurs
        if (usersLink) {
            usersLink.click();
        }
    }
});
