/* SAV — formulaire client multi-étapes (vanilla JS, mobile-first) */
(function () {
  'use strict';

  var form = document.getElementById('sav-form');
  if (!form) return;

  var TOTAL = 5;
  var current = 1;
  var orderInfo = null;
  var STORAGE_KEY = 'sav:draft:v1';

  function saveDraft() {
    try {
      var data = { step: current, fields: {} };
      $$('input, select, textarea', form).forEach(function (el) {
        if (!el.name || el.type === 'file' || el.type === 'password') return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked) {
            if (el.type === 'checkbox') {
              (data.fields[el.name] = data.fields[el.name] || []).push(el.value);
            } else {
              data.fields[el.name] = el.value;
            }
          }
        } else {
          data.fields[el.name] = el.value;
        }
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function restoreDraft() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || !data.fields) return;
      Object.keys(data.fields).forEach(function (name) {
        var val = data.fields[name];
        var els = form.querySelectorAll('[name="' + name + '"]');
        if (!els.length) return;
        if (els[0].type === 'checkbox' || els[0].type === 'radio') {
          var values = Array.isArray(val) ? val : [val];
          els.forEach(function (el) { el.checked = values.indexOf(el.value) !== -1; });
        } else {
          els[0].value = val;
        }
      });
      if (data.step && data.step > 1 && data.step <= TOTAL) {
        showStep(data.step);
        var banner = document.getElementById('sav-restore-banner');
        if (banner) banner.classList.remove('hidden');
      }
    } catch (_) {}
  }

  function clearDraft() { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} }

  // ---------- helpers ----------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function showStep(n) {
    current = n;
    $$('.sav-form-step').forEach(function (s) {
      var step = parseInt(s.getAttribute('data-step'), 10);
      var active = step === n;
      s.classList.toggle('sav-form-step--active', active);
      if (active) s.removeAttribute('hidden'); else s.setAttribute('hidden', '');
    });
    $$('[data-step-indicator]').forEach(function (el) {
      var i = parseInt(el.getAttribute('data-step-indicator'), 10);
      el.classList.toggle('sav-stepper__step--current', i === n);
      el.classList.toggle('sav-stepper__step--done', i < n);
    });
    var prog = document.getElementById('sav-progress');
    if (prog) prog.setAttribute('aria-valuenow', String(n));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    var first = $('.sav-form-step--active input, .sav-form-step--active select, .sav-form-step--active textarea');
    if (first) try { first.focus({ preventScroll: true }); } catch (_) {}
  }

  function setError(name, msg) {
    var input = form.querySelector('[name="' + name + '"], #' + name);
    var p = form.querySelector('[data-error-for="' + name + '"]');
    if (input) input.classList.toggle('border-red-500', !!msg);
    if (p) {
      p.textContent = msg || '';
      p.classList.toggle('hidden', !msg);
    }
  }

  function clearErrors(stepEl) {
    $$('[data-error-for]', stepEl).forEach(function (p) { p.classList.add('hidden'); p.textContent = ''; });
    $$('input, select, textarea', stepEl).forEach(function (i) { i.classList.remove('border-red-500'); });
  }

  function toast(message, type) {
    var root = document.getElementById('sav-toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'sav-toast sav-toast--' + (type || 'success');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">' +
      (type === 'error' ? 'error' : 'check_circle') + '</span><span>' + message + '</span>';
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('sav-toast--visible'); });
    setTimeout(function () {
      el.classList.remove('sav-toast--visible');
      setTimeout(function () { el.remove(); }, 250);
    }, 4000);
  }

  // ---------- Validation par étape ----------
  function validateStep(step) {
    var stepEl = form.querySelector('[data-step="' + step + '"]');
    clearErrors(stepEl);
    var ok = true;

    if (step === 1) {
      var emailEl = $('#email');
      var email = emailEl ? emailEl.value.trim() : '';
      // Mode connecté : sélecteur radio
      var radio = form.querySelector('input[name="numeroCommande"]:checked');
      var isRadioMode = !!form.querySelector('input[type="radio"][name="numeroCommande"]');
      var num = isRadioMode ? (radio ? radio.value : '') : ($('#numeroCommande') ? $('#numeroCommande').value.trim() : '');
      if (!isRadioMode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('email', "Cet email ne semble pas valide."); ok = false; }
      if (!num) { setError('numeroCommande', isRadioMode ? 'Sélectionnez une commande.' : 'Indiquez le numéro de commande.'); ok = false; }
      if (!ok) return Promise.resolve(false);
      // En mode connecté, on fait confiance à la liste server-side
      if (isRadioMode) { orderInfo = { numero: num }; return Promise.resolve(true); }

      // Vérification serveur
      return fetch('/sav/check-commande', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, numeroCommande: num }),
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j.success) {
            setError('numeroCommande', res.j.error || 'Commande introuvable.');
            return false;
          }
          orderInfo = res.j.data;
          return true;
        })
        .catch(function () {
          toast("Notre service est momentanément indisponible. Réessayez dans une minute.", 'error');
          return false;
        });
    }

    if (step === 2) {
      if (!$('#pieceType').value) { setError('pieceType', 'Sélectionnez le type de pièce.'); ok = false; }
      if (!$('#dateMontage').value) { setError('dateMontage', 'Indiquez la date du montage.'); ok = false; }
      if (!$('#garageNom').value.trim()) { setError('garageNom', 'Indiquez le nom du garage.'); ok = false; }
      var reglage = (form.querySelector('input[name="reglageBase"]:checked') || {}).value;
      if (!reglage || reglage !== 'oui') {
        document.getElementById('reglageBaseAlert').classList.remove('hidden');
        ok = false;
      } else {
        document.getElementById('reglageBaseAlert').classList.add('hidden');
      }
      // Date montage > 30j après commande → flag interne (silencieux)
      return Promise.resolve(ok);
    }

    if (step === 3) {
      var photo = $('#photoObd').files[0];
      if (!photo) { setError('photoObd', 'Ajoutez au moins une photo de la lecture OBD.'); ok = false; }
      return Promise.resolve(ok);
    }

    if (step === 4) {
      if (!$('#factureGarage').files[0]) { setError('factureGarage', 'La facture du garage est obligatoire.'); ok = false; }
      if (!$('#photoPiece').files[0]) { setError('photoPiece', 'Ajoutez une photo de la pièce installée.'); ok = false; }
      var vin = $('#vin').value.trim().toUpperCase();
      var imm = $('#immatriculation').value.trim();
      if (!vin && !imm) {
        setError('vin', 'Indiquez soit le VIN (17 caractères), soit la plaque d\'immatriculation.');
        ok = false;
      } else if (vin && vin.length !== 17) {
        setError('vin', 'Le VIN doit comporter exactement 17 caractères (ou laissez vide et renseignez la plaque).');
        ok = false;
      }
      return Promise.resolve(ok);
    }

    if (step === 5) {
      if (!$('#cgvSav').checked || !$('#accept149').checked) {
        setError('acceptances', 'Pour démarrer, vous devez accepter les CGV et la condition de facturation.');
        ok = false;
      }
      return Promise.resolve(ok);
    }

    return Promise.resolve(true);
  }

  // ---------- Wiring ----------
  form.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'next') {
      var step = parseInt(btn.getAttribute('data-validate-step'), 10);
      btn.disabled = true;
      var prevLabel = btn.innerHTML;
      btn.innerHTML = '<span class="material-symbols-rounded animate-spin">progress_activity</span> Vérification…';
      Promise.resolve(validateStep(step)).then(function (ok) {
        btn.disabled = false;
        btn.innerHTML = prevLabel;
        if (ok && current < TOTAL) showStep(current + 1);
      });
    } else if (action === 'prev') {
      if (current > 1) showStep(current - 1);
    }
  });

  // Sauvegarde auto + restauration
  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);
  restoreDraft();

  // -------- Bouton "Recommencer à zéro" avec modale de confirmation --------
  function resetWizard() {
    clearDraft();
    try { form.reset(); } catch (_) {}
    // Vide aussi les fichiers et les indicateurs visuels
    $$('input', form).forEach(function (el) {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
      else if (el.type !== 'submit' && el.type !== 'button') el.value = '';
    });
    $$('textarea, select', form).forEach(function (el) { el.value = ''; });
    $$('.sav-dropzone').forEach(function (lbl) {
      lbl.classList.remove('sav-dropzone--has-file');
      var span = lbl.querySelector('[data-filename]');
      if (span) span.textContent = '';
    });
    $$('[data-error-for]', form).forEach(function (p) { p.classList.add('hidden'); p.textContent = ''; });
    var alert = document.getElementById('reglageBaseAlert');
    if (alert) alert.classList.add('hidden');
    var banner = document.getElementById('sav-restore-banner');
    if (banner) banner.classList.add('hidden');
    showStep(1);
    toast('Formulaire réinitialisé', 'success');
  }

  var resetBtn = document.getElementById('sav-reset-btn');
  var resetModal = document.getElementById('sav-reset-modal');
  var resetConfirm = document.getElementById('sav-reset-confirm');
  var resetCancel = document.getElementById('sav-reset-cancel');
  function openResetModal() {
    if (!resetModal) return;
    resetModal.classList.remove('hidden');
    resetModal.classList.add('flex');
    if (resetCancel) resetCancel.focus();
  }
  function closeResetModal() {
    if (!resetModal) return;
    resetModal.classList.add('hidden');
    resetModal.classList.remove('flex');
  }
  if (resetBtn) resetBtn.addEventListener('click', openResetModal);
  if (resetCancel) resetCancel.addEventListener('click', closeResetModal);
  if (resetConfirm) resetConfirm.addEventListener('click', function () {
    closeResetModal();
    resetWizard();
  });
  if (resetModal) resetModal.addEventListener('click', function (e) {
    if (e.target === resetModal) closeResetModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && resetModal && !resetModal.classList.contains('hidden')) closeResetModal();
  });

  // Affichage du nom de fichier dans les dropzones
  $$('input[type="file"]').forEach(function (input) {
    input.addEventListener('change', function () {
      var label = input.previousElementSibling;
      if (label && label.classList.contains('sav-dropzone')) {
        var name = (input.files[0] && input.files[0].name) || '';
        label.classList.toggle('sav-dropzone--has-file', !!name);
        var span = label.querySelector('[data-filename]');
        if (span) span.textContent = name;
      }
    });
  });

  // Soumission finale
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    validateStep(5).then(function (ok) {
      if (!ok) return;
      var btn = document.getElementById('sav-submit');
      var lbl = btn.querySelector('[data-submit-label]');
      var sp = btn.querySelector('[data-submit-spinner]');
      btn.disabled = true;
      lbl.textContent = 'Envoi en cours…';
      sp.classList.remove('hidden');

      var emailVal = $('#email').value.trim();
      var radioMode = !!form.querySelector('input[type="radio"][name="numeroCommande"]');
      var numeroCmd = radioMode
        ? ((form.querySelector('input[name="numeroCommande"]:checked') || {}).value || '')
        : $('#numeroCommande').value.trim();
      var reglageBaseVal = (form.querySelector('input[name="reglageBase"]:checked') || {}).value || '';

      var payload = {
        pieceType: $('#pieceType').value,
        numeroCommande: numeroCmd,
        dateAchat: orderInfo && orderInfo.dateCommande,
        client: { nom: ($('#clientNom') && $('#clientNom').value) || '', email: emailVal },
        vehicule: {
          vin: $('#vin').value.trim().toUpperCase(),
          immatriculation: $('#immatriculation').value.trim().toUpperCase(),
        },
        garage: { nom: $('#garageNom').value.trim() },
        montage: {
          date: $('#dateMontage') ? $('#dateMontage').value : undefined,
          reglageBase: reglageBaseVal,
        },
        diagnostic: {
          symptomes: $$('input[name="symptomes"]:checked').map(function (i) { return i.value; }),
          codesDefaut: $('#codesDefaut').value.split(/[,\s]+/).filter(Boolean),
          description: ($('#description') && $('#description').value.trim()) || '',
        },
        cgvAcceptance: {
          version: 'v1',
          acceptedAt: new Date().toISOString(),
        },
      };

      function uploadOne(numero, inputEl, kind) {
        var f = inputEl && inputEl.files && inputEl.files[0];
        if (!f) return Promise.resolve();
        var fd = new FormData();
        fd.append('document', f);
        fd.append('email', emailVal);
        fd.append('kind', kind);
        return fetch('/api/sav/tickets/' + encodeURIComponent(numero) + '/documents', {
          method: 'POST',
          body: fd,
        }).then(function (r) {
          if (!r.ok) throw new Error('upload échoué (' + kind + ')');
        });
      }

      var resetBtn = function () {
        btn.disabled = false; lbl.textContent = 'Envoyer ma demande'; sp.classList.add('hidden');
      };
      fetch('/api/sav/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (r) {
        return r.text().then(function (txt) {
          var j = {}; try { j = JSON.parse(txt); } catch (_) {}
          return { ok: r.ok, status: r.status, j: j, raw: txt };
        });
      }).then(function (res) {
        if (!res.ok || !res.j.success) {
          var msg = (res.j && res.j.error) || ('Erreur serveur (' + res.status + '). Contactez-nous à sav@carpartsfrance.fr.');
          toast(msg, 'error');
          console.error('[SAV] création échec', res);
          resetBtn();
          return;
        }
        var numero = res.j.data.numero;
        // Upload des fichiers obligatoires (facture garage + photo pièce + photo OBD)
        Promise.all([
          uploadOne(numero, $('#factureGarage'), 'factureMontage'),
          uploadOne(numero, $('#photoPiece'), 'photoPiece'),
          uploadOne(numero, $('#photoObd'), 'photoObd'),
        ]).then(function () {
          clearDraft();
          toast('Votre demande est enregistrée. Redirection…', 'success');
          setTimeout(function () {
            window.location.href = '/sav/suivi/' + encodeURIComponent(numero);
          }, 800);
        }).catch(function (err) {
          console.error('[SAV] upload échec', err);
          toast("Ticket créé mais l'envoi des documents a échoué. Contactez sav@carpartsfrance.fr.", 'error');
          resetBtn();
        });
      }).catch(function (err) {
        console.error('[SAV] exception', err);
        toast('Erreur réseau : ' + (err && err.message ? err.message : 'inconnue'), 'error');
        resetBtn();
      });
    });
  });
})();
