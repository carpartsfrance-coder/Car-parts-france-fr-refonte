const Order = require('../models/Order');
const User = require('../models/User');
const SavTicket = require('../models/SavTicket');

const baseLocals = (req) => ({
  title: 'Service Après-Vente — CarParts France',
  metaDescription:
    "Ouvrez votre demande SAV en quelques minutes. Pré-qualification rapide, retour offert, analyse banc.",
  canonicalUrl: `${process.env.SITE_URL || 'https://www.carpartsfrance.fr'}/sav`,
  metaRobots: 'index, follow',
});

exports.getSavHome = async (req, res) => {
  const sessionUser = req.session && req.session.user;
  let eligibleOrders = [];
  if (sessionUser) {
    try {
      const cutoff = new Date(Date.now() - 24 * 30.44 * 24 * 60 * 60 * 1000);
      const orders = await Order.find({
        userId: sessionUser._id,
        createdAt: { $gte: cutoff },
        status: { $in: ['paid', 'processing', 'shipped', 'delivered', 'completed'] },
      })
        .sort({ createdAt: -1 })
        .limit(30)
        .select('number createdAt items totalCents status')
        .lean();
      eligibleOrders = orders.map((o) => {
        const items = Array.isArray(o.items) ? o.items : [];
        const first = items[0] || {};
        return {
          number: o.number,
          date: o.createdAt,
          label: items.slice(0, 2).map((i) => i.name).join(', ').slice(0, 120),
          firstItemName: first.name || '',
          firstItemImage: first.image || first.imageUrl || (Array.isArray(first.images) && first.images[0]) || '',
          itemsCount: items.length,
          totalCents: o.totalCents || 0,
          status: o.status,
        };
      });
    } catch (_) {}
  }
  res.render('sav/index', {
    ...baseLocals(req),
    currentUser: sessionUser || null,
    eligibleOrders,
  });
};

// POST /sav/check-commande — vérification d'éligibilité (étape 1)
exports.postCheckCommande = async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const numero = String((req.body && req.body.numeroCommande) || '').trim();
    if (!email || !numero) {
      return res.status(400).json({
        success: false,
        error: 'Email et numéro de commande sont nécessaires pour démarrer.',
      });
    }
    const user = await User.findOne({ email }).select('_id').lean();
    const order = user
      ? await Order.findOne({ number: numero, userId: user._id }).lean()
      : null;

    if (!order) {
      return res.status(404).json({
        success: false,
        error:
          "Nous n'avons pas trouvé de commande à cet email avec ce numéro. Vérifiez vos informations ou contactez-nous à sav@carpartsfrance.fr.",
      });
    }

    const dateCommande = new Date(order.createdAt || order.date || Date.now());
    const ageMois = (Date.now() - dateCommande.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMois > 24) {
      return res.status(403).json({
        success: false,
        error:
          "Cette commande dépasse la garantie légale de 24 mois. Contactez-nous directement pour étudier votre dossier.",
      });
    }

    return res.json({
      success: true,
      data: {
        numero: order.number || numero,
        dateCommande,
        ageMois: Math.round(ageMois * 10) / 10,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error:
        "Notre service est momentanément indisponible. Réessayez dans une minute, ou écrivez-nous à sav@carpartsfrance.fr.",
    });
  }
};

// GET /sav/suivi/:numero — page de suivi
exports.getSuivi = async (req, res) => {
  const numero = req.params.numero;
  res.render('sav/suivi', {
    ...baseLocals(req),
    title: `Suivi de votre demande ${numero} — CarParts France`,
    numero,
  });
};

// GET /sav/feedback/:numero — formulaire de feedback post-résolution
exports.getFeedback = async (req, res) => {
  const numero = req.params.numero;
  const ticket = await SavTicket.findOne({ numero }).lean().catch(() => null);
  if (!ticket) {
    return res.status(404).render('sav/feedback', { ...baseLocals(req), title: 'Feedback', numero, ticket: null, completed: false, sent: false });
  }
  return res.render('sav/feedback', {
    ...baseLocals(req),
    title: `Votre avis sur le SAV ${numero}`,
    metaRobots: 'noindex, nofollow',
    numero,
    ticket,
    completed: !!(ticket.reviewFeedback && ticket.reviewFeedback.completedAt),
    sent: false,
  });
};

// POST /sav/feedback/:numero
exports.postFeedback = async (req, res) => {
  const numero = req.params.numero;
  const note = parseInt((req.body && req.body.note) || '0', 10);
  const comment = String((req.body && req.body.comment) || '').slice(0, 2000);
  const ticket = await SavTicket.findOne({ numero });
  if (!ticket) return res.status(404).redirect('/');
  ticket.reviewFeedback = ticket.reviewFeedback || {};
  ticket.reviewFeedback.note = isNaN(note) ? 0 : Math.max(0, Math.min(5, note));
  ticket.reviewFeedback.comment = comment;
  ticket.reviewFeedback.completedAt = new Date();

  let redirectGoogle = false;
  if (ticket.reviewFeedback.note >= 4) {
    redirectGoogle = true;
    ticket.reviewFeedback.redirectedToGoogle = true;
  }
  await ticket.save();

  if (redirectGoogle) {
    const SavSettings = require('../models/SavSettings');
    const s = await SavSettings.getSingleton().catch(() => null);
    const url = (s && s.integrations && s.integrations.googleReviewsUrl) || process.env.GOOGLE_REVIEWS_URL || 'https://www.google.com/search?q=carpartsfrance+avis';
    return res.redirect(url);
  }
  return res.render('sav/feedback', {
    ...baseLocals(req),
    title: 'Merci pour votre retour',
    metaRobots: 'noindex, nofollow',
    numero,
    ticket: ticket.toObject(),
    completed: true,
    sent: true,
  });
};

// GET /sav/confirmation/:numero — page de confirmation post-création
exports.getConfirmation = async (req, res) => {
  const numero = req.params.numero;
  let ticket = null;
  try {
    ticket = await SavTicket.findOne({ numero }).lean();
  } catch (_) {}
  if (!ticket) {
    return res.status(404).render('sav/confirmation', {
      ...baseLocals(req),
      title: 'Confirmation introuvable',
      numero,
      ticket: null,
      currentUser: req.session && req.session.user,
    });
  }
  res.render('sav/confirmation', {
    ...baseLocals(req),
    title: `Confirmation de votre demande ${numero} — CarParts France`,
    metaRobots: 'noindex, nofollow',
    numero,
    ticket,
    currentUser: req.session && req.session.user,
  });
};
