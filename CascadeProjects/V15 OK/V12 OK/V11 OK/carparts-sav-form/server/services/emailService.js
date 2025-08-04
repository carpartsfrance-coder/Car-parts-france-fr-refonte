const nodemailer = require('nodemailer');
require('dotenv').config();

// Configuration du transporteur d'emails
console.log('Configuration SMTP:', {
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  user: process.env.EMAIL_USER
});

// Déterminer si nous sommes en environnement de développement
const isDevelopment = process.env.NODE_ENV !== 'production';

// URL de base pour les liens dans les emails
const baseUrl = isDevelopment ? 'http://127.0.0.1:54353' : (process.env.WEBSITE_URL || 'https://carpartsfrance.fr');
console.log('URL de base pour les emails:', baseUrl);

const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 465,
  secure: true,
  auth: {
    user: 'sav@carpartsfrance.fr',
    pass: 'a0fV1#T4OV['
  },
  debug: true
});

/**
 * Envoie un email de notification au client lors d'un changement de statut de son ticket
 * @param {Object} ticket - Le ticket avec les informations client
 * @param {String} status - Le nouveau statut du ticket
 * @param {String} comment - Commentaire optionnel à inclure dans l'email
 * @returns {Promise} - Résultat de l'envoi d'email
 */
const sendStatusUpdateEmail = async (ticket, status, comment = '') => {
  // Ne pas envoyer d'email si l'adresse email du client n'est pas disponible
  if (!ticket.clientInfo || !ticket.clientInfo.email) {
    console.log('Impossible d\'envoyer un email: adresse email du client manquante');
    return null;
  }

  // Traduire le statut en texte plus lisible
  const statusTranslation = {
    'nouveau': 'Nouveau',
    'en_analyse': 'En cours d\'analyse',
    'info_complementaire': 'Informations complémentaires requises',
    'validé': 'Validé',
    'refusé': 'Refusé',
    'en_cours_traitement': 'En cours de traitement',
    'expédié': 'Expédié',
    'clôturé': 'Clôturé'
  };

  // Construire le sujet et le corps de l'email
  const subject = `Mise à jour de votre ticket SAV ${ticket.ticketNumber}`;
  
  let htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #003366; color: white; padding: 20px; text-align: center;">
        <h1>Car Parts France - Service Après-Vente</h1>
      </div>
      <div style="padding: 20px; border: 1px solid #ddd; background-color: #f9f9f9;">
        <h2>Mise à jour de votre ticket SAV</h2>
        <p>Bonjour ${ticket.clientInfo.firstName} ${ticket.clientInfo.lastName},</p>
        <p>Nous vous informons que le statut de votre ticket SAV <strong>${ticket.ticketNumber}</strong> a été mis à jour.</p>
        
        <div style="background-color: #eef6ff; border-left: 4px solid #003366; padding: 15px; margin: 20px 0;">
          <p><strong>Nouveau statut :</strong> ${statusTranslation[status] || status}</p>
        </div>
  `;

  // Ajouter le commentaire s'il existe
  if (comment) {
    htmlContent += `
        <div style="background-color: #f0f0f0; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <p><strong>Message de notre équipe :</strong></p>
          <p>${comment.replace(/\n/g, '<br>')}</p>
        </div>
    `;
  }

  // Ajouter le lien de suivi et le pied de page
  htmlContent += `
        <p>Vous pouvez suivre l'évolution de votre demande à tout moment en vous rendant sur notre <a href="${baseUrl}/tracking/?ticket=${ticket.ticketNumber}" style="color: #003366; text-decoration: underline;">page de suivi</a>.</p>
        
        <p>Nous vous remercions de votre confiance.</p>
        <p>L'équipe Car Parts France</p>
      </div>
      <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
        <p>Ce message est envoyé automatiquement, merci de ne pas y répondre directement.</p>
        <p>© ${new Date().getFullYear()} Car Parts France - Tous droits réservés</p>
      </div>
    </div>
  `;

  // Options de l'email
  const mailOptions = {
    from: process.env.EMAIL_FROM || '"Car Parts France SAV" <sav@carpartsfrance.com>',
    to: ticket.clientInfo.email,
    subject: subject,
    html: htmlContent
  };

  try {
    // Envoyer l'email
    const info = await transporter.sendMail(mailOptions);
    console.log('Email envoyé:', info.messageId);
    return info;
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email:', error);
    return null;
  }
};

/**
 * Envoie un email de confirmation au client lors de la création d'un nouveau ticket
 * @param {Object} ticket - Le ticket avec les informations client
 * @returns {Promise} - Résultat de l'envoi d'email
 */
const sendTicketCreationEmail = async (ticket) => {
  // Ne pas envoyer d'email si l'adresse email du client n'est pas disponible
  if (!ticket.clientInfo || !ticket.clientInfo.email) {
    console.log('Impossible d\'envoyer un email: adresse email du client manquante');
    return null;
  }

  // Construire le sujet et le corps de l'email
  const subject = `Confirmation de votre demande SAV ${ticket.ticketNumber}`;
  
  let htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #003366; color: white; padding: 20px; text-align: center;">
        <h1>Car Parts France - Service Après-Vente</h1>
      </div>
      <div style="padding: 20px; border: 1px solid #ddd; background-color: #f9f9f9;">
        <h2>Confirmation de votre demande SAV</h2>
        <p>Bonjour ${ticket.clientInfo.firstName} ${ticket.clientInfo.lastName},</p>
        <p>Nous avons bien reçu votre demande de SAV concernant <strong>${ticket.partInfo.partType === 'autres' ? 'une pièce' : 'un(e) ' + ticket.partInfo.partType.replace('_', ' ')}</strong>.</p>
        <p>Votre numéro de ticket est : <strong style="font-size: 18px;">${ticket.ticketNumber}</strong></p>
        <p>Notre équipe technique va étudier votre demande dans les plus brefs délais.</p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="${baseUrl}/tracking/?ticket=${ticket.ticketNumber}" style="background-color: #E60000; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">Suivre votre ticket</a>
        </div>
        <p>Vous recevrez des notifications par email à chaque mise à jour de votre ticket.</p>
        <p>Si vous avez des questions, n'hésitez pas à nous contacter en répondant à cet email ou en appelant notre service client.</p>
      </div>
      <div style="padding: 15px; text-align: center; font-size: 12px; color: #666;">
        <p>Car Parts France - Service Après-Vente</p>
        <p>Tél: 01 23 45 67 89 | Email: sav@carpartsfrance.fr</p>
      </div>
    </div>
  `;

  // Options de l'email
  const mailOptions = {
    from: process.env.EMAIL_FROM || '"Car Parts France SAV" <sav@carpartsfrance.fr>',
    to: ticket.clientInfo.email,
    subject: subject,
    html: htmlContent
  };

  try {
    // Envoyer l'email
    const info = await transporter.sendMail(mailOptions);
    console.log('Email de confirmation envoyé:', info.messageId);
    return info;
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email de confirmation:', error);
    return null;
  }
};

module.exports = {
  sendStatusUpdateEmail,
  sendTicketCreationEmail
};
