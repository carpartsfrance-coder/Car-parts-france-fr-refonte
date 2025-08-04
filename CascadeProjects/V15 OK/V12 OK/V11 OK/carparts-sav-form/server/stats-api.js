// Module pour les statistiques du dashboard SAV
const moment = require('moment');
const Ticket = require('./models/ticket');
const StatusUpdate = require('./models/status');

/**
 * Génère les statistiques pour le dashboard admin
 * @param {Object} app - Instance Express
 * @param {Function} authenticateAdmin - Middleware d'authentification admin
 */
function setupStatsRoutes(app, authenticateAdmin) {
  // Route pour récupérer les statistiques globales
  app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
      
      // Statistiques de base
      const totalTickets = await Ticket.countDocuments();
      const pendingTickets = await Ticket.countDocuments({ status: { $in: ['pending', 'in_progress'] } });
      const resolvedTickets = await Ticket.countDocuments({ status: 'resolved' });
      
      // Tickets du mois en cours
      const startOfMonth = moment().startOf('month').toDate();
      const monthlyTickets = await Ticket.countDocuments({ 
        createdAt: { $gte: startOfMonth } 
      });
      
      // Distribution par statut
      const statusDistribution = {
        labels: ['En attente', 'En cours', 'Résolu', 'Annulé'],
        values: [
          await Ticket.countDocuments({ status: 'pending' }),
          await Ticket.countDocuments({ status: 'in_progress' }),
          await Ticket.countDocuments({ status: 'resolved' }),
          await Ticket.countDocuments({ status: 'cancelled' })
        ]
      };
      
      // Distribution mensuelle sur les 12 derniers mois
      const monthlyDistribution = await getMonthlyDistribution(Ticket);
      
      // Distribution par type de pièce
      const partTypeDistribution = await getPartTypeDistribution(Ticket);
      
      // Temps de résolution moyen par type de pièce
      const resolutionTimeData = await getResolutionTimeData(Ticket);
      
      // Calculer les nouvelles statistiques
      const firstResponseStats = await getFirstResponseTimeStats();
      const vehicleModelStats = await getIssuesByVehicleModel();
      const detailedPartTypeStats = await getDetailedPartTypeStats();
      
      // Envoyer les statistiques
      res.json({
        success: true,
        stats: {
          totalTickets,
          pendingTickets,
          resolvedTickets,
          monthlyTickets,
          statusDistribution,
          monthlyDistribution,
          partTypeDistribution,
          resolutionTimeByPartType: resolutionTimeData,
          // Nouvelles statistiques
          firstResponseTime: firstResponseStats,
          vehicleModelIssues: vehicleModelStats,
          detailedPartTypeStats: detailedPartTypeStats
        }
      });
      
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      res.status(500).json({ error: 'Erreur serveur lors de la récupération des statistiques' });
    }
  });
}

/**
 * Calcule la distribution des tickets par mois sur les 12 derniers mois
 */
async function getMonthlyDistribution(Ticket) {
  const months = [];
  const values = [];
  
  // Générer les 12 derniers mois
  for (let i = 11; i >= 0; i--) {
    const month = moment().subtract(i, 'months');
    const monthName = month.format('MMM');
    months.push(monthName);
    
    const startOfMonth = month.startOf('month').toDate();
    const endOfMonth = month.endOf('month').toDate();
    
    const count = await Ticket.countDocuments({
      createdAt: { $gte: startOfMonth, $lte: endOfMonth }
    });
    
    values.push(count);
  }
  
  return { labels: months, values };
}

/**
 * Calcule la distribution des tickets par type de pièce
 */
async function getPartTypeDistribution(Ticket) {
  // Récupérer tous les types de pièces uniques
  const partTypes = await Ticket.distinct('partType');
  
  const labels = [];
  const values = [];
  
  // Pour chaque type de pièce, compter le nombre de tickets
  for (const partType of partTypes) {
    if (partType && partType.trim() !== '') {
      labels.push(partType);
      const count = await Ticket.countDocuments({ partType });
      values.push(count);
    }
  }
  
  // Si aucun type n'est défini, utiliser des données de démonstration
  if (labels.length === 0) {
    return {
      labels: ['Moteur', 'Transmission', 'Freins', 'Suspension', 'Électrique', 'Carrosserie', 'Autres'],
      values: [15, 12, 18, 10, 20, 8, 5]
    };
  }
  
  return { labels, values };
}

/**
 * Calcule le temps de résolution moyen par type de pièce (en jours)
 */
async function getResolutionTimeData(Ticket) {
  // Récupérer tous les types de pièces uniques
  const partTypes = await Ticket.distinct('partType');
  
  const labels = [];
  const values = [];
  
  // Pour chaque type de pièce, calculer le temps de résolution moyen
  for (const partType of partTypes) {
    if (partType && partType.trim() !== '') {
      // Récupérer tous les tickets résolus pour ce type de pièce
      const tickets = await Ticket.find({ 
        partType,
        status: 'resolved',
        createdAt: { $exists: true },
        resolvedAt: { $exists: true }
      });
      
      if (tickets.length > 0) {
        // Calculer le temps moyen de résolution en jours
        let totalDays = 0;
        for (const ticket of tickets) {
          const createdAt = moment(ticket.createdAt);
          const resolvedAt = moment(ticket.resolvedAt);
          const days = resolvedAt.diff(createdAt, 'days');
          totalDays += days;
        }
        
        const avgDays = totalDays / tickets.length;
        labels.push(partType);
        values.push(avgDays.toFixed(1));
      }
    }
  }
  
  // Si aucune donnée n'est disponible, utiliser des données de démonstration
  if (labels.length === 0) {
    return {
      labels: ['Moteur', 'Transmission', 'Freins', 'Suspension', 'Électrique', 'Carrosserie', 'Autres'],
      values: [5, 3, 2, 4, 3, 6, 4]
    };
  }
  
  return { labels, values };
}

/**
 * Calcule le délai moyen de première réponse aux tickets (en heures)
 */
async function getFirstResponseTimeStats() {
  try {
    // Récupérer tous les tickets
    const tickets = await Ticket.find({}, 'ticketNumber createdAt');
    
    let totalResponseTime = 0;
    let ticketsWithResponse = 0;
    let responseTimeDistribution = {
      labels: ['< 4h', '4-24h', '24-48h', '> 48h'],
      values: [0, 0, 0, 0]
    };
    
    // Pour chaque ticket, trouver la première mise à jour de statut
    for (const ticket of tickets) {
      const firstStatusUpdate = await StatusUpdate.findOne(
        { ticketId: ticket._id },
        'updatedAt'
      ).sort({ updatedAt: 1 });
      
      if (firstStatusUpdate) {
        // Calculer le délai entre la création du ticket et la première réponse
        const createdAt = moment(ticket.createdAt);
        const firstResponseAt = moment(firstStatusUpdate.updatedAt);
        const responseTimeHours = firstResponseAt.diff(createdAt, 'hours', true);
        
        totalResponseTime += responseTimeHours;
        ticketsWithResponse++;
        
        // Classer dans la distribution
        if (responseTimeHours < 4) {
          responseTimeDistribution.values[0]++;
        } else if (responseTimeHours < 24) {
          responseTimeDistribution.values[1]++;
        } else if (responseTimeHours < 48) {
          responseTimeDistribution.values[2]++;
        } else {
          responseTimeDistribution.values[3]++;
        }
      }
    }
    
    const averageResponseTime = ticketsWithResponse > 0 ? 
      (totalResponseTime / ticketsWithResponse).toFixed(2) : 0;
    
    return {
      averageResponseTime,
      responseTimeDistribution
    };
  } catch (error) {
    console.error('Erreur lors du calcul des délais de réponse:', error);
    return {
      averageResponseTime: 0,
      responseTimeDistribution: {
        labels: ['< 4h', '4-24h', '24-48h', '> 48h'],
        values: [0, 0, 0, 0]
      }
    };
  }
}

/**
 * Génère des statistiques détaillées par type de pièce
 */
async function getDetailedPartTypeStats() {
  try {
    // Récupérer la distribution par type de pièce
    const partTypeStats = await Ticket.aggregate([
      { 
        $match: { 
          'partInfo.partType': { $exists: true, $ne: '' } 
        } 
      },
      {
        $group: {
          _id: '$partInfo.partType',
          count: { $sum: 1 },
          // Grouper par statut pour chaque type de pièce
          byStatus: {
            $push: '$currentStatus'
          },
          // Grouper par modèle pour chaque type de pièce
          byModel: {
            $push: '$vehicleInfo.model'
          }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    // Formater les résultats
    const labels = [];
    const values = [];
    const statusBreakdown = {};
    const modelBreakdown = {};
    
    for (const partType of partTypeStats) {
      labels.push(partType._id);
      values.push(partType.count);
      
      // Calculer la répartition par statut pour chaque type de pièce
      const statuses = {};
      partType.byStatus.forEach(status => {
        if (status) {
          statuses[status] = (statuses[status] || 0) + 1;
        }
      });
      statusBreakdown[partType._id] = statuses;
      
      // Calculer les modèles les plus fréquents pour chaque type de pièce
      const models = {};
      partType.byModel.forEach(model => {
        if (model) {
          models[model] = (models[model] || 0) + 1;
        }
      });
      
      // Trier les modèles par fréquence et garder les 5 premiers
      const sortedModels = Object.entries(models)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {});
      
      modelBreakdown[partType._id] = sortedModels;
    }
    
    return {
      labels,
      values,
      statusBreakdown,
      modelBreakdown
    };
  } catch (error) {
    console.error('Erreur lors du calcul des statistiques par type de pièce:', error);
    return {
      labels: [],
      values: [],
      statusBreakdown: {},
      modelBreakdown: {}
    };
  }
}

/**
 * Génère la cartographie des problèmes par modèle de véhicule
 */
async function getIssuesByVehicleModel() {
  try {
    // Agréger les tickets par modèle de véhicule
    const modelStats = await Ticket.aggregate([
      { 
        $match: { 
          'vehicleInfo.model': { $exists: true, $ne: '' } 
        } 
      },
      {
        $group: {
          _id: '$vehicleInfo.model',
          count: { $sum: 1 },
          byPartType: {
            $push: '$partInfo.partType'
          }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 } // Limiter aux 10 modèles les plus fréquents
    ]);
    
    // Formater les résultats
    const labels = [];
    const values = [];
    const partTypeBreakdown = {};
    
    for (const model of modelStats) {
      labels.push(model._id);
      values.push(model.count);
      
      // Calculer la répartition par type de pièce pour chaque modèle
      const partTypes = {};
      model.byPartType.forEach(type => {
        if (type) {
          partTypes[type] = (partTypes[type] || 0) + 1;
        }
      });
      
      partTypeBreakdown[model._id] = partTypes;
    }
    
    return {
      labels,
      values,
      partTypeBreakdown
    };
  } catch (error) {
    console.error('Erreur lors du calcul des problèmes par modèle:', error);
    return {
      labels: [],
      values: [],
      partTypeBreakdown: {}
    };
  }
}

module.exports = setupStatsRoutes;
