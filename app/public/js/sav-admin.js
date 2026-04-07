/* SAV admin — front unifié pour les pages /admin/sav/*
 *
 * Pages couvertes :
 *   /admin/sav                 → dashboard KPI + chart Chart.js
 *   /admin/sav/tickets         → liste paginée, triable, bulk actions, raccourcis
 *   /admin/sav/tickets/:numero → fiche 2 col + onglets + assignation + WYSIWYG + diag enrichi + fournisseur
 *   /admin/parametres/sav      → settings (SLA per piece, automations)
 *   /admin/parametres/audit    → journal d'audit
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-sav-token]');
  if (!root) return;
  var TOKEN = root.getAttribute('data-sav-token') || '';
  var CURRENT_USER_ID = root.getAttribute('data-current-user-id') || '';
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
    if (!rootEl) {
      // Si pas de root toast (pages list/dashboard), on crée à la volée
      rootEl = document.createElement('div');
      rootEl.id = 'sav-toast-root';
      rootEl.className = 'sav-toast-root';
      document.body.appendChild(rootEl);
    }
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

  function fmtSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' Ko';
    return (n / (1024 * 1024)).toFixed(2) + ' Mo';
  }

  function fmtDuration(ms) {
    if (ms < 0) return 'dépassé';
    var d = Math.floor(ms / (24 * 3600 * 1000));
    var h = Math.floor((ms % (24 * 3600 * 1000)) / (3600 * 1000));
    if (d > 0) return d + 'j ' + h + 'h restantes';
    var m = Math.floor((ms % (3600 * 1000)) / 60000);
    return h + 'h ' + m + 'min restantes';
  }

  // Couleurs par type de pièce (badges)
  var PIECE_COLORS = {
    mecatronique_dq200: 'bg-sky-100 text-sky-800',
    mecatronique_dq250: 'bg-blue-100 text-blue-800',
    mecatronique_dq381: 'bg-indigo-100 text-indigo-800',
    mecatronique_dq500: 'bg-violet-100 text-violet-800',
    boite_transfert: 'bg-orange-100 text-orange-800',
    pont: 'bg-amber-100 text-amber-800',
    differentiel: 'bg-yellow-100 text-yellow-800',
    haldex: 'bg-emerald-100 text-emerald-800',
    reducteur: 'bg-teal-100 text-teal-800',
    cardan: 'bg-rose-100 text-rose-800',
    autre: 'bg-slate-100 text-slate-700',
  };
  function pieceBadge(t) {
    var cls = PIECE_COLORS[t] || PIECE_COLORS.autre;
    return '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold ' + cls + '">' + escapeHtml(t || '—') + '</span>';
  }

  function avatar(name) {
    var n = (name || '').trim();
    if (!n) return '<span class="inline-flex w-6 h-6 rounded-full bg-slate-200 text-slate-400 items-center justify-center text-[10px]">·</span>';
    var initials = n.split(/\s+/).map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase();
    var hue = 0;
    for (var i = 0; i < n.length; i++) hue = (hue + n.charCodeAt(i)) % 360;
    return '<span class="inline-flex w-6 h-6 rounded-full text-white items-center justify-center text-[10px] font-bold" style="background: hsl(' + hue + ',55%,45%)">' + initials + '</span>';
  }

  function slaState(d) {
    if (!d) return { cls: 'ok', label: '—', remainingMs: null };
    var diff = new Date(d) - Date.now();
    if (diff < 0) return { cls: 'late', label: 'dépassé', remainingMs: diff };
    if (diff < 24 * 3600 * 1000) return { cls: 'warn', label: '< 24h', remainingMs: diff };
    return { cls: 'ok', label: Math.round(diff / (24 * 3600 * 1000)) + 'j', remainingMs: diff };
  }

  // ============================================================
  // DASHBOARD
  // ============================================================
  if (document.getElementById('sav-kpi-grid')) {
    var qs = CURRENT_USER_ID ? '?userId=' + encodeURIComponent(CURRENT_USER_ID) : '';
    api('/dashboard' + qs).then(function (res) {
      if (!res.ok || !res.j.success) {
        var err = document.getElementById('sav-dashboard-error');
        if (err) { err.textContent = res.j.error || 'Erreur de chargement.'; err.classList.remove('hidden'); }
        return;
      }
      var d = res.j.data;
      document.querySelectorAll('[data-kpi]').forEach(function (card) {
        var k = card.getAttribute('data-kpi');
        var v = d[k];
        if (v == null) v = 0;
        var money = card.getAttribute('data-kpi-money') === '1';
        var pct = card.getAttribute('data-kpi-pct') === '1';
        var unit = card.getAttribute('data-kpi-unit') || '';
        var display = String(v);
        if (money) display = Number(v).toLocaleString('fr-FR') + ' €';
        else if (pct) display = v + ' %';
        else if (unit) display = v + ' ' + unit;
        var el = card.querySelector('[data-kpi-value]');
        if (el) el.textContent = display;
      });

      // Click → liste filtrée
      document.querySelectorAll('[data-kpi]').forEach(function (card) {
        card.addEventListener('click', function () {
          var f = card.getAttribute('data-kpi-filter');
          if (f) window.location.href = '/admin/sav/tickets' + f;
        });
      });

      // Chart.js
      if (window.Chart && d.chart) {
        var ctx = document.getElementById('sav-chart');
        if (ctx) {
          new window.Chart(ctx, {
            type: 'line',
            data: {
              labels: d.chart.labels,
              datasets: [
                {
                  label: 'Ouverts',
                  data: d.chart.ouverts,
                  borderColor: '#0ea5e9',
                  backgroundColor: 'rgba(14,165,233,0.10)',
                  tension: 0.3,
                  fill: true,
                },
                {
                  label: 'Clos',
                  data: d.chart.clos,
                  borderColor: '#10b981',
                  backgroundColor: 'rgba(16,185,129,0.10)',
                  tension: 0.3,
                  fill: true,
                },
              ],
            },
            options: {
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
              },
            },
          });
        }
      }
    });

    // Liste prioritaire
    api('/tickets?sla_depasse=true&perPage=10').then(function (res) {
      var box = document.getElementById('sav-priority-list');
      if (!box) return;
      if (!res.ok || !res.j.success) { box.innerHTML = '<div class="px-5 py-6 text-sm text-red-700">Erreur de chargement.</div>'; return; }
      var list = res.j.data.tickets || [];
      if (!list.length) { box.innerHTML = '<div class="px-5 py-8 text-center text-sm text-slate-500">Aucun dossier en retard 🎉</div>'; return; }
      box.innerHTML = list.map(function (t) {
        return '<a class="flex items-center justify-between px-5 py-3 hover:bg-slate-50 sav-pulse-row" href="/admin/sav/tickets/' + encodeURIComponent(t.numero) + '">' +
          '<div><div class="font-mono text-sm font-semibold text-slate-900">' + escapeHtml(t.numero) + '</div>' +
          '<div class="text-xs text-slate-500">' + escapeHtml(t.client && t.client.email) + ' · ' + escapeHtml(t.pieceType) + '</div></div>' +
          '<div class="sav-sla-badge sav-sla-badge--late">en retard</div></a>';
      }).join('');
    });
  }

  // ============================================================
  // LISTE TICKETS (refonte)
  // ============================================================
  if (document.getElementById('sav-tickets-tbody')) {
    var tbody = document.getElementById('sav-tickets-tbody');
    var form = document.getElementById('sav-filters');
    var state = { page: 1, perPage: 20, sort: 'createdAt', dir: 'desc', search: '' };
    var teamCache = [];
    var selected = new Set();

    function buildQs() {
      var fd = new FormData(form);
      var qs = new URLSearchParams();
      fd.forEach(function (v, k) { if (v && k !== 'assignedToMe') qs.append(k, v); });
      qs.append('page', state.page);
      qs.append('perPage', state.perPage);
      qs.append('sort', state.sort);
      qs.append('dir', state.dir);
      if (fd.get('assignedToMe') === 'true' && CURRENT_USER_ID) qs.append('assignedToUserId', CURRENT_USER_ID);
      return qs;
    }

    function load() {
      tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-10 text-center text-slate-500">Chargement…</td></tr>';
      var qs = buildQs();
      api('/tickets?' + qs.toString()).then(function (res) {
        if (!res.ok || !res.j.success) {
          var err = document.getElementById('sav-tickets-error');
          err.textContent = (res.j && res.j.error) || 'Erreur de chargement.';
          err.classList.remove('hidden');
          tbody.innerHTML = '';
          return;
        }
        var data = res.j.data;
        var list = data.tickets || [];
        if (!list.length) {
          tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-10 text-center text-slate-500">Aucun ticket.</td></tr>';
          updatePagination(data);
          return;
        }
        // Vue cards mobile (rendue en parallèle au tbody desktop)
        var cardsBox = document.getElementById('sav-tickets-cards');
        if (cardsBox) {
          cardsBox.innerHTML = list.map(function (t) {
            var sla2 = slaState(t.sla && t.sla.dateLimite);
            var v2 = t.vehicule || {};
            var vstr2 = [v2.marque, v2.modele].filter(Boolean).join(' ') + (v2.annee ? ' ' + v2.annee : '');
            return '<a href="/admin/sav/tickets/' + encodeURIComponent(t.numero) + '" class="block p-4 hover:bg-slate-50 ' + (sla2.cls === 'late' ? 'sav-pulse-row' : '') + '">' +
              '<div class="flex items-center justify-between mb-1">' +
                '<span class="font-mono font-bold text-sm">' + escapeHtml(t.numero) + '</span>' +
                '<span class="sav-sla-badge sav-sla-badge--' + sla2.cls + '">' + sla2.label + '</span>' +
              '</div>' +
              '<div class="text-xs text-slate-700 truncate">' + escapeHtml((t.client && t.client.email) || '') + '</div>' +
              '<div class="mt-1 flex items-center gap-2 flex-wrap">' + pieceBadge(t.pieceType) +
                '<span class="px-2 py-0.5 rounded-full text-[11px] bg-slate-100">' + escapeHtml(t.statut) + '</span>' +
              '</div>' +
              (vstr2 ? '<div class="mt-1 text-[11px] text-slate-500">🚗 ' + escapeHtml(vstr2) + (v2.vin ? ' · ' + escapeHtml(v2.vin) : '') + '</div>' : '') +
              (t.assignedToName ? '<div class="mt-1 text-[11px] text-slate-500 flex items-center gap-1">' + avatar(t.assignedToName) + escapeHtml(t.assignedToName) + '</div>' : '') +
              '<div class="mt-1 text-[10px] text-slate-400">' + new Date(t.createdAt).toLocaleDateString('fr-FR') + '</div>' +
            '</a>';
          }).join('') || '<div class="p-6 text-center text-slate-500 text-sm">Aucun ticket.</div>';
        }

        tbody.innerHTML = list.map(function (t, i) {
          var sla = slaState(t.sla && t.sla.dateLimite);
          var rowPulse = sla.cls === 'late' || (sla.remainingMs != null && sla.remainingMs < 24 * 3600 * 1000) ? 'sav-pulse-row' : '';
          var v = t.vehicule || {};
          var vstr = [v.marque, v.modele].filter(Boolean).join(' ') + (v.annee ? ' ' + v.annee : '');
          return '<tr class="hover:bg-slate-50 cursor-pointer ' + rowPulse + '" data-row="' + i + '" data-numero="' + escapeHtml(t.numero) + '">' +
            '<td class="px-3 py-2"><input type="checkbox" class="rounded sav-row-cb" data-numero="' + escapeHtml(t.numero) + '" ' + (selected.has(t.numero) ? 'checked' : '') + '></td>' +
            '<td class="px-3 py-2 font-mono text-xs font-semibold">' + escapeHtml(t.numero) + '</td>' +
            '<td class="px-3 py-2"><div class="text-xs">' + escapeHtml((t.client && t.client.nom) || '') + '</div><div class="text-[10px] text-slate-500">' + escapeHtml((t.client && t.client.email) || '') + '</div></td>' +
            '<td class="px-3 py-2">' + pieceBadge(t.pieceType) + '</td>' +
            '<td class="px-3 py-2 text-xs">' + (vstr ? escapeHtml(vstr) : '<span class="text-slate-400">—</span>') + (v.vin ? '<div class="text-[10px] font-mono text-slate-400">' + escapeHtml(v.vin) + '</div>' : '') + '</td>' +
            '<td class="px-3 py-2"><div class="flex items-center gap-1">' + avatar(t.assignedToName) + '<span class="text-[11px]">' + escapeHtml(t.assignedToName || '—') + '</span></div></td>' +
            '<td class="px-3 py-2"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100">' + escapeHtml(t.statut) + '</span></td>' +
            '<td class="px-3 py-2"><span class="sav-sla-badge sav-sla-badge--' + sla.cls + '">' + sla.label + '</span></td>' +
            '<td class="px-3 py-2 text-xs text-slate-500">' + new Date(t.createdAt).toLocaleDateString('fr-FR') + '</td>' +
          '</tr>';
        }).join('');
        updatePagination(data);
        bindRows();
        updateSortIcons();
      });
    }

    function updatePagination(data) {
      document.getElementById('sav-pagination-info').textContent = (data.total || 0) + ' ticket(s) au total';
      document.getElementById('sav-page-current').textContent = data.page || 1;
      document.getElementById('sav-page-total').textContent = data.totalPages || 1;
      document.getElementById('sav-page-prev').disabled = (data.page || 1) <= 1;
      document.getElementById('sav-page-next').disabled = (data.page || 1) >= (data.totalPages || 1);
    }

    function updateSortIcons() {
      document.querySelectorAll('[data-sort]').forEach(function (h) {
        var k = h.getAttribute('data-sort');
        var icon = h.querySelector('[data-sort-icon]');
        if (!icon) return;
        if (state.sort === k) icon.textContent = state.dir === 'asc' ? '▲' : '▼';
        else icon.textContent = '⇅';
      });
    }

    var rowIdx = -1;
    function bindRows() {
      var rows = tbody.querySelectorAll('[data-row]');
      rows.forEach(function (r) {
        r.addEventListener('click', function (e) {
          if (e.target.matches('.sav-row-cb')) return;
          window.location.href = '/admin/sav/tickets/' + encodeURIComponent(r.getAttribute('data-numero'));
        });
      });
      tbody.querySelectorAll('.sav-row-cb').forEach(function (cb) {
        cb.addEventListener('click', function (e) {
          e.stopPropagation();
          var n = cb.getAttribute('data-numero');
          if (cb.checked) selected.add(n); else selected.delete(n);
          updateBulkBar();
        });
      });
    }

    function updateBulkBar() {
      var bar = document.getElementById('sav-bulk-bar');
      var c = document.getElementById('sav-bulk-count');
      if (!bar) return;
      bar.classList.toggle('hidden', selected.size === 0);
      bar.classList.toggle('flex', selected.size > 0);
      if (c) c.textContent = String(selected.size);
    }

    // Tri
    document.querySelectorAll('[data-sort]').forEach(function (h) {
      h.addEventListener('click', function () {
        var k = h.getAttribute('data-sort');
        if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.sort = k; state.dir = 'asc'; }
        state.page = 1; load();
      });
    });

    // Pagination
    document.getElementById('sav-page-prev').addEventListener('click', function () { if (state.page > 1) { state.page--; load(); } });
    document.getElementById('sav-page-next').addEventListener('click', function () { state.page++; load(); });

    // Sélection globale
    var allCb = document.getElementById('sav-bulk-all');
    if (allCb) allCb.addEventListener('change', function () {
      tbody.querySelectorAll('.sav-row-cb').forEach(function (cb) {
        cb.checked = allCb.checked;
        var n = cb.getAttribute('data-numero');
        if (allCb.checked) selected.add(n); else selected.delete(n);
      });
      updateBulkBar();
    });

    // Bulk actions
    document.getElementById('sav-bulk-statut-apply').addEventListener('click', function () {
      var st = document.getElementById('sav-bulk-statut').value;
      if (!st || !selected.size) return;
      if (!confirm('Passer ' + selected.size + ' ticket(s) au statut "' + st + '" ?')) return;
      var arr = Array.from(selected);
      Promise.all(arr.map(function (n) {
        return api('/tickets/' + encodeURIComponent(n) + '/statut', { method: 'PATCH', body: JSON.stringify({ statut: st, auteur: 'admin' }) });
      })).then(function () {
        toast(arr.length + ' tickets mis à jour', 'success');
        selected.clear(); updateBulkBar(); load();
      });
    });
    document.getElementById('sav-bulk-assign-apply').addEventListener('click', function () {
      var uid = document.getElementById('sav-bulk-assign').value;
      if (!uid || !selected.size) return;
      var arr = Array.from(selected);
      Promise.all(arr.map(function (n) {
        return api('/tickets/' + encodeURIComponent(n) + '/assign', { method: 'POST', body: JSON.stringify({ userId: uid }) });
      })).then(function () { toast('Assignations OK', 'success'); selected.clear(); updateBulkBar(); load(); });
    });
    document.getElementById('sav-bulk-export').addEventListener('click', function () {
      // Export = juste un CSV des sélectionnés (en pratique on filtre côté csv)
      window.open('/admin/api/sav/tickets.csv?' + buildQs().toString(), '_blank');
    });

    // Recherche debounce + suggestions (locale, basée sur l'API)
    var searchInput = document.getElementById('sav-search');
    var searchTimer;
    if (searchInput) searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.page = 1;
        load();
      }, 250);
    });

    form.addEventListener('submit', function (e) { e.preventDefault(); state.page = 1; load(); });
    form.addEventListener('change', function () { state.page = 1; load(); });

    // CSV export
    var csvBtn = document.getElementById('sav-export-csv');
    if (csvBtn) csvBtn.addEventListener('click', function (e) {
      e.preventDefault();
      window.open('/admin/api/sav/tickets.csv?' + buildQs().toString(), '_blank');
    });

    // Charge équipe pour bulk assign
    api('/team').then(function (res) {
      if (!res.ok || !res.j.success) return;
      teamCache = res.j.data.users || [];
      var ba = document.getElementById('sav-bulk-assign');
      if (ba) {
        ba.innerHTML = '<option value="">— Assigner à —</option>' +
          teamCache.map(function (u) { return '<option value="' + u._id + '">' + escapeHtml((u.firstName || '') + ' ' + (u.lastName || '')) + '</option>'; }).join('');
      }
    });

    // Raccourcis clavier
    var kbdModal = document.getElementById('sav-kbd-modal');
    function openKbd() { if (kbdModal) { kbdModal.classList.remove('hidden'); kbdModal.classList.add('flex'); } }
    function closeKbd() { if (kbdModal) { kbdModal.classList.add('hidden'); kbdModal.classList.remove('flex'); } }
    if (kbdModal) kbdModal.addEventListener('click', function (e) { if (e.target === kbdModal || e.target.matches('[data-close-kbd]')) closeKbd(); });

    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input,textarea,select')) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      var rows = tbody.querySelectorAll('[data-row]');
      if (e.key === '/') { e.preventDefault(); searchInput && searchInput.focus(); return; }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); openKbd(); return; }
      if (e.key === 'Escape') { closeKbd(); return; }
      if (!rows.length) return;
      if (e.key === 'j') { rowIdx = Math.min(rowIdx + 1, rows.length - 1); }
      else if (e.key === 'k') { rowIdx = Math.max(rowIdx - 1, 0); }
      else if (e.key === 'Enter' && rowIdx >= 0) {
        window.location.href = '/admin/sav/tickets/' + encodeURIComponent(rows[rowIdx].getAttribute('data-numero'));
        return;
      } else if (e.key === 'x' && rowIdx >= 0) {
        var cb = rows[rowIdx].querySelector('.sav-row-cb');
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('click', { bubbles: true })); }
        return;
      } else { return; }
      rows.forEach(function (r, i) { r.classList.toggle('bg-primary/10', i === rowIdx); });
      rows[rowIdx].scrollIntoView({ block: 'nearest' });
    });

    load();
  }

  // ============================================================
  // FICHE TICKET — refonte 2 col + tabs + assignation + WYSIWYG + diag enrichi + fournisseur
  // ============================================================
  var detailEl = document.querySelector('[data-sav-numero]');
  if (detailEl) {
    var numero = detailEl.getAttribute('data-sav-numero');
    var ticket = null;
    var teamUsers = [];

    function loadTicket() {
      api('/tickets/' + encodeURIComponent(numero)).then(function (res) {
        if (!res.ok || !res.j.success) {
          var err = document.getElementById('sav-detail-error');
          if (err) { err.textContent = res.j.error || 'Erreur de chargement.'; err.classList.remove('hidden'); }
          return;
        }
        ticket = res.j.data;
        renderHeader();
        renderDossier();
        renderTimeline();
        renderDocuments();
        renderMessages();
        renderPaiement();
        prefillDiagEnrichi();
        prefillFournisseur();
        renderPreview();
      });
    }

    // -------- Header sticky --------
    function renderHeader() {
      var meta = '';
      if (ticket.client) meta += escapeHtml((ticket.client.nom || '') + ' · ' + (ticket.client.email || ''));
      if (ticket.vehicule && ticket.vehicule.vin) meta += ' · VIN ' + escapeHtml(ticket.vehicule.vin);
      if (ticket.pieceType) meta += ' · ' + escapeHtml(ticket.pieceType);
      var hm = document.getElementById('sav-header-meta');
      if (hm) hm.textContent = meta;
      var sb = document.getElementById('sav-statut-badge');
      if (sb) sb.textContent = ticket.statut;

      var sla = document.getElementById('sav-sla-badge');
      var d = ticket.sla && ticket.sla.dateLimite;
      if (sla && d) {
        var diff = new Date(d) - Date.now();
        var cls = diff < 0 ? 'late' : diff < 24 * 3600 * 1000 ? 'warn' : 'ok';
        sla.className = 'sav-sla-badge sav-sla-badge--' + cls;
        sla.textContent = diff < 0 ? 'SLA dépassé' : 'SLA ' + fmtDuration(diff);
      }

      var assignLabel = document.getElementById('sav-assign-label');
      if (assignLabel) assignLabel.textContent = ticket.assignedToName ? ticket.assignedToName : 'Assigner';
    }

    // -------- Dossier --------
    function renderDossier() {
      var box = document.getElementById('sav-dossier');
      if (!box) return;
      var t = ticket || {};
      var v = t.vehicule || {};
      var g = t.garage || {};
      var m = t.montage || {};
      var diag = t.diagnostic || {};
      var cgv = t.cgvAcceptance || {};
      var rgpd = t.rgpdAcceptance || {};

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
        (v.marque || v.modele) ? '<div><strong>Modèle&nbsp;:</strong> ' + escapeHtml([v.marque, v.modele, v.annee].filter(Boolean).join(' ')) + '</div>' : '',
        v.motorisation ? '<div><strong>Motorisation&nbsp;:</strong> ' + escapeHtml(v.motorisation) + '</div>' : '',
        v.kilometrage ? '<div><strong>Kilométrage&nbsp;:</strong> ' + escapeHtml(v.kilometrage) + ' km</div>' : '',
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
        ? diag.symptomes.map(function (s) { return '<span class="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-900 mr-1 mb-1">' + escapeHtml(s) + '</span>'; }).join('')
        : '<span class="text-slate-400 text-sm">Aucun symptôme coché</span>';

      var codesBlock = (diag.codesDefaut && diag.codesDefaut.length)
        ? diag.codesDefaut.map(function (c) { return '<button type="button" data-copy-code="' + escapeHtml(c) + '" class="inline-block px-2 py-0.5 rounded text-xs bg-slate-900 text-white font-mono mr-1 mb-1 hover:bg-primary cursor-pointer" title="Cliquer pour copier">' + escapeHtml(c) + '</button>'; }).join('')
        : '<span class="text-slate-400 text-sm">Aucun</span>';

      var descrBlock = diag.description
        ? '<blockquote class="border-l-4 border-primary/40 bg-slate-50 px-3 py-2 text-sm italic text-slate-700">' + escapeHtml(diag.description) + '</blockquote>'
        : '<span class="text-slate-400 text-sm">Pas de description libre</span>';

      var cgvBlock = cgv.acceptedAt
        ? '<div class="text-xs text-slate-700 space-y-0.5">' +
          '<div>Version CGV : <strong>' + escapeHtml(cgv.version || 'v1') + '</strong></div>' +
          '<div>Acceptée : ' + new Date(cgv.acceptedAt).toLocaleString('fr-FR') + '</div>' +
          (cgv.ip ? '<div>IP : <span class="font-mono">' + escapeHtml(cgv.ip) + '</span></div>' : '') +
          (cgv.userAgent ? '<div class="text-[10px] text-slate-500 truncate">UA : ' + escapeHtml((cgv.userAgent || '').slice(0, 80)) + '</div>' : '') +
          (cgv.pdfUrl ? '<div class="mt-1"><a href="' + escapeHtml(cgv.pdfUrl) + '" target="_blank" rel="noopener" class="text-primary underline">📄 Justificatif PDF</a></div>' : '') +
          (rgpd.acceptedAt ? '<div class="mt-2 pt-2 border-t border-slate-100"><strong>RGPD :</strong> accepté le ' + new Date(rgpd.acceptedAt).toLocaleString('fr-FR') + '</div>' : '') +
          '</div>'
        : '<span class="text-slate-400 text-xs">Non horodaté</span>';

      box.innerHTML =
        '<details open class="rounded-xl border border-slate-200 bg-white p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-700">Commande liée</summary><div class="mt-2 text-sm">' + commandeBlock + '</div></details>' +
        '<details open class="rounded-xl border border-slate-200 bg-white p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-700">Véhicule</summary><div class="mt-2 text-sm space-y-1">' + vehiculeBlock + '</div></details>' +
        '<details open class="rounded-xl border border-slate-200 bg-white p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-700">Montage</summary><div class="mt-2 text-sm space-y-1">' + montageBlock + '</div></details>' +
        '<details open class="rounded-xl border border-slate-200 bg-white p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-700">Symptômes</summary><div class="mt-2">' + symptomesBlock + '</div></details>' +
        '<details class="rounded-xl border border-slate-200 bg-white p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-700">Codes défaut OBD</summary><div class="mt-2">' + codesBlock + '</div></details>' +
        '<details class="rounded-xl border border-slate-200 bg-white p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-700">Description du client</summary><div class="mt-2">' + descrBlock + '</div></details>' +
        '<details class="rounded-xl border border-slate-200 bg-white p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-700">CGV / RGPD</summary><div class="mt-2">' + cgvBlock + '</div></details>';
    }

    function renderTimeline() {
      var box = document.getElementById('sav-timeline');
      if (!box) return;
      var msgs = (ticket.messages || []).slice().reverse();
      if (!msgs.length) { box.innerHTML = '<div class="text-sm text-slate-500">Aucun événement.</div>'; return; }
      box.innerHTML = msgs.map(function (m) {
        var auto = /🤖|systeme/.test(m.contenu) || m.auteur === 'systeme';
        return '<div class="sav-timeline__item">' +
          '<div class="sav-timeline__dot sav-timeline__dot--' + (auto ? 'auto' : 'fait') + '"></div>' +
          '<div class="text-xs text-slate-500">' + new Date(m.date).toLocaleString('fr-FR') + ' · ' + escapeHtml(m.canal) + ' · ' + escapeHtml(m.auteur) + (auto ? ' <span class="ml-1 text-orange-600">🤖 auto</span>' : '') + '</div>' +
          '<div class="text-sm text-slate-800">' + escapeHtml(m.contenu) + '</div>' +
        '</div>';
      }).join('');
    }

    function renderDocuments() {
      var box = document.getElementById('sav-documents');
      if (!box) return;
      var docs = [];
      if (Array.isArray(ticket.documentsList) && ticket.documentsList.length) docs = ticket.documentsList.slice();
      else {
        var d = ticket.documents || {};
        if (d.factureMontage) docs.push({ kind: 'factureMontage', url: d.factureMontage });
        (d.photosObd || []).forEach(function (u) { docs.push({ kind: 'photoObd', url: u }); });
        if (d.confirmationReglageBase) docs.push({ kind: 'confirmationReglageBase', url: d.confirmationReglageBase });
        (d.photosVisuelles || []).forEach(function (u) { docs.push({ kind: 'photoPiece', url: u }); });
      }
      if (!docs.length) {
        box.innerHTML = '<div class="col-span-full flex flex-col items-center justify-center py-10 text-center text-slate-500"><span class="material-symbols-outlined text-5xl text-slate-300">folder_off</span><div class="mt-2 text-sm font-medium">Aucun document.</div></div>';
        return;
      }
      box.innerHTML = docs.map(function (x) {
        var img = x.mime ? /^image\//i.test(x.mime) : /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(x.url || '');
        var thumb = img
          ? '<div class="aspect-video w-full overflow-hidden rounded-lg bg-slate-100"><img src="' + escapeHtml(x.url) + '" loading="lazy" class="w-full h-full object-cover"></div>'
          : '<div class="aspect-video w-full flex items-center justify-center rounded-lg bg-slate-100 text-slate-400"><span class="material-symbols-outlined text-5xl">picture_as_pdf</span></div>';
        var name = escapeHtml(x.originalName || (x.url || '').split('/').pop() || 'document');
        var meta = [];
        if (x.size) meta.push(fmtSize(x.size));
        if (x.uploadedAt) meta.push(new Date(x.uploadedAt).toLocaleDateString('fr-FR'));
        return '<div class="rounded-xl border border-slate-200 p-2 flex flex-col gap-2 bg-white">' + thumb +
          '<div class="text-xs font-semibold text-slate-700 truncate">' + escapeHtml(x.kind || 'doc') + '</div>' +
          '<div class="text-[11px] text-slate-500 truncate">' + name + '</div>' +
          (meta.length ? '<div class="text-[10px] text-slate-400">' + escapeHtml(meta.join(' · ')) + '</div>' : '') +
          '<div class="flex gap-1 mt-auto">' +
            '<a href="' + escapeHtml(x.url) + '" target="_blank" class="flex-1 text-center text-[11px] rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50">Ouvrir</a>' +
            '<a href="' + escapeHtml(x.url) + '" download class="flex-1 text-center text-[11px] rounded-lg bg-slate-900 text-white px-2 py-1">Télécharger</a>' +
          '</div></div>';
      }).join('');
    }

    function renderMessages() {
      var box = document.getElementById('sav-messages');
      if (!box) return;
      var msgs = ticket.messages || [];
      if (!msgs.length) { box.innerHTML = '<div class="text-sm text-slate-500">Aucun message.</div>'; return; }
      box.innerHTML = msgs.map(function (m) {
        return '<div class="rounded-xl border border-slate-200 p-2 text-sm"><div class="text-xs text-slate-500">' + new Date(m.date).toLocaleString('fr-FR') + ' · ' + escapeHtml(m.canal) + ' · ' + escapeHtml(m.auteur) + '</div><div>' + escapeHtml(m.contenu) + '</div></div>';
      }).join('');
    }

    function renderPaiement() {
      var box = document.getElementById('sav-paiement');
      if (!box) return;
      var p = ticket.paiements && ticket.paiements.facture149;
      if (!p || !p.status || p.status === 'na') { box.innerHTML = '<span class="text-slate-400">Non applicable</span>'; return; }
      var statusColor = p.status === 'payee' ? 'bg-emerald-100 text-emerald-800' : p.status === 'impayee' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
      box.innerHTML =
        '<div class="space-y-2">' +
          '<div><span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ' + statusColor + '">' + escapeHtml(p.status) + '</span></div>' +
          (p.qontoInvoiceId ? '<div class="text-xs"><strong>Qonto :</strong> ' + (p.qontoInvoiceUrl ? '<a class="text-primary underline" target="_blank" href="' + escapeHtml(p.qontoInvoiceUrl) + '">' + escapeHtml(p.qontoInvoiceId) + '</a>' : escapeHtml(p.qontoInvoiceId)) + '</div>' : '') +
          (p.qontoPdfUrl ? '<div><a class="text-xs text-primary underline" target="_blank" href="' + escapeHtml(p.qontoPdfUrl) + '">📄 Facture PDF</a></div>' : '') +
          (p.mollieId ? '<div class="text-xs text-slate-500"><strong>Mollie :</strong> ' + escapeHtml(p.mollieId) + '</div>' : '') +
          (p.paymentUrl ? '<div><a class="text-xs text-primary underline" target="_blank" href="' + escapeHtml(p.paymentUrl) + '">🔗 Lien de paiement</a></div>' : '') +
          (p.dateGeneration ? '<div class="text-[10px] text-slate-400">Généré : ' + new Date(p.dateGeneration).toLocaleString('fr-FR') + '</div>' : '') +
          (p.datePaiement ? '<div class="text-[10px] text-emerald-700">✓ Payé : ' + new Date(p.datePaiement).toLocaleString('fr-FR') + '</div>' : '') +
        '</div>';
    }

    function prefillDiagEnrichi() {
      var f = document.getElementById('sav-diag-enrichi-form');
      if (!f) return;
      var d = (ticket.diagnosticEnrichi || {});
      var m = d.mesures || {};
      ['pressionHydraulique','fuiteInterne','temperatureAvant','temperatureApres'].forEach(function (k) {
        if (f.elements[k] != null) f.elements[k].value = m[k] != null ? m[k] : '';
      });
      if (f.elements.codesAvantReset) f.elements.codesAvantReset.value = (m.codesAvantReset || []).join(', ');
      if (f.elements.codesApresReset) f.elements.codesApresReset.value = (m.codesApresReset || []).join(', ');
      if (f.elements.videoUrl) f.elements.videoUrl.value = d.videoUrl || '';
      if (f.elements.courbeBancUrl) f.elements.courbeBancUrl.value = d.courbeBancUrl || '';
      if (f.elements.avis2eTechnicienTexte) f.elements.avis2eTechnicienTexte.value = d.avis2eTechnicienTexte || '';
      var sc = document.getElementById('sav-diag-score');
      if (sc) sc.textContent = d.scoreCalcule != null ? d.scoreCalcule : '—';
    }

    function prefillFournisseur() {
      var f = document.getElementById('sav-fourn-form');
      if (!f) return;
      var fo = ticket.fournisseur || {};
      ['nom','contact','rmaNumero','transporteur','colisNumero','trackingUrl','rapportUrl','reponse'].forEach(function (k) {
        if (f.elements[k] != null) f.elements[k].value = fo[k] || '';
      });
      if (f.elements.coutAnalyse) f.elements.coutAnalyse.value = fo.coutAnalyse || '';
      if (f.elements.coutRefacture) f.elements.coutRefacture.value = fo.coutRefacture || '';
      if (f.elements.dateEnvoi && fo.dateEnvoi) f.elements.dateEnvoi.value = new Date(fo.dateEnvoi).toISOString().slice(0,10);
      if (f.elements.dateRetour && fo.dateRetour) f.elements.dateRetour.value = new Date(fo.dateRetour).toISOString().slice(0,10);
    }

    // -------- Onglets --------
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-tab');
        document.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-tab') === k); });
        document.querySelectorAll('[data-tab-panel]').forEach(function (x) { x.classList.toggle('hidden', x.getAttribute('data-tab-panel') !== k); });
      });
    });

    // -------- Templates + variables + WYSIWYG + preview --------
    var TEMPLATES = {
      reception: 'Bonjour {client_prenom},\n\nNous avons bien reçu votre pièce ({piece_type}) à notre atelier. L\'analyse sur banc démarrera dans les jours qui viennent.\n\nDossier : {ticket_numero}',
      analyse_ok: 'Bonjour {client_prenom},\n\nBonne nouvelle : notre analyse confirme un défaut produit sur votre {piece_type}. Nous allons procéder à l\'échange/remboursement.\n\nDossier : {ticket_numero}',
      analyse_neg: 'Bonjour {client_prenom},\n\nNotre rapport d\'analyse est terminé. La pièce {piece_type} ne présente pas de défaut produit : un forfait de 149 € TTC vous sera facturé conformément aux CGV SAV.\n\nDossier : {ticket_numero}',
      relance_doc: 'Bonjour {client_prenom},\n\nPour traiter votre dossier {ticket_numero}, nous avons besoin de la facture du garage {garage_nom} et de la confirmation du réglage de base.',
      rdv: 'Bonjour {client_prenom},\n\nPouvez-vous nous confirmer le rendez-vous {rendez_vous_date} pour la prise en charge de votre dossier {ticket_numero} ?',
    };
    function interpolate(text) {
      if (!ticket) return text;
      var c = ticket.client || {};
      var prenom = (c.nom || c.email || '').split(' ')[0];
      return String(text || '')
        .replace(/{client_prenom}/g, escapeHtml(prenom))
        .replace(/{ticket_numero}/g, escapeHtml(ticket.numero || ''))
        .replace(/{piece_type}/g, escapeHtml(ticket.pieceType || ''))
        .replace(/{garage_nom}/g, escapeHtml((ticket.garage && ticket.garage.nom) || ''))
        .replace(/{rendez_vous_date}/g, '[à compléter]');
    }

    var editor = document.getElementById('sav-msg-editor');
    function syncContenu() {
      if (!editor) return;
      var html = editor.innerHTML;
      document.getElementById('sav-msg-html').value = html;
      document.getElementById('sav-msg-contenu').value = editor.innerText;
      renderPreview();
    }
    function renderPreview() {
      var preview = document.getElementById('sav-msg-preview');
      if (!preview || !editor) return;
      preview.innerHTML = interpolate(editor.innerHTML.replace(/&nbsp;/g, ' '));
    }
    if (editor) {
      editor.addEventListener('input', syncContenu);
      document.querySelectorAll('[data-cmd]').forEach(function (b) {
        b.addEventListener('click', function () {
          document.execCommand(b.getAttribute('data-cmd'), false, null);
          editor.focus(); syncContenu();
        });
      });
      var linkBtn = document.querySelector('[data-cmd-link]');
      if (linkBtn) linkBtn.addEventListener('click', function () {
        var url = window.prompt('URL ?', 'https://');
        if (url) { document.execCommand('createLink', false, url); syncContenu(); }
      });
    }
    var tplSelect = document.getElementById('sav-template');
    if (tplSelect) tplSelect.addEventListener('change', function (e) {
      var v = e.target.value;
      if (TEMPLATES[v] && editor) {
        editor.innerHTML = TEMPLATES[v].split('\n').map(function (l) { return '<div>' + escapeHtml(l) + '</div>'; }).join('');
        syncContenu();
      }
    });

    var msgForm = document.getElementById('sav-msg-form');
    if (msgForm) msgForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var canal = fd.get('canal') || 'email';
      var sujet = fd.get('sujet') || '';
      var contenu = interpolate(document.getElementById('sav-msg-contenu').value || '');
      var html = interpolate(document.getElementById('sav-msg-html').value || '');
      api('/tickets/' + encodeURIComponent(numero) + '/communication', {
        method: 'POST',
        body: JSON.stringify({ canal: canal, sujet: sujet, contenu: contenu, html: html }),
      }).then(function (res) {
        if (res.ok && res.j.success) {
          toast('Message envoyé via ' + canal);
          editor.innerHTML = '';
          syncContenu();
          loadTicket();
        } else toast(res.j.error || 'Erreur', 'error');
      });
    });

    // -------- Diagnostic (existant + enrichi) --------
    var diagForm = document.getElementById('sav-diag-form');
    if (diagForm) diagForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var payload = {
        conclusion: fd.get('conclusion'),
        rapport: fd.get('rapport'),
        scoreRisque: fd.get('scoreRisque') ? Number(fd.get('scoreRisque')) : undefined,
        codesDefaut: (fd.get('codesDefaut') || '').toString().split(/[,\s]+/).filter(Boolean),
      };
      api('/tickets/' + encodeURIComponent(numero) + '/diagnostic', { method: 'POST', body: JSON.stringify(payload) })
        .then(function (res) {
          if (res.ok && res.j.success) { toast('Diagnostic enregistré'); loadTicket(); }
          else toast(res.j.error || 'Erreur', 'error');
        });
    });

    var diagEnrichiForm = document.getElementById('sav-diag-enrichi-form');
    if (diagEnrichiForm) diagEnrichiForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var payload = {
        mesures: {
          pressionHydraulique: fd.get('pressionHydraulique') ? Number(fd.get('pressionHydraulique')) : undefined,
          fuiteInterne: fd.get('fuiteInterne'),
          temperatureAvant: fd.get('temperatureAvant') ? Number(fd.get('temperatureAvant')) : undefined,
          temperatureApres: fd.get('temperatureApres') ? Number(fd.get('temperatureApres')) : undefined,
          codesAvantReset: (fd.get('codesAvantReset') || '').toString().split(/[,\s]+/).filter(Boolean),
          codesApresReset: (fd.get('codesApresReset') || '').toString().split(/[,\s]+/).filter(Boolean),
        },
        videoUrl: fd.get('videoUrl'),
        courbeBancUrl: fd.get('courbeBancUrl'),
        avis2eTechnicienTexte: fd.get('avis2eTechnicienTexte'),
      };
      api('/tickets/' + encodeURIComponent(numero) + '/diagnostic-enrichi', { method: 'POST', body: JSON.stringify(payload) })
        .then(function (res) {
          if (res.ok && res.j.success) {
            toast('Diagnostic enrichi sauvegardé');
            var sc = document.getElementById('sav-diag-score');
            if (sc) sc.textContent = (res.j.data.diagnosticEnrichi && res.j.data.diagnosticEnrichi.scoreCalcule) || '—';
            loadTicket();
          } else toast(res.j.error || 'Erreur', 'error');
        });
    });

    // -------- Fournisseur --------
    var fournForm = document.getElementById('sav-fourn-form');
    if (fournForm) fournForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var payload = {};
      fd.forEach(function (v, k) { payload[k] = v; });
      payload.changeStatutToEnAttente = fd.get('changeStatutToEnAttente') === 'on';
      api('/tickets/' + encodeURIComponent(numero) + '/fournisseur', { method: 'POST', body: JSON.stringify(payload) })
        .then(function (res) {
          if (res.ok && res.j.success) { toast('Fournisseur sauvegardé'); loadTicket(); }
          else toast(res.j.error || 'Erreur', 'error');
        });
    });
    var trackBtn = document.getElementById('sav-fourn-track');
    if (trackBtn) trackBtn.addEventListener('click', function () {
      var url = (ticket && ticket.fournisseur && ticket.fournisseur.trackingUrl) || '';
      if (url) window.open(url, '_blank');
      else toast('Pas d\'URL de tracking enregistrée', 'error');
    });

    // -------- WhatsApp fournisseur (4.2) --------
    var waBtn = document.getElementById('sav-fourn-whatsapp');
    var waModal = document.getElementById('sav-wa-modal');
    var waPhone = document.getElementById('sav-wa-phone');
    var waText = document.getElementById('sav-wa-text');
    var waLink = document.getElementById('sav-wa-link');
    var waCopy = document.getElementById('sav-wa-copy');
    var waSend = document.getElementById('sav-wa-send');
    var waSaveReply = document.getElementById('sav-wa-save-reply');
    var waClientScript = document.getElementById('sav-wa-client-script');
    function openWa() {
      var phone = (ticket && ticket.fournisseur && ticket.fournisseur.contact) || '';
      api('/tickets/' + encodeURIComponent(numero) + '/whatsapp-fournisseur/preview?phone=' + encodeURIComponent(phone))
        .then(function (res) {
          if (!res.ok) { toast('Erreur preview', 'error'); return; }
          var d = res.j.data;
          waPhone.value = phone;
          waText.value = d.text || '';
          waClientScript.value = d.clientScript || '';
          waLink.href = d.waUrl || '#';
          waModal.classList.remove('hidden'); waModal.classList.add('flex');
        });
    }
    function closeWa() { if (waModal) { waModal.classList.add('hidden'); waModal.classList.remove('flex'); } }
    if (waBtn) waBtn.addEventListener('click', openWa);
    if (waModal) waModal.addEventListener('click', function (e) { if (e.target === waModal || e.target.matches('[data-close-wa]')) closeWa(); });
    if (waPhone) waPhone.addEventListener('input', function () {
      var clean = waPhone.value.replace(/[^\d]/g, '');
      waLink.href = clean ? 'https://wa.me/' + clean + '?text=' + encodeURIComponent(waText.value) : '#';
    });
    if (waText) waText.addEventListener('input', function () {
      var clean = (waPhone.value || '').replace(/[^\d]/g, '');
      waLink.href = clean ? 'https://wa.me/' + clean + '?text=' + encodeURIComponent(waText.value) : '#';
    });
    if (waCopy) waCopy.addEventListener('click', function () {
      navigator.clipboard.writeText(waText.value).then(function () { toast('Texte copié'); });
    });
    if (waSend) waSend.addEventListener('click', function () {
      api('/tickets/' + encodeURIComponent(numero) + '/whatsapp-fournisseur/send', {
        method: 'POST', body: JSON.stringify({ phone: waPhone.value }),
      }).then(function (res) {
        if (res.ok && res.j.success) { toast('Envoi enregistré'); loadTicket(); }
        else toast(res.j.error || 'Erreur', 'error');
      });
    });
    if (waSaveReply) waSaveReply.addEventListener('click', function () {
      var reply = document.getElementById('sav-wa-reply').value;
      api('/tickets/' + encodeURIComponent(numero) + '/whatsapp-fournisseur/send', {
        method: 'POST', body: JSON.stringify({ phone: waPhone.value, parsedReply: reply }),
      }).then(function (res) {
        if (res.ok && res.j.success) { toast('Réponse enregistrée'); closeWa(); loadTicket(); }
        else toast(res.j.error || 'Erreur', 'error');
      });
    });

    // -------- Actions sidebar --------
    function withConfirm(btn, action) {
      var msg = btn.getAttribute('data-confirm');
      if (!msg) return action();
      var modal = document.getElementById('sav-confirm-modal');
      var text = document.getElementById('sav-confirm-text');
      var ok = document.getElementById('sav-confirm-ok');
      var cancel = document.getElementById('sav-confirm-cancel');
      if (!modal) { if (window.confirm(msg)) action(); return; }
      text.textContent = msg;
      modal.classList.remove('hidden'); modal.classList.add('flex');
      function close() { modal.classList.add('hidden'); modal.classList.remove('flex'); ok.removeEventListener('click', go); cancel.removeEventListener('click', close); }
      function go() { close(); action(); }
      ok.addEventListener('click', go);
      cancel.addEventListener('click', close);
    }

    document.querySelectorAll('[data-action-statut]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var statut = btn.getAttribute('data-action-statut');
        withConfirm(btn, function () {
          api('/tickets/' + encodeURIComponent(numero) + '/statut', { method: 'PATCH', body: JSON.stringify({ statut: statut, auteur: 'admin' }) })
            .then(function (res) { if (res.ok && res.j.success) { toast('Statut → ' + statut); loadTicket(); } else toast(res.j.error || 'Erreur', 'error'); });
        });
      });
    });
    document.querySelectorAll('[data-action-resolution]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.getAttribute('data-action-resolution');
        api('/tickets/' + encodeURIComponent(numero) + '/resolution', { method: 'POST', body: JSON.stringify({ type: type }) })
          .then(function (res) { if (res.ok && res.j.success) { toast('Résolution : ' + type); loadTicket(); } else toast(res.j.error || 'Erreur', 'error'); });
      });
    });
    var fact = document.querySelector('[data-action-facturer]');
    if (fact) fact.addEventListener('click', function () {
      withConfirm(fact, function () {
        api('/tickets/' + encodeURIComponent(numero) + '/facturer-149', { method: 'POST' })
          .then(function (res) {
            if (res.ok && res.j.success) {
              toast('Lien de paiement généré');
              if (res.j.data.paymentUrl) window.open(res.j.data.paymentUrl, '_blank');
              loadTicket();
            } else toast(res.j.error || 'Erreur', 'error');
          });
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

    // -------- Assignation --------
    var assignBtn = document.getElementById('sav-assign-btn');
    var assignModal = document.getElementById('sav-assign-modal');
    var assignSelect = document.getElementById('sav-assign-select');
    function openAssign() {
      api('/team').then(function (res) {
        if (!res.ok || !res.j.success) return;
        teamUsers = res.j.data.users || [];
        assignSelect.innerHTML = '<option value="">— Désassigner —</option>' +
          teamUsers.map(function (u) { return '<option value="' + u._id + '"' + (ticket && String(ticket.assignedToUserId) === String(u._id) ? ' selected' : '') + '>' + escapeHtml((u.firstName || '') + ' ' + (u.lastName || '')) + '</option>'; }).join('');
        assignModal.classList.remove('hidden'); assignModal.classList.add('flex');
      });
    }
    function closeAssign() { assignModal.classList.add('hidden'); assignModal.classList.remove('flex'); }
    if (assignBtn) assignBtn.addEventListener('click', openAssign);
    if (assignModal) assignModal.addEventListener('click', function (e) { if (e.target === assignModal || e.target.matches('[data-close-assign]')) closeAssign(); });
    var assignConfirm = document.getElementById('sav-assign-confirm');
    if (assignConfirm) assignConfirm.addEventListener('click', function () {
      var uid = assignSelect.value || null;
      api('/tickets/' + encodeURIComponent(numero) + '/assign', { method: 'POST', body: JSON.stringify({ userId: uid }) })
        .then(function (res) {
          if (res.ok && res.j.success) { closeAssign(); toast(uid ? ('Assigné à ' + res.j.data.assignedToName) : 'Désassigné'); loadTicket(); }
          else toast(res.j.error || 'Erreur', 'error');
        });
    });

    // -------- Modale aide raccourcis --------
    var helpBtn = document.getElementById('sav-help-btn');
    var kbdModal = document.getElementById('sav-kbd-modal');
    function openKbd() { if (kbdModal) { kbdModal.classList.remove('hidden'); kbdModal.classList.add('flex'); } }
    function closeKbd() { if (kbdModal) { kbdModal.classList.add('hidden'); kbdModal.classList.remove('flex'); } }
    if (helpBtn) helpBtn.addEventListener('click', openKbd);
    if (kbdModal) kbdModal.addEventListener('click', function (e) { if (e.target === kbdModal || e.target.matches('[data-close-kbd]')) closeKbd(); });

    // Raccourcis fiche
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input,textarea,select,[contenteditable]')) return;
      if (e.key >= '1' && e.key <= '6') {
        var tabs = document.querySelectorAll('[data-tab]');
        var idx = parseInt(e.key, 10) - 1;
        if (tabs[idx]) tabs[idx].click();
      }
      if (e.key === 'a') { openAssign(); }
      if (e.key === 'e') { var c = document.querySelector('#sav-diag-form [name="conclusion"]'); if (c) { document.querySelector('[data-tab="diagnostic"]').click(); c.focus(); } }
      if (e.key === 's') { var b = document.querySelector('[data-action-statut]'); if (b) b.focus(); }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); openKbd(); }
      if (e.key === 'Escape') {
        document.querySelectorAll('.flex.fixed.inset-0').forEach(function (m) { m.classList.add('hidden'); m.classList.remove('flex'); });
      }
    });

    // Copier code OBD
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy-code]');
      if (!b) return;
      var code = b.getAttribute('data-copy-code');
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast(code + ' copié'); });
      else toast(code);
    });

    loadTicket();
  }

  // ============================================================
  // ANALYTICS PAGE (4.5)
  // ============================================================
  if (document.getElementById('ana-monthly')) {
    api('/analytics').then(function (res) {
      if (!res.ok) { document.getElementById('sav-analytics-error').classList.remove('hidden'); return; }
      var d = res.j.data;
      // KPI top
      document.getElementById('ana-ca-recup').textContent = (d.financier.caRecupere || 0).toLocaleString('fr-FR') + ' €';
      document.getElementById('ana-cout-gar').textContent = (d.financier.coutGarantie || 0).toLocaleString('fr-FR') + ' €';
      document.getElementById('ana-balance').textContent = (d.financier.balance || 0).toLocaleString('fr-FR') + ' €';
      document.getElementById('ana-recidive').textContent = d.recidive.tauxRecidive + ' %';

      // Chart monthly
      if (window.Chart) {
        new window.Chart(document.getElementById('ana-monthly'), {
          type: 'bar',
          data: { labels: d.monthly.labels, datasets: [{ label: 'SAV', data: d.monthly.counts, backgroundColor: '#ec1313' }] },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
        });

        // Chart fournisseur (camembert : nb tickets par fournisseur, % défaut en tooltip)
        if (d.fournisseur && d.fournisseur.length) {
          new window.Chart(document.getElementById('ana-fournisseur'), {
            type: 'doughnut',
            data: {
              labels: d.fournisseur.map(function (f) { return f.nom + ' (' + f.taux + '% défaut)'; }),
              datasets: [{
                data: d.fournisseur.map(function (f) { return f.total; }),
                backgroundColor: ['#ec1313','#f97316','#f59e0b','#10b981','#0ea5e9','#6366f1','#a855f7','#ec4899'],
              }],
            },
            options: { responsive: true, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } },
          });
        } else {
          document.getElementById('ana-fournisseur-empty').classList.remove('hidden');
        }
      }

      // Top pieces table
      var topBody = document.getElementById('ana-top-pieces');
      if (topBody) topBody.innerHTML = (d.topPieces || []).map(function (p) {
        return '<tr class="border-t border-slate-100"><td class="py-1">' + escapeHtml(p._id) + '</td><td class="text-right py-1 font-mono">' + p.count + '</td></tr>';
      }).join('') || '<tr><td colspan="2" class="py-3 text-center text-slate-400">Aucune donnée</td></tr>';

      // Avg by type table
      var avgBody = document.getElementById('ana-avg-by-type');
      if (avgBody) avgBody.innerHTML = (d.avgByType || []).map(function (p) {
        return '<tr class="border-t border-slate-100"><td class="py-1">' + escapeHtml(p.pieceType) + '</td><td class="text-right py-1">' + p.avgDays + '</td><td class="text-right py-1 text-slate-400">' + p.count + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="py-3 text-center text-slate-400">Aucune donnée</td></tr>';

      // Departments
      var deptBox = document.getElementById('ana-departments');
      if (deptBox) deptBox.innerHTML = (d.departments || []).map(function (x) {
        return '<div class="rounded-lg border border-slate-200 px-2 py-2 text-center"><div class="font-mono font-bold text-sm">' + escapeHtml(x.dept) + '</div><div class="text-[10px] text-slate-500">' + x.count + ' SAV</div></div>';
      }).join('') || '<div class="col-span-full text-center text-slate-400 text-xs">Aucun code postal détecté dans les adresses garage.</div>';
    });

    var exp = document.getElementById('sav-analytics-export');
    if (exp) exp.addEventListener('click', function (e) {
      e.preventDefault();
      window.open('/admin/api/sav/analytics.csv', '_blank');
    });
  }

  // ============================================================
  // REPUTATION PAGE (4.4)
  // ============================================================
  if (document.getElementById('rep-private-tbody')) {
    api('/reputation').then(function (res) {
      if (!res.ok) return;
      var d = res.j.data;
      document.getElementById('rep-sent').textContent = d.sent || 0;
      document.getElementById('rep-completed').textContent = d.completed || 0;
      document.getElementById('rep-avg').textContent = d.avgNote ? d.avgNote + ' / 5' : '—';
      document.getElementById('rep-redirected').textContent = d.redirected || 0;
      var tb = document.getElementById('rep-private-tbody');
      var items = d.privateFeedbacks || [];
      tb.innerHTML = items.length
        ? items.map(function (t) {
            var rf = t.reviewFeedback || {};
            return '<tr><td class="px-4 py-2 text-xs text-slate-500">' + new Date(rf.completedAt).toLocaleString('fr-FR') + '</td>' +
              '<td class="px-4 py-2 font-mono text-xs"><a class="text-primary underline" href="/admin/sav/tickets/' + encodeURIComponent(t.numero) + '">' + escapeHtml(t.numero) + '</a></td>' +
              '<td class="px-4 py-2"><span class="text-amber-500">' + ('★'.repeat(rf.note || 0)) + '</span><span class="text-slate-300">' + ('★'.repeat(5 - (rf.note || 0))) + '</span></td>' +
              '<td class="px-4 py-2 text-xs">' + escapeHtml((rf.comment || '').slice(0, 200)) + '</td></tr>';
          }).join('')
        : '<tr><td colspan="4" class="px-4 py-6 text-center text-slate-400">Aucun feedback privé.</td></tr>';
    });
  }

  // ============================================================
  // INTEGRATIONS PAGE (4.3)
  // ============================================================
  if (document.getElementById('sav-integrations-form')) {
    var intForm = document.getElementById('sav-integrations-form');
    api('/settings').then(function (res) {
      if (!res.ok) return;
      var i = res.j.data.integrations || {};
      if (intForm.elements.slackWebhookUrl) intForm.elements.slackWebhookUrl.value = i.slackWebhookUrl || '';
      if (intForm.elements.slackChannel) intForm.elements.slackChannel.value = i.slackChannel || '#sav';
      if (intForm.elements.googleReviewsUrl) intForm.elements.googleReviewsUrl.value = i.googleReviewsUrl || '';
      if (intForm.elements.whatsappEnabled) intForm.elements.whatsappEnabled.checked = !!i.whatsappEnabled;
      if (intForm.elements.qontoEnabled) intForm.elements.qontoEnabled.checked = !!i.qontoEnabled;
    });
    intForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(intForm);
      var integrations = {
        slackWebhookUrl: fd.get('slackWebhookUrl') || '',
        slackChannel: fd.get('slackChannel') || '#sav',
        googleReviewsUrl: fd.get('googleReviewsUrl') || '',
        whatsappEnabled: fd.get('whatsappEnabled') === 'on',
        qontoEnabled: fd.get('qontoEnabled') === 'on',
      };
      api('/settings', { method: 'POST', body: JSON.stringify({ integrations: integrations }) }).then(function (res) {
        var fb = document.getElementById('sav-integrations-feedback');
        fb.classList.remove('hidden');
        if (res.ok && res.j.success) { fb.className = 'rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 p-3 text-sm'; fb.textContent = 'Intégrations sauvegardées.'; }
        else { fb.className = 'rounded-xl border border-red-200 bg-red-50 text-red-900 p-3 text-sm'; fb.textContent = (res.j && res.j.error) || 'Erreur'; }
      });
    });
  }

  // ============================================================
  // SETTINGS PAGE
  // ============================================================
  if (document.getElementById('sav-sla-grid')) {
    var slaGrid = document.getElementById('sav-sla-grid');
    var autoList = document.getElementById('sav-auto-list');
    var current = null;

    api('/settings').then(function (res) {
      if (!res.ok) return;
      current = res.j.data;
      slaGrid.innerHTML = (current.slaPerPiece || []).map(function (p, i) {
        return '<div class="rounded-xl border border-slate-200 p-3"><div class="text-xs font-semibold mb-1">' + escapeHtml(p.pieceType) + '</div>' +
          '<div class="flex items-center gap-2"><input type="number" min="1" max="60" value="' + p.days + '" data-sla-idx="' + i + '" class="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"><span class="text-xs text-slate-500">jours</span></div></div>';
      }).join('');
      autoList.innerHTML = (current.automationRules || []).map(function (r, i) {
        return '<div class="rounded-xl border border-slate-200 p-4">' +
          '<div class="flex items-start justify-between gap-3">' +
            '<div><div class="font-semibold text-sm">' + escapeHtml(r.key) + '</div><div class="text-xs text-slate-500 mt-1">' + escapeHtml(r.description || '') + '</div></div>' +
            '<label class="inline-flex items-center cursor-pointer"><input type="checkbox" data-auto-enabled="' + i + '" ' + (r.enabled ? 'checked' : '') + ' class="rounded text-primary"><span class="ml-2 text-xs">Activé</span></label>' +
          '</div>' +
          '<div class="mt-2 flex items-center gap-2"><label class="text-xs text-slate-600">Seuil :</label>' +
          '<input type="number" min="0" max="90" value="' + r.daysThreshold + '" data-auto-days="' + i + '" class="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm">' +
          '<span class="text-xs text-slate-500">jours</span></div>' +
        '</div>';
      }).join('');
    });

    document.getElementById('sav-settings-save').addEventListener('click', function () {
      if (!current) return;
      var slas = current.slaPerPiece.map(function (p, i) {
        var inp = document.querySelector('[data-sla-idx="' + i + '"]');
        return { pieceType: p.pieceType, days: inp ? Number(inp.value) : p.days };
      });
      var rules = current.automationRules.map(function (r, i) {
        var en = document.querySelector('[data-auto-enabled="' + i + '"]');
        var dy = document.querySelector('[data-auto-days="' + i + '"]');
        return { key: r.key, enabled: en ? en.checked : r.enabled, daysThreshold: dy ? Number(dy.value) : r.daysThreshold, description: r.description };
      });
      api('/settings', { method: 'POST', body: JSON.stringify({ slaPerPiece: slas, automationRules: rules }) })
        .then(function (res) {
          var fb = document.getElementById('sav-settings-feedback');
          fb.classList.remove('hidden');
          if (res.ok && res.j.success) { fb.className = 'mt-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 p-3 text-sm'; fb.textContent = 'Paramètres sauvegardés.'; }
          else { fb.className = 'mt-3 rounded-xl border border-red-200 bg-red-50 text-red-900 p-3 text-sm'; fb.textContent = (res.j && res.j.error) || 'Erreur'; }
        });
    });

    document.getElementById('sav-auto-run-now').addEventListener('click', function () {
      api('/automations/run', { method: 'POST' }).then(function (res) {
        if (res.ok) toast('Automations exécutées : ' + JSON.stringify(res.j.data));
        else toast('Erreur', 'error');
      });
    });
  }

  // ============================================================
  // AUDIT LOG PAGE
  // ============================================================
  if (document.getElementById('sav-audit-tbody')) {
    var tbody2 = document.getElementById('sav-audit-tbody');
    function loadAudit() {
      var fd = new FormData(document.getElementById('sav-audit-filters'));
      var qs = new URLSearchParams();
      fd.forEach(function (v, k) { if (v) qs.append(k, v); });
      tbody2.innerHTML = '<tr><td colspan="7" class="px-4 py-10 text-center text-slate-500">Chargement…</td></tr>';
      api('/audit?' + qs.toString()).then(function (res) {
        if (!res.ok) { tbody2.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-red-700">Erreur de chargement</td></tr>'; return; }
        var items = res.j.data.items || [];
        if (!items.length) { tbody2.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-slate-500">Aucun log.</td></tr>'; return; }
        tbody2.innerHTML = items.map(function (it) {
          return '<tr>' +
            '<td class="px-3 py-2 whitespace-nowrap">' + new Date(it.createdAt).toLocaleString('fr-FR') + '</td>' +
            '<td class="px-3 py-2">' + escapeHtml(it.userEmail || '—') + '</td>' +
            '<td class="px-3 py-2 font-mono text-[11px]">' + escapeHtml(it.action) + '</td>' +
            '<td class="px-3 py-2 font-mono text-[11px]">' + escapeHtml(it.entityType + ' ' + (it.entityId || '')) + '</td>' +
            '<td class="px-3 py-2 text-[10px] text-slate-500 max-w-xs truncate" title="' + escapeHtml(JSON.stringify(it.before || '')) + '">' + escapeHtml(JSON.stringify(it.before || '').slice(0, 60)) + '</td>' +
            '<td class="px-3 py-2 text-[10px] text-slate-500 max-w-xs truncate" title="' + escapeHtml(JSON.stringify(it.after || '')) + '">' + escapeHtml(JSON.stringify(it.after || '').slice(0, 60)) + '</td>' +
            '<td class="px-3 py-2 font-mono text-[10px]">' + escapeHtml(it.ip || '') + '</td>' +
          '</tr>';
        }).join('');
      });
    }
    document.getElementById('sav-audit-filters').addEventListener('submit', function (e) { e.preventDefault(); loadAudit(); });
    loadAudit();
  }
})();
