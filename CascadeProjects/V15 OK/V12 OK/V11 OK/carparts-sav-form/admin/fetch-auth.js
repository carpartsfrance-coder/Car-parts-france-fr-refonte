/**
 * Script pour ajouter automatiquement l'authentification aux requêtes fetch
 */

// Intercepter et modifier la méthode fetch originale
const originalFetch = window.fetch;

// Remplacer fetch par notre version personnalisée
window.fetch = function(url, options = {}) {
    // Récupérer le token depuis localStorage
    const token = localStorage.getItem('authToken');
    
    // Si un token existe, l'ajouter aux en-têtes de la requête
    if (token) {
        // Initialiser les options si elles n'existent pas
        options = options || {};
        // Initialiser les en-têtes si ils n'existent pas
        options.headers = options.headers || {};
        
        // Ajouter l'en-tête d'autorisation avec le token JWT
        options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Appeler la méthode fetch originale avec les options modifiées
    return originalFetch(url, options).then(response => {
        // Si la réponse est 401 (non autorisé), rediriger vers la page de connexion
        if (response.status === 401) {
            console.log('Session expirée ou token invalide, redirection vers la page de connexion');
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            localStorage.removeItem('userName');
            window.location.href = '/admin/login.html';
            return Promise.reject(new Error('Non autorisé'));
        }
        return response;
    });
};

// Afficher un message dans la console pour confirmer que le script est chargé
console.log('✅ Interception fetch pour authentification JWT activée');
