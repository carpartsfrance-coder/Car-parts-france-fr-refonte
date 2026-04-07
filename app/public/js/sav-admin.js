/* SAV admin — client de l'API REST /admin/api/sav/*  */
(function () {
  'use strict';

  var root = document.querySelector('[data-sav-token]');
  if (!root) return;
  var TOKEN = root.getAttribute('data-sav-token') || '';
  var H = { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, H, opts.headers || {});
    return fetch('/admin/api/sav' + path, opts).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    });
  }

  function toast(msg, type) {
    var rootEl = document.getElementById('sav-toast-root');
    if (!rootEl) { return alert(msg); }
    var el = document.createElement('div');
    el.className = 'sav-toast sav-toast--' + (type || 'success');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span class="material-symbols-outlined">' + (type === 'error' ? 'error' : 'check_circle') + '</span><span>' + msg + '</span>';
    rootEl.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('sav-toast--visible'); });
    setTimeout(function () { el.classList.remove('sav-toast--visible'); setTimeout(function () { el.remove(); }, 250); }, 4000);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ============ DASHBOARD ============
  if (document.getElementById('sav-kpi-grid')) {
    api('/dashboard').then(function (res) {
      if (!res.ok || !res.j.success) {
        document.getElementById('sav-dashboard-error').textContent = res.j.error || 'Erreur de chargement.';
        document.getElementById('sav-dashboard-error').classList.remove('hidden');
        return;
      }
      var d = res.j.data;
      var map = {
        ouverts: d.ouverts,
        en_attente_doc: d.en_attente_doc || '—',
        en_analyse: d.en_analyse || '—',
        sla_depasse: d.sla_depasse,
        ca_recupere: (d.ca_recupere || 0) + ' €',
        taux_defaut: (d.taux_defaut_produit || 0) + ' %',
      };
      Object.keys(map).forEach(function (k) {
        var card = document.querySelector('[data-kpi="' + k + '"] [data-kpi-value]');
        if (card) card.textContent = map[k];
      });
    });

    api('/tickets?sla_depasse=true&limit=10').then(function (res) {
      var box = document.getElementById('sav-priority-list');
      if (!res.ok || !res.j.success) { box.innerHTML = '<div class="px-5 py-6 text-sm text-red-700">Erreur de chargement.</div>'; return; }
      var list = res.j.data.tickets || [];
      if (!list.length) { box.innerHTML = '<div class="px-5 py-8 text-center text-sm text-slate-500">Aucun dossier en retard 🎉</div>'; return; }
      box.innerHTML = list.map(function (t) {
        return '<a class="flex items-center justify-between px-5 py-3 hover:bg-slate-50" href="/admin/sav/tickets/' + encodeURIComponent(t.numero) + '">' +
          '<div><div class="font-mono text-sm font-semibold text-slate-900">' + escapeHtml(t.numero) + '</div>' +
          '<div class="text-xs text-slate-500">' + escapeHtml(t.client && t.client.email) + ' · ' + escapeHtml(t.pieceType) + '</div></div>' +
          '<div class="sav-sla-badge sav-sla-badge--late">en retard</div></a>';
      }).join('');
    });
  }

  // ============ LISTE TICKETS ============
  if (document.getElementById('sav-tickets-tbody')) {
    var tbody = document.getElementById('sav-tickets-tbody');
    var form = document.getElementById('sav-filters');

    function load() {
      var fd = new FormData(form);
      var qs = new URLSearchParams();
      fd.forEach(function (v, k) { if (v) qs.append(k, v); });
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-10 text-center text-slate-500">Chargement…</td></tr>';
      api('/tickets?' + qs.toString()).then(function (res) {
        if (!res.ok || !res.j.success) {
          var err = document.getElementById('sav-tickets-error');
          err.textContent = res.j.error || 'Erreur de chargement.';
          err.classList.remove('hidden');
          tbody.innerHTML = '';
          return;
        }
        var search = (fd.get('search') || '').toString().toLowerCase();
        var list = (res.j.data.tickets || []).filter(function (t) {
          if (!search) return true;
          return (t.numero || '').toLowerCase().includes(search)
              || ((t.client && t.client.email) || '').toLowerCase().includes(search)
              || ((t.vehicule && t.vehicule.vin) || '').toLowerCase().includes(search);
        });
        if (!list.length) {
          tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-10 text-center text-slate-500">Aucun ticket.</td></tr>';
          return;
        }
        tbody.innerHTML = list.map(function (t, i) {
          var sla = slaState(t.sla && t.sla.dateLimite);
          return '<tr class="hover:bg-slate-50 cursor-pointer" data-row="' + i + '" data-numero="' + escapeHtml(t.numero) + '">' +
            '<td class="px-4 py-3 font-mono text-xs font-semibold">' + escapeHtml(t.numero) + '</td>' +
            '<td class="px-4 py-3">' + escapeHtml(t.client && t.client.email) + '</td>' +
            '<td class="px-4 py-3">' + escapeHtml(t.pieceType) + '</td>' +
            '<td class="px-4 py-3 text-xs">' + escapeHtml((t.vehicule && t.vehicule.vin) || '') + '</td>' +
            '<td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100">' + escapeHtml(t.statut) + '</span></td>' +
            '<td class="px-4 py-3"><span class="sav-sla-badge sav-sla-badge--' + sla.cls + '">' + sla.label + '</span></td>' +
            '<td class="px-4 py-3 text-xs text-slate-500">' + new Date(t.createdAt).toLocaleDateString('fr-FR') + '</td>' +
          '</tr>';
        }).join('');
        bindRows();
      });
    }

    function slaState(d) {
      if (!d) return { cls: 'ok', label: '—' };
      var diff = (new Date(d) - Date.now()) / 36e5;
      if (diff < 0) return { cls: 'late', label: 'dépassé' };
      if (diff < 24) return { cls: 'warn', label: '< 24h' };
      return { cls: 'ok', label: Math.round(diff / 24) + 'j' };
    }

    var selected = -1;
    function bindRows() {
      var rows = tbody.querySelectorAll('[data-row]');
      rows.forEach(function (r) {
        r.addEventListener('click', function () {
          window.location.href = '/admin/sav/tickets/' + encodeURIComponent(r.getAttribute('data-numero'));
        });
      });
    }

    document.addEventListener('keydown', function (e) {
      var rows = tbody.querySelectorAll('[data-row]');
      if (!rows.length) return;
      if (e.key === 'j') { selected = Math.min(selected + 1, rows.length - 1); }
      else if (e.key === 'k') { selected = Math.max(selected - 1, 0); }
      else if (e.key === 'Enter' && selected >= 0) {
        window.location.href = '/admin/sav/tickets/' + encodeURIComponent(rows[selected].getAttribute('data-numero'));
        return;
      } else { return; }
      rows.forEach(function (r, i) { r.classList.toggle('bg-primary/10', i === selected); });
    });

    form.addEventListener('submit', function (e) { e.preventDefault(); load(); });
    load();
  }

  // ============ DETAIL TICKET ============
  var detailEl = document.querySelector('[data-sav-numero]');
  if (detailEl) {
    var numero = detailEl.getAttribute('data-sav-numero');
    var ticket = null;

    function loadTicket() {
      api('/tickets/' + encodeURIComponent(numero)).then(function (res) {
        if (!res.ok || !res.j.success) {
          var err = document.getElementById('sav-detail-error');
          err.textContent = res.j.error || 'Erreur de chargement.';
          err.classList.remove('hidden');
          return;
        }
        ticket = res.j.data;
        renderHeader();
        renderDossier();
        renderTimeline();
        renderDocuments();
        renderMessages();
        renderPaiement();
        renderFournisseur();
      });
    }

    function renderHeader() {
      var meta = '';
      if (ticket.client) meta += escapeHtml(ticket.client.nom || '') + ' · ' + escapeHtml(ticket.client.email || '');
      if (ticket.vehicule && ticket.vehicule.vin) meta += ' · VIN ' + escapeHtml(ticket.vehicule.vin);
      if (ticket.pieceType) meta += ' · ' + escapeHtml(ticket.pieceType);
      document.getElementById('sav-header-meta').textContent = meta;
      document.getElementById('sav-statut-badge').textContent = ticket.statut;

      var sla = document.getElementById('sav-sla-badge');
      var d = ticket.sla && ticket.sla.dateLimite;
      if (d) {
        var diff = (new Date(d) - Date.now()) / 36e5;
        sla.className = 'sav-sla-badge sav-sla-badge--' + (diff < 0 ? 'late' : diff < 24 ? 'warn' : 'ok');
        sla.textContent = diff < 0 ? 'SLA dépassé' : 'SLA dans ' + Math.max(1, Math.round(diff)) + 'h';
        if (diff < 0) sla.style.animation = 'sav-pulse 1.4s infinite';
      }
    }

    function renderTimeline() {
      var box = document.getElementById('sav-timeline');
      var msgs = (ticket.messages || []).slice().reverse();
      if (!msgs.length) { box.innerHTML = '<div class="text-sm text-slate-500">Aucun événement.</div>'; return; }
      box.innerHTML = msgs.map(function (m) {
        return '<div class="sav-timeline__item">' +
          '<div class="sav-timeline__dot sav-timeline__dot--fait"></div>' +
          '<div class="text-xs text-slate-500">' + new Date(m.date).toLocaleString('fr-FR') + ' · ' + escapeHtml(m.canal) + ' · ' + escapeHtml(m.auteur) + '</div>' +
          '<div class="text-sm text-slate-800">' + escapeHtml(m.contenu) + '</div>' +
        '</div>';
      }).join('');
    }

    function fmtSize(n) {
      if (!n && n !== 0) return '';
      if (n < 1024) return n + ' o';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' Ko';
      return (n / (1024 * 1024)).toFixed(2) + ' Mo';
    }

    function kindLabel(k) {
      return ({
        factureMontage: 'Facture garage',
        photoObd: 'Lecture OBD',
        photoPiece: 'Photo pièce installée',
        confirmationReglageBase: 'Réglage de base',
        autre: 'Document',
      })[k] || (k || 'Document');
    }

    function isImage(d) {
      if (d.mime && /^image\//i.test(d.mime)) return true;
      return /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(d.url || '');
    }

    function renderDocuments() {
      var box = document.getElementById('sav-documents');
      // Source principale : documentsList enrichie. Fallback : champs legacy.
      var docs = [];
      if (Array.isArray(ticket.documentsList) && ticket.documentsList.length) {
        docs = ticket.documentsList.slice();
      } else {
        var d = ticket.documents || {};
        if (d.factureMontage) docs.push({ kind: 'factureMontage', url: d.factureMontage });
        (d.photosObd || []).forEach(function (u) { docs.push({ kind: 'photoObd', url: u }); });
        if (d.confirmationReglageBase) docs.push({ kind: 'confirmationReglageBase', url: d.confirmationReglageBase });
        (d.photosVisuelles || []).forEach(function (u) { docs.push({ kind: 'photoPiece', url: u }); });
      }

      if (!docs.length) {
        box.innerHTML =
          '<div class="col-span-full flex flex-col items-center justify-center py-10 text-center text-slate-500">' +
            '<span class="material-symbols-outlined text-5xl text-slate-300">folder_off</span>' +
            '<div class="mt-2 text-sm font-medium">Le client n\'a encore déposé aucun document</div>' +
            '<div class="text-xs text-slate-400">Facture garage et photo de la pièce sont obligatoires.</div>' +
          '</div>';
        return;
      }

      box.innerHTML = docs.map(function (x) {
        var img = isImage(x);
        var thumb = img
          ? '<div class="aspect-video w-full overflow-hidden rounded-lg bg-slate-100"><img src="' + escapeHtml(x.url) + '" alt="" loading="lazy" class="w-full h-full object-cover"></div>'
          : '<div class="aspect-video w-full flex items-center justify-center rounded-lg bg-slate-100 text-slate-400"><span class="material-symbols-outlined text-5xl">picture_as_pdf</span></div>';
        var name = escapeHtml(x.originalName || (x.url || '').split('/').pop() || 'document');
        var meta = [];
        if (x.size) meta.push(fmtSize(x.size));
        if (x.uploadedAt) meta.push(new Date(x.uploadedAt).toLocaleDateString('fr-FR'));
        return (
          '<div class="rounded-xl border border-slate-200 p-2 flex flex-col gap-2 bg-white">' +
            thumb +
            '<div class="text-xs font-semibold text-slate-700 truncate" title="' + name + '">' + escapeHtml(kindLabel(x.kind)) + '</div>' +
            '<div class="text-[11px] text-slate-500 truncate" title="' + name + '">' + name + '</div>' +
            (meta.length ? '<div class="text-[10px] text-slate-400">' + escapeHtml(meta.join(' · ')) + '</div>' : '') +
            '<div class="flex gap-1 mt-auto">' +
              '<a href="' + escapeHtml(x.url) + '" target="_blank" rel="noopener" class="flex-1 text-center text-[11px] rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50">Ouvrir</a>' +
              '<a href="' + escapeHtml(x.url) + '" download class="flex-1 text-center text-[11px] rounded-lg bg-slate-900 text-white px-2 py-1 hover:bg-slate-700">Télécharger</a>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    function renderDossier() {
      var box = document.getElementById('sav-dossier');
      if (!box) return;
      var t = ticket || {};
      var v = t.vehicule || {};
      var g = t.garage || {};
      var m = t.montage || {};
      var diag = t.diagnostic || {};
      var cgv = t.cgvAcceptance || {};

      var commandeBlock = '';
      if (t.numeroCommande) {
        commandeBlock =
          '<a href="/admin/commandes/' + encodeURIComponent(t.numeroCommande) + '" class="text-primary underline font-mono">' +
          escapeHtml(t.numeroCommande) + '</a>' +
          (t.dateAchat ? ' · ' + new Date(t.dateAchat).toLocaleDateString('fr-FR') : '');
      } else commandeBlock = '<span class="text-slate-400">—</span>';

      var vehiculeBlock = [
        v.vin ? '<div><strong>VIN&nbsp;:</strong> <span class="font-mono">' + escapeHtml(v.vin) + '</span></div>' : '',
        v.immatriculation ? '<div><strong>Plaque&nbsp;:</strong> ' + escapeHtml(v.immatriculation) + '</div>' : '',
        (v.marque || v.modele) ? '<div>' + escapeHtml([v.marque, v.modele, v.annee].filter(Boolean).join(' ')) + '</div>' : '',
        v.kilometrage ? '<div>' + escapeHtml(v.kilometrage) + ' km</div>' : '',
      ].filter(Boolean).join('') || '<span class="text-slate-400">Non renseigné</span>';

      var montageBlock = [
        m.date ? '<div><strong>Date&nbsp;:</strong> ' + new Date(m.date).toLocaleDateString('fr-FR') + '</div>' : '',
        g.nom ? '<div><strong>Garage&nbsp;:</strong> ' + escapeHtml(g.nom) + '</div>' : '',
        g.adresse ? '<div class="text-xs text-slate-500">' + escapeHtml(g.adresse) + '</div>' : '',
        m.reglageBase ? '<div><strong>Réglage de base&nbsp;:</strong> <span class="px-1.5 py-0.5 rounded text-xs ' +
          (m.reglageBase === 'oui' ? 'bg-emerald-100 text-emerald-800'
          : m.reglageBase === 'non' ? 'bg-red-100 text-red-800'
          : 'bg-amber-100 text-amber-800') + '">' + escapeHtml(m.reglageBase) + '</span></div>' : '',
      ].filter(Boolean).join('') || '<span class="text-slate-400">Non renseigné</span>';

      var symptomesBlock = (diag.symptomes && diag.symptomes.length)
        ? diag.symptomes.map(function (s) {
            return '<span class="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-900 mr-1 mb-1">' + escapeHtml(s) + '</span>';
          }).join('')
        : '<span class="text-slate-400 text-sm">Aucun symptôme coché</span>';

      var codesBlock = (diag.codesDefaut && diag.codesDefaut.length)
        ? diag.codesDefaut.map(function (c) {
            return '<span class="inline-block px-2 py-0.5 rounded text-xs bg-slate-900 text-white font-mono mr-1 mb-1">' + escapeHtml(c) + '</span>';
          }).join('')
        : '<span class="text-slate-400 text-sm">Aucun</span>';

      var descrBlock = diag.description
        ? '<blockquote class="border-l-4 border-primary/40 bg-slate-50 px-3 py-2 text-sm italic text-slate-700">' + escapeHtml(diag.description) + '</blockquote>'
        : '<span class="text-slate-400 text-sm">Pas de description libre</span>';

      var cgvBlock = cgv.acceptedAt
        ? '<div class="text-xs text-slate-600">Version <strong>' + escapeHtml(cgv.version || 'v1') + '</strong> · ' +
          new Date(cgv.acceptedAt).toLocaleString('fr-FR') +
          (cgv.ip ? ' · IP <span class="font-mono">' + escapeHtml(cgv.ip) + '</span>' : '') + '</div>'
        : '<span class="text-slate-400 text-xs">Non horodaté</span>';

      box.innerHTML =
        '<details open class="rounded-xl border border-slate-200 bg-white p-4">' +
          '<summary class="cursor-pointer text-sm font-semibold text-slate-700">Commande liée</summary>' +
          '<div class="mt-2 text-sm">' + commandeBlock + '</div>' +
        '</details>' +
        '<details open class="rounded-xl border border-slate-200 bg-white p-4">' +
          '<summary class="cursor-pointer text-sm font-semibold text-slate-700">Véhicule</summary>' +
          '<div class="mt-2 text-sm space-y-1">' + vehiculeBlock + '</div>' +
        '</details>' +
        '<details open class="rounded-xl border border-slate-200 bg-white p-4">' +
          '<summary class="cursor-pointer text-sm font-semibold text-slate-700">Montage</summary>' +
          '<div class="mt-2 text-sm space-y-1">' + montageBlock + '</div>' +
        '</details>' +
        '<details open class="rounded-xl border border-slate-200 bg-white p-4">' +
          '<summary class="cursor-pointer text-sm font-semibold text-slate-700">Symptômes</summary>' +
          '<div class="mt-2">' + symptomesBlock + '</div>' +
        '</details>' +
        '<details class="rounded-xl border border-slate-200 bg-white p-4">' +
          '<summary class="cursor-pointer text-sm font-semibold text-slate-700">Codes défaut OBD</summary>' +
          '<div class="mt-2">' + codesBlock + '</div>' +
        '</details>' +
        '<details class="rounded-xl border border-slate-200 bg-white p-4">' +
          '<summary class="cursor-pointer text-sm font-semibold text-slate-700">Description du client</summary>' +
          '<div class="mt-2">' + descrBlock + '</div>' +
        '</details>' +
        '<details class="rounded-xl border border-slate-200 bg-white p-4">' +
          '<summary class="cursor-pointer text-sm font-semibold text-slate-700">CGV SAV</summary>' +
          '<div class="mt-2">' + cgvBlock + '</div>' +
        '</details>';
    }

    function renderMessages() {
      var box = document.getElementById('sav-messages');
      var msgs = ticket.messages || [];
      if (!msgs.length) { box.innerHTML = '<div class="text-sm text-slate-500">Aucun message.</div>'; return; }
      box.innerHTML = msgs.map(function (m) {
        return '<div class="rounded-xl border border-slate-200 p-2 text-sm">' +
          '<div class="text-xs text-slate-500">' + new Date(m.date).toLocaleString('fr-FR') + ' · ' + escapeHtml(m.canal) + ' · ' + escapeHtml(m.auteur) + '</div>' +
          '<div>' + escapeHtml(m.contenu) + '</div></div>';
      }).join('');
    }

    function renderPaiement() {
      var box = document.getElementById('sav-paiement');
      var p = ticket.paiements && ticket.paiements.facture149;
      if (!p || !p.status || p.status === 'na') { box.innerHTML = '<span class="text-slate-400">Non applicable</span>'; return; }
      box.innerHTML = '<div>Statut : <strong>' + escapeHtml(p.status) + '</strong></div>' +
        (p.mollieId ? '<div class="text-xs text-slate-500">Mollie : ' + escapeHtml(p.mollieId) + '</div>' : '') +
        (p.dateGeneration ? '<div class="text-xs text-slate-500">Généré : ' + new Date(p.dateGeneration).toLocaleString('fr-FR') + '</div>' : '');
    }

    function renderFournisseur() {
      var box = document.getElementById('sav-fournisseur');
      var f = ticket.fournisseur || {};
      if (!f.contact && !f.dateEnvoi) { box.innerHTML = '<span class="text-slate-400">Aucun envoi fournisseur.</span>'; return; }
      box.innerHTML = (f.contact ? '<div>Contact : ' + escapeHtml(f.contact) + '</div>' : '') +
        (f.dateEnvoi ? '<div class="text-xs">Envoi : ' + new Date(f.dateEnvoi).toLocaleDateString('fr-FR') + '</div>' : '') +
        (f.dateRetour ? '<div class="text-xs">Retour : ' + new Date(f.dateRetour).toLocaleDateString('fr-FR') + '</div>' : '') +
        (f.reponse ? '<div class="mt-1 text-xs">' + escapeHtml(f.reponse) + '</div>' : '');
    }

    // Templates
    var templates = {
      reception: 'Bonjour, nous confirmons la bonne réception de votre pièce. L\'analyse sur banc démarre cette semaine.',
      analyse_ok: 'Bonne nouvelle : notre analyse confirme un défaut produit. Échange ou remboursement intégral, retour offert.',
      analyse_neg: 'Notre analyse est terminée. Voici le rapport. La pièce ne présente pas de défaut produit (cf. forfait 149€).',
      relance_doc: 'Pour traiter votre dossier, nous avons besoin de la facture du garage et de la confirmation du réglage de base.',
    };
    document.getElementById('sav-template').addEventListener('change', function (e) {
      var v = e.target.value;
      if (templates[v]) document.querySelector('#sav-msg-form [name="contenu"]').value = templates[v];
    });

    document.getElementById('sav-msg-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      api('/tickets/' + encodeURIComponent(numero) + '/messages', {
        method: 'POST',
        body: JSON.stringify({ auteur: 'admin', canal: fd.get('canal'), contenu: fd.get('contenu') }),
      }).then(function (res) {
        if (res.ok && res.j.success) { toast('Message envoyé'); e.target.reset(); loadTicket(); }
        else toast(res.j.error || 'Erreur', 'error');
      });
    });

    document.getElementById('sav-diag-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var payload = {
        conclusion: fd.get('conclusion'),
        rapport: fd.get('rapport'),
        scoreRisque: fd.get('scoreRisque') ? Number(fd.get('scoreRisque')) : undefined,
        codesDefaut: (fd.get('codesDefaut') || '').toString().split(/[,\s]+/).filter(Boolean),
      };
      api('/tickets/' + encodeURIComponent(numero) + '/diagnostic', {
        method: 'POST', body: JSON.stringify(payload),
      }).then(function (res) {
        if (res.ok && res.j.success) { toast('Diagnostic enregistré'); loadTicket(); }
        else toast(res.j.error || 'Erreur', 'error');
      });
    });

    document.querySelectorAll('[data-action-statut]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var statut = btn.getAttribute('data-action-statut');
        api('/tickets/' + encodeURIComponent(numero) + '/statut', {
          method: 'PATCH', body: JSON.stringify({ statut: statut, auteur: 'admin' }),
        }).then(function (res) {
          if (res.ok && res.j.success) { toast('Statut → ' + statut); loadTicket(); }
          else toast(res.j.error || 'Erreur', 'error');
        });
      });
    });

    document.querySelectorAll('[data-action-resolution]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.getAttribute('data-action-resolution');
        api('/tickets/' + encodeURIComponent(numero) + '/resolution', {
          method: 'POST', body: JSON.stringify({ type: type }),
        }).then(function (res) {
          if (res.ok && res.j.success) { toast('Résolution : ' + type); loadTicket(); }
          else toast(res.j.error || 'Erreur', 'error');
        });
      });
    });

    var fact = document.querySelector('[data-action-facturer]');
    if (fact) fact.addEventListener('click', function () {
      api('/tickets/' + encodeURIComponent(numero) + '/facturer-149', { method: 'POST' })
        .then(function (res) {
          if (res.ok && res.j.success) {
            toast('Lien de paiement généré');
            if (res.j.data.paymentUrl) window.open(res.j.data.paymentUrl, '_blank');
            loadTicket();
          } else toast(res.j.error || 'Erreur', 'error');
        });
    });

    var pdf = document.querySelector('[data-action-pdf]');
    if (pdf) pdf.addEventListener('click', function () {
      api('/tickets/' + encodeURIComponent(numero) + '/rapport-pdf', { method: 'POST' })
        .then(function (res) {
          if (res.ok && res.j.success) {
            toast('Rapport PDF généré');
            if (res.j.data.url) window.open(res.j.data.url, '_blank');
            loadTicket();
          } else toast(res.j.error || 'Erreur', 'error');
        });
    });

    // Raccourcis clavier
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input,textarea,select')) return;
      if (e.key === 's') { document.querySelector('[data-action-statut]').focus(); }
      if (e.key === 'e') { document.querySelector('#sav-diag-form [name="conclusion"]').focus(); }
    });

    loadTicket();
  }
})();
