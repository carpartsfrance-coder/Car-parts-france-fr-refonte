// Script de test pour la route DELETE
const fetch = require('node-fetch');

// Identifiants admin (à remplacer par les vrais identifiants)
const username = 'admin';
const password = 'password';
const authToken = Buffer.from(`${username}:${password}`).toString('base64');

// ID du ticket à supprimer (à remplacer par un ID valide)
const ticketId = '68831e465b439f60f7e9b8df';

async function testDeleteTicket() {
  try {
    console.log('Test de suppression du ticket avec ID:', ticketId);
    
    const response = await fetch(`http://localhost:3000/api/admin/tickets/${ticketId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Statut de la réponse:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Réponse:', data);
    } else {
      const errorText = await response.text();
      console.error('Erreur:', response.status, errorText);
    }
  } catch (error) {
    console.error('Erreur lors du test:', error);
  }
}

testDeleteTicket();
