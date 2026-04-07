/* SAV — wizard client refondu (vanilla JS, mobile-first)
 * - Stepper 6 étapes (cliquable sur étapes passées)
 * - Validation inline (blur), bouton Continuer désactivé tant que invalide
 * - Drag & drop multi-fichiers, miniatures, suppression, compression auto > 2 Mo
 * - Codes OBD multi-tags avec suggestions
 * - Étape 6 récapitulatif avec édition
 * - Reset avec modale
 */
(function () {
  'use strict';

  var form = document.getElementById('sav-form');
  if (!form) return;

  var STEP_LABELS = ['Commande', 'Pièce', 'Symptômes', 'Documents', 'Engagement', 'Récapitulatif'];
  var TOTAL = STEP_LABELS.length;
  var current = 1;
  var furthestReached = 1;
  var orderInfo = null;
  var STORAGE_KEY = 'sav:draft:v2';

  // ----------------- Helpers -----------------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
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
  function toast(message, type) {
    var root = document.getElementById('sav-toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'sav-toast sav-toast--' + (type || 'success');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">' +
      (type === 'error' ? 'error' : 'check_circle') + '</span><span>' + escapeHtml(message) + '</span>';
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('sav-toast--visible'); });
    setTimeout(function () {
      el.classList.remove('sav-toast--visible');
      setTimeout(function () { el.remove(); }, 250);
    }, 4000);
  }

  // ----------------- Stepper -----------------
  function showStep(n) {
    if (n < 1 || n > TOTAL) return;
    current = n;
    if (n > furthestReached) furthestReached = n;
    $$('.sav-form-step').forEach(function (s) {
      var step = parseInt(s.getAttribute('data-step'), 10);
      var active = step === n;
      s.classList.toggle('sav-form-step--active', active);
      if (active) s.removeAttribute('hidden'); else s.setAttribute('hidden', '');
    });
    // Desktop stepper
    $$('[data-step-indicator]').forEach(function (el) {
      var i = parseInt(el.getAttribute('data-step-indicator'), 10);
      el.classList.toggle('is-current', i === n);
      el.classList.toggle('is-done', i < n);
      var clickable = i < furthestReached;
      el.classList.toggle('is-clickable', clickable);
    });
    // Mobile bar
    var mc = document.getElementById('sav-mobile-current');
    var ml = document.getElementById('sav-mobile-label');
    var mp = document.getElementById('sav-mobile-pct');
    var mb = document.getElementById('sav-mobile-bar');
    if (mc) mc.textContent = String(n);
    if (ml) ml.textContent = STEP_LABELS[n - 1];
    var pct = Math.round((n / TOTAL) * 100);
    if (mp) mp.textContent = String(pct);
    if (mb) mb.style.width = pct + '%';
    var prog = document.getElementById('sav-progress');
    if (prog) prog.setAttribute('aria-valuenow', String(n));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    revalidateCurrentStep();
    if (n === TOTAL) renderRecap();
  }

  // Stepper : clic sur étape passée pour revenir
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-go-step]');
    if (!btn) return;
    var target = parseInt(btn.getAttribute('data-go-step'), 10);
    if (target && target < furthestReached) showStep(target);
  });

  // ----------------- Draft persistance -----------------
  function saveDraft() {
    try {
      var data = { step: current, fields: {}, codes: getCodes(), files: filesMeta(), furthest: furthestReached };
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
      if (Array.isArray(data.codes)) data.codes.forEach(addCode);
      if (data.furthest) furthestReached = data.furthest;
      var step = data.step && data.step > 1 && data.step <= TOTAL ? data.step : 1;
      showStep(step);
      if (step > 1) {
        var banner = document.getElementById('sav-restore-banner');
        if (banner) banner.classList.remove('hidden');
      }
    } catch (_) {}
  }
  function clearDraft() { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} }

  // ----------------- Validation inline -----------------
  function setError(name, msg) {
    var inputs = form.querySelectorAll('[name="' + name + '"], #' + name);
    var p = form.querySelector('[data-error-for="' + name + '"]');
    var errorId = 'err-' + name;
    inputs.forEach(function (input) {
      input.classList.toggle('sav-input--invalid', !!msg);
      input.classList.toggle('sav-input--valid', !msg && input.value);
      // a11y : annonce l'état + lie le champ au message d'erreur
      if (msg) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errorId);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    });
    if (p) {
      p.id = errorId;
      p.setAttribute('role', 'alert');
      p.setAttribute('aria-live', 'polite');
      p.innerHTML = msg ? '<span class="material-symbols-rounded text-base align-middle" aria-hidden="true">warning</span> ' + escapeHtml(msg) : '';
      p.classList.toggle('hidden', !msg);
    }
    // Annonce globale dans le live region status
    var status = document.getElementById('sav-form-status');
    if (status && msg) status.textContent = name + ' : ' + msg;
  }

  // VIN sans I, O, Q ; 17 caractères alphanumériques
  var VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
  // Plaque FR moderne (AA-123-AA) ou ancien (1234 AB 56 — souple)
  var PLAQUE_FR_RE = /^([A-Z]{2}-?\d{3}-?[A-Z]{2}|\d{1,4}\s?[A-Z]{1,3}\s?\d{1,3})$/;
  // Code OBD-II
  var OBD_RE = /^[PCBU][0-9A-F]{4}$/i;

  function validateField(name) {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    if (name === 'email') {
      var em = v('email').trim();
      if (!em) return 'Indiquez votre email.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return "Cet email ne semble pas valide.";
      return '';
    }
    if (name === 'numeroCommande') {
      var radio = form.querySelector('input[type="radio"][name="numeroCommande"]:checked');
      var manualOpen = !document.getElementById('sav-manual-block') || !document.getElementById('sav-manual-block').classList.contains('hidden');
      var num = v('numeroCommande').trim() || (radio && radio.value) || (manualOpen && v('numeroCommandeManual').trim());
      if (!num) return 'Sélectionnez ou indiquez votre numéro de commande.';
      return '';
    }
    if (name === 'pieceType') return v('pieceType') ? '' : 'Sélectionnez le type de pièce.';
    if (name === 'dateMontage') {
      var d = v('dateMontage');
      if (!d) return 'Indiquez la date du montage.';
      var dt = new Date(d);
      var now = new Date();
      var twoYearsAgo = new Date(); twoYearsAgo.setFullYear(now.getFullYear() - 2);
      if (dt > now) return 'La date ne peut pas être dans le futur.';
      if (dt < twoYearsAgo) return 'Le montage doit dater de moins de 2 ans (garantie légale).';
      return '';
    }
    if (name === 'garageNom') return v('garageNom').trim() ? '' : 'Indiquez le nom du garage.';
    if (name === 'description') {
      var d2 = v('description').trim();
      if (d2.length < 20) return 'Décrivez vos symptômes (au moins 20 caractères).';
      return '';
    }
    if (name === 'vin') {
      var vin = v('vin').trim().toUpperCase();
      if (!vin) return ''; // optionnel si plaque
      if (!VIN_RE.test(vin)) return 'VIN invalide (17 caractères, sans I/O/Q).';
      return '';
    }
    if (name === 'immatriculation') {
      var im = v('immatriculation').trim().toUpperCase();
      if (!im) return ''; // optionnel si VIN
      if (!PLAQUE_FR_RE.test(im)) return 'Plaque française invalide (ex: AA-123-AA).';
      return '';
    }
    return '';
  }

  function validateStep(step) {
    var ok = true;
    function check(name) {
      var msg = validateField(name);
      setError(name, msg);
      if (msg) ok = false;
    }
    if (step === 1) {
      // Au moins une commande sélectionnée OU saisie manuelle
      var radio = form.querySelector('input[type="radio"][name="numeroCommande"]:checked');
      var manualBlock = document.getElementById('sav-manual-block');
      var manualOpen = manualBlock && !manualBlock.classList.contains('hidden');
      if (!radio && !manualOpen) {
        var loose = document.getElementById('numeroCommande');
        if (!loose || !loose.value.trim()) {
          setError('numeroCommande', 'Sélectionnez votre commande.');
          ok = false;
        }
      }
      if (manualOpen) {
        var em = (document.getElementById('emailManual') || {}).value || '';
        var nm = (document.getElementById('numeroCommandeManual') || {}).value || '';
        if (!em.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.trim())) { setError('numeroCommande', 'Email invalide.'); ok = false; }
        if (!nm.trim()) { setError('numeroCommande', 'Indiquez votre n° de commande.'); ok = false; }
      }
      // Mode invité (sans currentUser)
      if (document.getElementById('email') && !document.getElementById('email').value.startsWith('') && !manualOpen) {
        // rien — déjà checké si visible
      }
    }
    if (step === 2) {
      check('pieceType');
      check('dateMontage');
      check('garageNom');
      var rb = (form.querySelector('input[name="reglageBase"]:checked') || {}).value || '';
      var alert = document.getElementById('reglageBaseAlert');
      var help = document.getElementById('reglageBaseHelp');
      if (help) help.classList.toggle('hidden', !(rb === 'non' || rb === 'inconnu'));
      if (rb !== 'oui') {
        if (alert) alert.classList.remove('hidden');
        ok = false;
      } else {
        if (alert) alert.classList.add('hidden');
      }
    }
    if (step === 3) {
      check('description');
      // codes OBD : optionnels mais doivent être au bon format si présents
      var codes = getCodes();
      var bad = codes.filter(function (c) { return !OBD_RE.test(c); });
      if (bad.length) { setError('codesDefaut', 'Code(s) invalide(s) : ' + bad.join(', ')); ok = false; }
      else setError('codesDefaut', '');
    }
    if (step === 4) {
      // VIN ou plaque obligatoire
      check('vin'); check('immatriculation');
      var vin = (document.getElementById('vin') || {}).value || '';
      var imm = (document.getElementById('immatriculation') || {}).value || '';
      if (!vin && !imm) {
        setError('vin', 'Renseignez le VIN ou la plaque.');
        ok = false;
      }
      // Documents : facture + photo pièce + photo OBD + photo compteur obligatoires
      var hasKinds = {};
      droppedFiles.forEach(function (f) { hasKinds[f.kind] = true; });
      var missing = [];
      if (!hasKinds.factureMontage) missing.push('facture garage');
      if (!hasKinds.photoPiece) missing.push('photo de la pièce');
      if (!hasKinds.photoObd) missing.push('photo OBD');
      if (!hasKinds.photoCompteur) missing.push('photo du compteur');
      if (missing.length) {
        setError('files', 'Manque : ' + missing.join(', ') + '. Ajoutez et catégorisez les fichiers.');
        ok = false;
      } else setError('files', '');
    }
    if (step === 5) {
      var c1 = document.getElementById('cgvSav').checked;
      var c2 = document.getElementById('accept149').checked;
      var c3 = document.getElementById('rgpdSav').checked;
      if (!(c1 && c2 && c3)) {
        setError('acceptances', 'Cochez les 3 cases pour continuer.');
        ok = false;
      } else {
        setError('acceptances', '');
      }
    }
    return ok;
  }

  function revalidateCurrentStep() {
    var btn = document.querySelector('[data-step="' + current + '"] [data-action="next"], [data-step="' + current + '"] [type="submit"]');
    if (!btn) return;
    var ok = validateStepSilently(current);
    btn.disabled = !ok;
    btn.classList.toggle('sav-cta--disabled', !ok);
    if (ok) btn.removeAttribute('title');
    else if (btn.dataset.tooltip) btn.setAttribute('title', btn.dataset.tooltip);
  }

  // Variante "silencieuse" : ne pose pas les messages d'erreur, juste retourne ok/pas ok
  function validateStepSilently(step) {
    var saved = {};
    $$('[data-error-for]').forEach(function (p) { saved[p.getAttribute('data-error-for')] = { html: p.innerHTML, hidden: p.classList.contains('hidden') }; });
    var savedClasses = [];
    $$('input, select, textarea', form).forEach(function (i) {
      savedClasses.push({ el: i, valid: i.classList.contains('sav-input--valid'), invalid: i.classList.contains('sav-input--invalid') });
    });
    var ok = validateStep(step);
    // Restaure
    $$('[data-error-for]').forEach(function (p) {
      var s = saved[p.getAttribute('data-error-for')];
      if (s) { p.innerHTML = s.html; p.classList.toggle('hidden', s.hidden); }
    });
    savedClasses.forEach(function (s) {
      s.el.classList.toggle('sav-input--valid', s.valid);
      s.el.classList.toggle('sav-input--invalid', s.invalid);
    });
    return ok;
  }

  // Validation au blur
  form.addEventListener('blur', function (e) {
    var t = e.target;
    if (!t || !t.name) return;
    if (['email','numeroCommande','pieceType','dateMontage','garageNom','description','vin','immatriculation'].indexOf(t.name) >= 0
        || ['email','numeroCommande','pieceType','dateMontage','garageNom','description','vin','immatriculation'].indexOf(t.id) >= 0) {
      var key = t.name || t.id;
      var msg = validateField(key);
      setError(key, msg);
    }
    revalidateCurrentStep();
  }, true);

  form.addEventListener('input', function () { saveDraft(); revalidateCurrentStep(); });
  form.addEventListener('change', function () { saveDraft(); revalidateCurrentStep(); });

  // Description compteur
  var descTextarea = document.getElementById('description');
  var descCount = document.getElementById('descCount');
  if (descTextarea && descCount) {
    descTextarea.addEventListener('input', function () {
      descCount.textContent = String(descTextarea.value.trim().length);
    });
  }

  // ----------------- Codes OBD multi-tags -----------------
  var SUGGESTIONS_OBD = ['P0741','P17BF','P189C','P173A','P0842','P0843','P2711','P2723','P0700','P0734'];
  function getCodes() {
    var hidden = document.getElementById('codesDefaut');
    return (hidden && hidden.value ? hidden.value.split(',').filter(Boolean) : []);
  }
  function setCodes(arr) {
    document.getElementById('codesDefaut').value = arr.join(',');
    renderTags();
    saveDraft();
    revalidateCurrentStep();
  }
  function addCode(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return;
    var codes = getCodes();
    if (codes.length >= 10) { toast('10 codes maximum', 'error'); return; }
    if (codes.indexOf(code) >= 0) return;
    codes.push(code);
    setCodes(codes);
  }
  function removeCode(code) {
    setCodes(getCodes().filter(function (c) { return c !== code; }));
  }
  function renderTags() {
    var box = document.getElementById('obdTagBox');
    if (!box) return;
    // Garde uniquement l'input et reconstruit les chips devant
    var input = document.getElementById('obdInput');
    box.innerHTML = '';
    getCodes().forEach(function (c) {
      var chip = document.createElement('span');
      var bad = !OBD_RE.test(c);
      chip.className = 'sav-tag' + (bad ? ' sav-tag--bad' : '');
      chip.innerHTML = '<span>' + escapeHtml(c) + '</span><button type="button" class="sav-tag__rm" aria-label="Retirer">×</button>';
      chip.querySelector('.sav-tag__rm').addEventListener('click', function () { removeCode(c); });
      box.appendChild(chip);
    });
    box.appendChild(input);
  }
  var obdInput = document.getElementById('obdInput');
  if (obdInput) {
    obdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        var v = obdInput.value.trim();
        if (v) { addCode(v); obdInput.value = ''; }
      } else if (e.key === 'Backspace' && !obdInput.value) {
        var codes = getCodes();
        if (codes.length) removeCode(codes[codes.length - 1]);
      }
    });
    obdInput.addEventListener('blur', function () {
      if (obdInput.value.trim()) { addCode(obdInput.value.trim()); obdInput.value = ''; }
    });
  }
  var sg = document.getElementById('obdSuggest');
  if (sg) {
    sg.innerHTML = SUGGESTIONS_OBD.slice(0, 6).map(function (c) {
      return '<button type="button" class="sav-suggest" data-code="' + c + '">' + c + '</button>';
    }).join(' ');
    sg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-code]');
      if (b) addCode(b.getAttribute('data-code'));
    });
  }
  renderTags();

  // ----------------- Drag & drop fichiers -----------------
  var droppedFiles = []; // {file, kind, preview, id}
  var KIND_OPTIONS = [
    { v: 'factureMontage', l: 'Facture garage' },
    { v: 'photoPiece', l: 'Photo pièce installée' },
    { v: 'photoObd', l: 'Photo OBD' },
    { v: 'photoCompteur', l: 'Photo compteur (km)' },
    { v: 'bonGarantie', l: 'Bon garantie (optionnel)' },
  ];
  function filesMeta() { return droppedFiles.map(function (f) { return { name: f.file.name, kind: f.kind, size: f.file.size }; }); }

  function guessKind(file) {
    var n = (file.name || '').toLowerCase();
    if (/facture|invoice/.test(n)) return 'factureMontage';
    if (/obd|defaut|fault/.test(n)) return 'photoObd';
    if (/compteur|km|odometre/.test(n)) return 'photoCompteur';
    if (/garantie|warranty/.test(n)) return 'bonGarantie';
    return 'photoPiece';
  }

  function renderFileList() {
    var ul = document.getElementById('sav-file-list');
    if (!ul) return;
    ul.innerHTML = '';
    droppedFiles.forEach(function (entry, idx) {
      var li = document.createElement('li');
      li.className = 'sav-file-item';
      var thumb = entry.preview
        ? '<img src="' + entry.preview + '" alt="" class="sav-file-item__thumb">'
        : '<div class="sav-file-item__thumb sav-file-item__thumb--icon"><span class="material-symbols-rounded">picture_as_pdf</span></div>';
      var sel = '<select class="sav-file-item__kind" aria-label="Catégorie">' +
        KIND_OPTIONS.map(function (o) {
          return '<option value="' + o.v + '"' + (entry.kind === o.v ? ' selected' : '') + '>' + o.l + '</option>';
        }).join('') + '</select>';
      li.innerHTML =
        thumb +
        '<div class="sav-file-item__body">' +
          '<div class="sav-file-item__name" title="' + escapeHtml(entry.file.name) + '">' + escapeHtml(entry.file.name) + '</div>' +
          '<div class="sav-file-item__meta">' + escapeHtml(fmtSize(entry.file.size)) + (entry.file.type ? ' · ' + escapeHtml(entry.file.type) : '') + '</div>' +
          '<div class="sav-file-item__progress"><div class="sav-file-item__bar" style="width:' + (entry.progress || 0) + '%"></div></div>' +
        '</div>' +
        '<div class="sav-file-item__actions">' + sel + '<button type="button" class="sav-file-item__rm" aria-label="Retirer">×</button></div>';
      li.querySelector('.sav-file-item__rm').addEventListener('click', function () {
        droppedFiles.splice(idx, 1);
        renderFileList(); revalidateCurrentStep(); saveDraft();
      });
      li.querySelector('.sav-file-item__kind').addEventListener('change', function (e) {
        droppedFiles[idx].kind = e.target.value;
        revalidateCurrentStep(); saveDraft();
      });
      ul.appendChild(li);
    });
  }

  function readPreview(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type)) return resolve('');
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { resolve(''); };
      fr.readAsDataURL(file);
    });
  }

  function compressIfNeeded(file) {
    if (!/^image\//.test(file.type)) return Promise.resolve(file);
    if (file.size < 2 * 1024 * 1024) return Promise.resolve(file);
    if (typeof window.imageCompression !== 'function') return Promise.resolve(file);
    return window.imageCompression(file, {
      maxSizeMB: 1.8,
      maxWidthOrHeight: 2400,
      useWebWorker: true,
    }).catch(function () { return file; });
  }

  function addFiles(files) {
    var arr = Array.from(files || []);
    var errors = [];
    arr.forEach(function (file) {
      if (droppedFiles.length >= 5) { errors.push('Maximum 5 fichiers'); return; }
      if (!/^application\/pdf$|^image\/(jpe?g|png|heic|heif)$/i.test(file.type)) {
        errors.push(file.name + ' : format non autorisé'); return;
      }
      if (file.size > 10 * 1024 * 1024) { errors.push(file.name + ' : > 10 Mo'); return; }
      compressIfNeeded(file).then(function (final) {
        readPreview(final).then(function (preview) {
          droppedFiles.push({ file: final, kind: guessKind(final), preview: preview, progress: 0 });
          renderFileList();
          revalidateCurrentStep();
          saveDraft();
        });
      });
    });
    if (errors.length) toast(errors.join(' · '), 'error');
  }

  var drop = document.getElementById('sav-drop');
  var fileInput = document.getElementById('sav-file-input');
  if (drop && fileInput) {
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-drop'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-drop'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('is-drop'); addFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', function () { addFiles(fileInput.files); fileInput.value = ''; });
  }

  // ----------------- Sélection commande : recherche + saisie manuelle -----------------
  var searchInput = document.getElementById('sav-orders-search');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      var q = searchInput.value.trim().toLowerCase();
      var matches = 0;
      $$('#sav-orders-list .sav-order-card').forEach(function (card) {
        var hay = card.getAttribute('data-order-search') || '';
        var ok = !q || hay.indexOf(q) >= 0;
        card.style.display = ok ? '' : 'none';
        if (ok) matches++;
      });
      var empty = document.getElementById('sav-orders-empty');
      if (empty) empty.classList.toggle('hidden', matches > 0);
    });
  }
  $$('#sav-orders-manual-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var b = document.getElementById('sav-manual-block');
      if (b) b.classList.toggle('hidden');
    });
  });

  // ----------------- Réglage de base : affichage du bloc d'aide -----------------
  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'reglageBase') {
      var v = e.target.value;
      var help = document.getElementById('reglageBaseHelp');
      var alert = document.getElementById('reglageBaseAlert');
      if (help) help.classList.toggle('hidden', !(v === 'non' || v === 'inconnu'));
      if (alert && v === 'oui') alert.classList.add('hidden');
    }
  });
  var pauseBtn = document.getElementById('sav-pause-draft-btn');
  if (pauseBtn) pauseBtn.addEventListener('click', function () {
    saveDraft();
    toast('Brouillon sauvegardé. Revenez quand le réglage de base est fait.', 'success');
  });

  // ----------------- Récap (étape 6) -----------------
  function val(id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; }
  function buildRecap() {
    var radio = form.querySelector('input[type="radio"][name="numeroCommande"]:checked');
    var manualOpen = document.getElementById('sav-manual-block') && !document.getElementById('sav-manual-block').classList.contains('hidden');
    var num = val('numeroCommande') || (radio && radio.value) || (manualOpen && val('numeroCommandeManual')) || '';
    return {
      commande: {
        numero: num,
        email: val('email') || val('emailManual'),
      },
      piece: {
        type: val('pieceType'),
        dateMontage: val('dateMontage'),
        garage: val('garageNom'),
        garageAdresse: val('garageAdresse'),
        reglageBase: (form.querySelector('input[name="reglageBase"]:checked') || {}).value || '',
      },
      symptomes: {
        list: $$('input[name="symptomes"]:checked').map(function (i) { return i.value; }),
        codes: getCodes(),
        description: val('description'),
      },
      vehicule: {
        vin: val('vin').toUpperCase(),
        immatriculation: val('immatriculation').toUpperCase(),
        marque: val('vMarque'),
        modele: val('vModele'),
        annee: val('vAnnee'),
        motorisation: val('vMotor'),
        kilometrage: val('kilometrage'),
      },
      documents: droppedFiles.map(function (f) { return { name: f.file.name, kind: f.kind, size: f.file.size }; }),
      engagement: {
        cgv: document.getElementById('cgvSav').checked,
        accept149: document.getElementById('accept149').checked,
        rgpd: document.getElementById('rgpdSav').checked,
      },
    };
  }
  function renderRecap() {
    var box = document.getElementById('sav-recap');
    if (!box) return;
    var d = buildRecap();
    function section(title, body, step) {
      return '<div class="sav-recap__section">' +
        '<div class="sav-recap__head"><h3>' + escapeHtml(title) + '</h3>' +
          '<button type="button" class="sav-recap__edit" data-go-step="' + step + '">Modifier</button></div>' +
        '<div class="sav-recap__body">' + body + '</div></div>';
    }
    function row(k, v) { return v ? '<div><strong>' + escapeHtml(k) + '&nbsp;:</strong> ' + escapeHtml(v) + '</div>' : ''; }
    var html = '';
    html += section('Commande',
      row('N°', d.commande.numero) + row('Email', d.commande.email), 1);
    html += section('Pièce',
      row('Type', d.piece.type) + row('Date de montage', d.piece.dateMontage) +
      row('Garage', d.piece.garage) + row('Adresse garage', d.piece.garageAdresse) +
      row('Réglage de base', d.piece.reglageBase), 2);
    html += section('Symptômes',
      (d.symptomes.list.length ? '<div><strong>Symptômes&nbsp;:</strong> ' + d.symptomes.list.map(escapeHtml).join(', ') + '</div>' : '') +
      (d.symptomes.codes.length ? '<div><strong>Codes OBD&nbsp;:</strong> ' + d.symptomes.codes.map(escapeHtml).join(', ') + '</div>' : '') +
      (d.symptomes.description ? '<div class="mt-1 italic text-slate-600">"' + escapeHtml(d.symptomes.description) + '"</div>' : ''),
      3);
    html += section('Documents et véhicule',
      row('VIN', d.vehicule.vin) + row('Plaque', d.vehicule.immatriculation) +
      row('Véhicule', [d.vehicule.marque, d.vehicule.modele, d.vehicule.annee].filter(Boolean).join(' ')) +
      row('Motorisation', d.vehicule.motorisation) + row('Kilométrage', d.vehicule.kilometrage ? d.vehicule.kilometrage + ' km' : '') +
      (d.documents.length
        ? '<div class="mt-2"><strong>Fichiers&nbsp;:</strong><ul class="list-disc ml-5 mt-1 text-sm">' +
            d.documents.map(function (f) { return '<li>' + escapeHtml(f.name) + ' <span class="text-slate-400">(' + escapeHtml(f.kind) + ', ' + fmtSize(f.size) + ')</span></li>'; }).join('') +
          '</ul></div>'
        : '<div class="text-amber-700">Aucun document ajouté</div>'),
      4);
    html += section('Engagement',
      '<div>CGV SAV : ' + (d.engagement.cgv ? '✅' : '❌') + '</div>' +
      '<div>Forfait 149 € : ' + (d.engagement.accept149 ? '✅' : '❌') + '</div>' +
      '<div>RGPD : ' + (d.engagement.rgpd ? '✅' : '❌') + '</div>', 5);
    box.innerHTML = html;
  }

  // ----------------- Wiring nav -----------------
  form.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'next') {
      var step = parseInt(btn.getAttribute('data-validate-step'), 10);
      if (validateStep(step) && current < TOTAL) showStep(current + 1);
    } else if (action === 'prev') {
      if (current > 1) showStep(current - 1);
    }
  });

  // ----------------- Reset wizard -----------------
  function resetWizard() {
    clearDraft();
    droppedFiles = [];
    setCodes([]);
    try { form.reset(); } catch (_) {}
    $$('input', form).forEach(function (el) {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
      else if (el.type !== 'submit' && el.type !== 'button') el.value = '';
      el.classList.remove('sav-input--invalid', 'sav-input--valid');
    });
    $$('textarea, select', form).forEach(function (el) {
      el.value = '';
      el.classList.remove('sav-input--invalid', 'sav-input--valid');
    });
    renderFileList();
    $$('[data-error-for]').forEach(function (p) { p.classList.add('hidden'); p.innerHTML = ''; });
    var alert = document.getElementById('reglageBaseAlert');
    var help = document.getElementById('reglageBaseHelp');
    if (alert) alert.classList.add('hidden');
    if (help) help.classList.add('hidden');
    var banner = document.getElementById('sav-restore-banner');
    if (banner) banner.classList.add('hidden');
    furthestReached = 1;
    showStep(1);
    toast('Formulaire réinitialisé', 'success');
  }
  var resetBtn = document.getElementById('sav-reset-btn');
  var resetModal = document.getElementById('sav-reset-modal');
  var resetConfirm = document.getElementById('sav-reset-confirm');
  var resetCancel = document.getElementById('sav-reset-cancel');
  function openResetModal() {
    if (!resetModal) return;
    resetModal.classList.remove('hidden'); resetModal.classList.add('flex');
    if (resetCancel) resetCancel.focus();
  }
  function closeResetModal() {
    if (!resetModal) return;
    resetModal.classList.add('hidden'); resetModal.classList.remove('flex');
  }
  if (resetBtn) resetBtn.addEventListener('click', openResetModal);
  if (resetCancel) resetCancel.addEventListener('click', closeResetModal);
  if (resetConfirm) resetConfirm.addEventListener('click', function () { closeResetModal(); resetWizard(); });
  if (resetModal) resetModal.addEventListener('click', function (e) { if (e.target === resetModal) closeResetModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && resetModal && !resetModal.classList.contains('hidden')) closeResetModal();
  });

  // ----------------- Soumission finale -----------------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validateStep(5) || !validateStep(4) || !validateStep(3) || !validateStep(2) || !validateStep(1)) {
      toast('Vérifiez les étapes en erreur.', 'error');
      return;
    }
    var btn = document.getElementById('sav-submit');
    var lbl = btn.querySelector('[data-submit-label]');
    var sp = btn.querySelector('[data-submit-spinner]');
    btn.disabled = true;
    lbl.textContent = 'Envoi en cours…';
    sp.classList.remove('hidden');

    var emailVal = (val('email') || val('emailManual')).trim();
    var radio = form.querySelector('input[type="radio"][name="numeroCommande"]:checked');
    var numeroCmd = val('numeroCommande').trim() || (radio && radio.value) || val('numeroCommandeManual').trim();

    var payload = {
      pieceType: val('pieceType'),
      numeroCommande: numeroCmd,
      dateAchat: orderInfo && orderInfo.dateCommande,
      client: { nom: val('clientNom') || emailVal.split('@')[0], email: emailVal },
      vehicule: {
        vin: val('vin').toUpperCase(),
        immatriculation: val('immatriculation').toUpperCase(),
        marque: val('vMarque'),
        modele: val('vModele'),
        annee: val('vAnnee') ? Number(val('vAnnee')) : undefined,
        motorisation: val('vMotor'),
        kilometrage: val('kilometrage') ? Number(val('kilometrage')) : undefined,
      },
      garage: { nom: val('garageNom'), adresse: val('garageAdresse') },
      montage: {
        date: val('dateMontage'),
        reglageBase: (form.querySelector('input[name="reglageBase"]:checked') || {}).value || '',
      },
      diagnostic: {
        symptomes: $$('input[name="symptomes"]:checked').map(function (i) { return i.value; }),
        codesDefaut: getCodes(),
        description: val('description'),
      },
      cgvAcceptance: { version: 'cgv-sav-v2-2026-04', acceptedAt: new Date().toISOString() },
      rgpdAcceptance: { version: 'rgpd-v1-2026-04', acceptedAt: new Date().toISOString() },
    };

    function uploadOne(numero, entry) {
      var fd = new FormData();
      fd.append('document', entry.file, entry.file.name);
      fd.append('email', emailVal);
      fd.append('kind', entry.kind);
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/sav/tickets/' + encodeURIComponent(numero) + '/documents');
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            entry.progress = Math.round((e.loaded / e.total) * 100);
            renderFileList();
          }
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) { entry.progress = 100; renderFileList(); resolve(); }
          else reject(new Error('upload échoué (' + xhr.status + ') ' + entry.kind));
        };
        xhr.onerror = function () { reject(new Error('erreur réseau ' + entry.kind)); };
        xhr.send(fd);
      });
    }

    function resetBtn() { btn.disabled = false; lbl.textContent = 'Envoyer ma demande'; sp.classList.add('hidden'); }

    fetch('/api/sav/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.text().then(function (txt) { var j = {}; try { j = JSON.parse(txt); } catch (_) {} return { ok: r.ok, status: r.status, j: j }; });
    }).then(function (res) {
      if (!res.ok || !res.j.success) {
        toast((res.j && res.j.error) || ('Erreur serveur ' + res.status), 'error');
        resetBtn();
        return;
      }
      var numero = res.j.data.numero;
      // Upload séquentiel pour ne pas saturer
      var p = Promise.resolve();
      droppedFiles.forEach(function (entry) { p = p.then(function () { return uploadOne(numero, entry); }); });
      p.then(function () {
        clearDraft();
        toast('Votre demande est enregistrée. Redirection…', 'success');
        setTimeout(function () { window.location.href = '/sav/confirmation/' + encodeURIComponent(numero); }, 700);
      }).catch(function (err) {
        console.error('[SAV] upload', err);
        toast("Ticket créé mais l'envoi de certains documents a échoué. Notre équipe vous contactera.", 'error');
        setTimeout(function () { window.location.href = '/sav/confirmation/' + encodeURIComponent(numero); }, 1500);
      });
    }).catch(function (err) {
      console.error('[SAV] exception', err);
      toast('Erreur réseau : ' + (err && err.message ? err.message : 'inconnue'), 'error');
      resetBtn();
    });
  });

  // ----------------- Init -----------------
  restoreDraft();
  showStep(current);
})();
