// Pages admin SAV — uniquement du rendu. Toute la logique passe par /admin/api/sav/*.

function baseLocals(req, extra) {
  return Object.assign(
    {
      title: 'SAV — Admin CarParts France',
      isOwner: req.session && req.session.admin && req.session.admin.role === 'owner',
      // Le token Bearer pour les fetch côté navigateur — exposé seulement à un admin authentifié
      savApiToken: process.env.SAV_API_TOKEN || '',
    },
    extra || {}
  );
}

exports.getSavDashboard = (req, res) => {
  res.render('admin/sav-dashboard', baseLocals(req));
};

exports.getSavTickets = (req, res) => {
  res.render('admin/sav-tickets', baseLocals(req));
};

exports.getSavTicketDetail = (req, res) => {
  res.render(
    'admin/sav-ticket',
    baseLocals(req, { numero: req.params.numero })
  );
};
