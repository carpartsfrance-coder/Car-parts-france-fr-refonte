// Script pour corriger les valeurs booléennes d'un ticket spécifique
const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:3000/api/admin/tickets';
const TICKET_NUMBER = 'CPF-250726-7269';
const ADMIN_TOKEN = 'votre_token_admin'; // À remplacer par votre token d'admin

// Fonction pour récupérer l'ID du ticket à partir de son numéro
async function getTicketIdByNumber(ticketNumber) {
  try {
    // Récupérer tous les tickets
    const response = await axios.get(`${API_URL}`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      }
    });
    
    if (response.data.success) {
      // Trouver le ticket avec le numéro spécifié
      const ticket = response.data.tickets.find(t => t.ticketNumber === ticketNumber);
      
      if (ticket) {
        return ticket._id;
      } else {
        console.error(`Ticket ${ticketNumber} non trouvé`);
        return null;
      }
    } else {
      console.error('Erreur lors de la récupération des tickets:', response.data.message);
      return null;
    }
  } catch (error) {
    console.error('Erreur lors de la requête API:', error.message);
    return null;
  }
}

// Fonction pour mettre à jour les champs booléens d'un ticket
async function updateBooleanFields(ticketId) {
  try {
    const response = await axios.post(`${API_URL}/${ticketId}/update-boolean-fields`, {
      professionalInstallation: true,
      oilFilled: true
    }, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.success) {
      console.log('Champs booléens mis à jour avec succès');
      console.log('Nouvelles valeurs:');
      console.log('- Installation pro:', response.data.ticket.partInfo.professionalInstallation ? 'Oui' : 'Non');
      console.log('- Mise en huile:', response.data.ticket.partInfo.oilFilled ? 'Oui' : 'Non');
    } else {
      console.error('Erreur lors de la mise à jour des champs booléens:', response.data.message);
    }
  } catch (error) {
    console.error('Erreur lors de la requête API:', error.message);
  }
}

// Exécution du script
async function main() {
  console.log(`Correction du ticket ${TICKET_NUMBER}...`);
  
  // Récupérer l'ID du ticket
  const ticketId = await getTicketIdByNumber(TICKET_NUMBER);
  
  if (ticketId) {
    console.log(`ID du ticket trouvé: ${ticketId}`);
    
    // Mettre à jour les champs booléens
    await updateBooleanFields(ticketId);
  } else {
    console.error('Impossible de continuer sans ID de ticket');
  }
}

main();
