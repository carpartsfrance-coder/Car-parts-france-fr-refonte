// Fonction pour forcer le rechargement de la page (conservée pour référence future)
function forcePageReload() {
    // Ajouter un paramètre unique à l'URL pour forcer le rechargement sans cache
    const cacheBuster = new Date().getTime();
    window.location.href = window.location.pathname + '?cache=' + cacheBuster;
}

// Fonction pour afficher une notification d'erreur
function showErrorNotification(message, title = 'Attention') {
    const container = document.getElementById('error-notification-container');
    
    // Créer la notification
    const notification = document.createElement('div');
    notification.className = 'error-notification';
    
    // Contenu de la notification
    notification.innerHTML = `
        <div class="error-notification-icon">
            <i class="fas fa-exclamation-circle"></i>
        </div>
        <div class="error-notification-content">
            <div class="error-notification-title">${title}</div>
            <div class="error-notification-message">${message}</div>
        </div>
        <div class="error-notification-close">
            <i class="fas fa-times"></i>
        </div>
    `;
    
    // Ajouter au conteneur
    container.appendChild(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Fermeture au clic
    const closeBtn = notification.querySelector('.error-notification-close');
    closeBtn.addEventListener('click', () => {
        closeErrorNotification(notification);
    });
    
    // Fermeture automatique après 5 secondes
    setTimeout(() => {
        closeErrorNotification(notification);
    }, 5000);
    
    return notification;
}

// Fonction pour fermer une notification d'erreur
function closeErrorNotification(notification) {
    notification.classList.add('hide');
    notification.classList.remove('show');
    
    // Supprimer après l'animation
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

// Fonction pour mettre en évidence les champs en erreur
function highlightErrorField(field, message) {
    // Ajouter la classe d'erreur au champ
    field.classList.add('field-error');
    
    // Vérifier si un message d'erreur existe déjà
    let errorMsg = field.parentNode.querySelector('.field-error-message');
    
    // Si le message n'existe pas, le créer
    if (!errorMsg && message) {
        errorMsg = document.createElement('div');
        errorMsg.className = 'field-error-message';
        field.parentNode.appendChild(errorMsg);
    }
    
    // Mettre à jour le message
    if (errorMsg && message) {
        errorMsg.textContent = message;
    }
    
    // Supprimer l'erreur lors de la modification du champ
    field.addEventListener('input', function() {
        field.classList.remove('field-error');
        if (errorMsg) {
            errorMsg.remove();
        }
    }, { once: true });
}

// Fonction pour initialiser la FAQ contextuelle
function initContextualFAQ() {
    // Récupérer les éléments du DOM
    const faqPanel = document.getElementById('faq-panel');
    const faqContent = document.getElementById('faq-content');
    const faqToggle = document.getElementById('faq-toggle');
    const faqStepNumber = document.getElementById('faq-step-number');
    const faqStepTitle = document.getElementById('faq-step-title');
    
    // Charger les FAQ pour l'étape actuelle
    loadFAQForStep('1');
    
    // Gérer le clic sur le bouton de bascule (afficher/masquer)
    faqToggle.addEventListener('click', function() {
        faqPanel.classList.toggle('collapsed');
        const toggleText = faqPanel.classList.contains('collapsed') ? 'Afficher l\'aide' : 'Masquer l\'aide';
        faqToggle.querySelector('.faq-toggle-text').textContent = toggleText;
    });
    
    // Les questions sont maintenant les mêmes pour toutes les étapes, donc nous n'avons plus besoin de les changer
    // Nous gardons juste le code pour ouvrir/fermer le panneau FAQ
}

// Fonction pour charger les FAQ spécifiques à une étape
function loadFAQForStep(stepNumber) {
    const faqContent = document.getElementById('faq-content');
    
    // Vider le contenu actuel
    faqContent.innerHTML = '';
    
    // Utiliser les questions globales pour toutes les étapes
    if (faqData['global'] && faqData['global'].length > 0) {
        // Créer les éléments FAQ pour chaque question/réponse
        faqData['global'].forEach((item, index) => {
            const faqItem = document.createElement('div');
            faqItem.className = 'faq-item';
            
            const faqQuestion = document.createElement('div');
            faqQuestion.className = 'faq-question';
            faqQuestion.innerHTML = `
                <span>${item.question}</span>
                <i class="fas fa-chevron-right"></i>
            `;
            
            const faqAnswer = document.createElement('div');
            faqAnswer.className = 'faq-answer';
            faqAnswer.innerHTML = `<p>${item.answer}</p>`;
            
            // Ajouter un gestionnaire d'événement pour afficher/masquer la réponse
            faqQuestion.addEventListener('click', function() {
                faqQuestion.classList.toggle('active');
                faqAnswer.classList.toggle('active');
            });
            
            // Ajouter les éléments au conteneur
            faqItem.appendChild(faqQuestion);
            faqItem.appendChild(faqAnswer);
            faqContent.appendChild(faqItem);
        });
    } else {
        // Message si aucune FAQ n'est disponible
        faqContent.innerHTML = `<div class="faq-empty">Aucune question fréquente disponible.</div>`;
    }
}

// Fonction pour améliorer la sélection des boutons radio et cases à cocher personnalisés
function enhanceCustomInputs() {
    // Améliorer les boutons radio personnalisés
    document.querySelectorAll('.custom-radio').forEach(radioContainer => {
        // Récupérer l'input radio et le label associé
        const radioInput = radioContainer.querySelector('input[type="radio"]');
        const radioLabel = radioContainer.querySelector('label');
        const radioCheckmark = radioContainer.querySelector('.radio-checkmark');
        
        if (radioInput && radioLabel && radioCheckmark) {
            // Ajouter un gestionnaire d'événement au conteneur
            radioContainer.addEventListener('click', function(e) {
                // Vérifier si le clic n'est pas déjà sur l'input lui-même
                if (e.target !== radioInput) {
                    // Simuler un clic sur l'input radio
                    radioInput.checked = true;
                    
                    // Déclencher l'événement change pour activer les éventuels gestionnaires
                    const event = new Event('change', { bubbles: true });
                    radioInput.dispatchEvent(event);
                }
            });
        }
    });
    
    // Améliorer les cases à cocher personnalisées
    document.querySelectorAll('.custom-checkbox').forEach(checkboxContainer => {
        // Récupérer l'input checkbox et le label associé
        const checkboxInput = checkboxContainer.querySelector('input[type="checkbox"]');
        const checkboxLabel = checkboxContainer.querySelector('label');
        const checkmark = checkboxContainer.querySelector('.checkmark');
        
        if (checkboxInput && checkboxLabel && checkmark) {
            // Ajouter un gestionnaire d'événement au conteneur
            checkboxContainer.addEventListener('click', function(e) {
                // Vérifier si le clic n'est pas déjà sur l'input lui-même
                if (e.target !== checkboxInput) {
                    // Inverser l'état de la case à cocher
                    checkboxInput.checked = !checkboxInput.checked;
                    
                    // Déclencher l'événement change pour activer les éventuels gestionnaires
                    const event = new Event('change', { bubbles: true });
                    checkboxInput.dispatchEvent(event);
                }
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
    // Améliorer la sélection des boutons radio et cases à cocher personnalisés
    enhanceCustomInputs();
    
    // Initialiser la FAQ contextuelle
    initContextualFAQ();
    
    // S'assurer que le message de succès est caché au chargement
    document.getElementById('success-message').classList.add('hidden');
    
    // Variables globales - définies en premier pour être accessibles partout
    const form = document.getElementById('sav-form');
    const steps = document.querySelectorAll('.form-step');
    const progressSteps = document.querySelectorAll('.progress-bar .step');
    let currentStep = 1;
    
    // Nous allons désactiver la double écoute du submit et la validation automatique du formulaire
    if (form) {
        // Désactiver la validation native du navigateur
        form.setAttribute('novalidate', 'novalidate');
    }
    
    // Gestionnaire pour le type de réclamation
    const claimTypeSelect = document.getElementById('claim_type');
    if (claimTypeSelect) {
        claimTypeSelect.addEventListener('change', function() {
            handleClaimTypeChange(this.value);
        });
    }
    
    // Initialiser la barre de progression colorée
    const afterElement = document.createElement('style');
    afterElement.textContent = `.progress-bar::after { width: 0%; }`;
    document.head.appendChild(afterElement);
    
    // Initialiser les tooltips pour les infobulles
    initTooltips();
    
    // Charger les données sauvegardées si elles existent
    // Déplacé après les définitions de fonctions pour éviter les erreurs
    if (typeof loadSavedFormData === 'function') {
        loadSavedFormData();
    }
    
    // Initialisation - toujours afficher l'étape 1 au démarrage
    showStep(currentStep);
    
    // Événements pour les boutons de navigation
    document.querySelectorAll('.next-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (validateStep(currentStep)) {
                nextStep();
            }
        });
    });
    
    document.querySelectorAll('.prev-btn').forEach(btn => {
        btn.addEventListener('click', prevStep);
    });
    
    // Événements pour les champs conditionnels
    // Gestion du champ conditionnel pour autre panne
    document.getElementById('panne_autre').addEventListener('change', function() {
        if(this.checked) {
            document.getElementById('panne_autre_details').classList.remove('hidden');
        }
    });
    
    // Masquer les détails si on sélectionne une autre option
    document.querySelectorAll('input[name="panne_apparition"]').forEach(radio => {
        if(radio.id !== 'panne_autre') {
            radio.addEventListener('change', function() {
                if(this.checked) {
                    document.getElementById('panne_autre_details').classList.add('hidden');
                }
            });
        }
    });
    
    // Gestion du champ conditionnel pour montage pro
    document.getElementById('pro_oui').addEventListener('change', function() {
        if(this.checked) {
            document.getElementById('justificatif_pro').classList.remove('hidden');
        }
    });
    
    document.getElementById('pro_non').addEventListener('change', function() {
        if(this.checked) {
            document.getElementById('justificatif_pro').classList.add('hidden');
        }
    });
    
    // Gestion du champ conditionnel pour la mise en huile
    document.getElementById('huile_oui').addEventListener('change', function() {
        if(this.checked) {
            document.getElementById('details_huile').classList.remove('hidden');
        }
    });
    
    document.getElementById('huile_non').addEventListener('change', function() {
        if(this.checked) {
            document.getElementById('details_huile').classList.add('hidden');
        }
    });
    
    // Gestion du champ conditionnel pour pièces neuves
    document.getElementById('pieces_oui').addEventListener('change', function() {
        if(this.checked) {
            document.getElementById('details_pieces').classList.remove('hidden');
        }
    });
    
    document.getElementById('pieces_non').addEventListener('change', function() {
        if(this.checked) {
            document.getElementById('details_pieces').classList.add('hidden');
        }
    });
    
    // Événement pour le changement de type de pièce
    document.getElementById('type_piece').addEventListener('change', function() {
        updateUploadSection(this.value);
    });
    
    // Fonction pour initialiser les champs conditionnels au chargement de la page
    function initConditionalFields() {
        // Vérifier l'état des boutons radio au chargement
        
        // Montage professionnel
        if(document.getElementById('pro_oui').checked) {
            document.getElementById('justificatif_pro').classList.remove('hidden');
        }
        
        // Mise en huile
        if(document.getElementById('huile_oui').checked) {
            document.getElementById('details_huile').classList.remove('hidden');
        }
        
        // Pièces neuves
        if(document.getElementById('pieces_oui').checked) {
            document.getElementById('details_pieces').classList.remove('hidden');
        }
        
        // Panne autre
        if(document.getElementById('panne_autre') && document.getElementById('panne_autre').checked) {
            document.getElementById('panne_autre_details').classList.remove('hidden');
        }
    }
    
    // Initialisation des champs conditionnels au chargement de la page
    initConditionalFields();
    
    // Soumission du formulaire
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        if (validateStep(currentStep)) {
            submitForm();
        }
    });
    
    // Ajouter la gestion des barres de progression pour les téléchargements de fichiers
    document.querySelectorAll('input[type="file"]').forEach(fileInput => {
        fileInput.addEventListener('change', function() {
            if (this.files && this.files.length > 0) {
                const progressContainer = document.getElementById(`${this.id}_progress`);
                if (progressContainer) {
                    progressContainer.style.display = 'block';
                    simulateFileUploadProgress(this.id, progressContainer);
                }
            }
        });
    });
    
    // Sauvegarder automatiquement les données à chaque modification
    const formInputs = document.querySelectorAll('input, select, textarea');
    formInputs.forEach(input => {
        input.addEventListener('change', saveFormData);
        input.addEventListener('input', debounce(saveFormData, 500));
        
        // Ajouter la validation en temps réel
        if (input.hasAttribute('required')) {
            input.addEventListener('blur', function() {
                validateField(input);
            });
            
            if (input.type !== 'file' && input.type !== 'radio' && input.type !== 'checkbox') {
                input.addEventListener('input', debounce(function() {
                    validateField(input);
                }, 300));
            }
        }
    });
    
    // Validation en temps réel pour les groupes de boutons radio
    const radioGroups = {};
    document.querySelectorAll('input[type="radio"][required]').forEach(radio => {
        if (!radioGroups[radio.name]) {
            radioGroups[radio.name] = true;
            const radios = document.querySelectorAll(`input[name="${radio.name}"]`);
            radios.forEach(r => {
                r.addEventListener('change', function() {
                    validateRadioGroup(radio.name);
                });
            });
        }
    });
    
    // Fonctions
    function showStep(step) {
        // Cacher toutes les étapes
        steps.forEach(s => s.classList.remove('active'));
        
        // Afficher l'étape actuelle
        const currentStepElement = document.getElementById(`step-${step}`);
        if (currentStepElement) {
            currentStepElement.classList.add('active');
        } else {
            console.error(`Étape ${step} introuvable`);
            // Par défaut, afficher la première étape si l'étape demandée n'existe pas
            document.getElementById('step-1').classList.add('active');
        }
        
        // Mettre à jour la barre de progression
        const progressSteps = document.querySelectorAll('.progress-bar .step');
        progressSteps.forEach(s => {
            const stepNum = parseInt(s.dataset.step);
            s.classList.remove('active', 'completed');
            
            if (stepNum === step) {
                s.classList.add('active');
            } else if (stepNum < step) {
                s.classList.add('completed');
            }
        });
        
        // Mettre à jour la barre de progression colorée
        const progressBar = document.querySelector('.progress-bar');
        const progressPercentage = ((step - 1) / (progressSteps.length - 1)) * 100;
        
        // Mettre à jour la largeur de la barre colorée avec un élément de style
        const styleId = 'progress-bar-style';
        let styleElement = document.getElementById(styleId);
        
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
        }
        
        styleElement.textContent = `.progress-bar::after { width: ${progressPercentage}%; }`;
        
        // Actions spécifiques à certaines étapes
        if (step === 4) {
            const claimType = document.getElementById('claim_type').value;
            
            if (claimType === 'piece_defectueuse') {
                const typePiece = document.getElementById('type_piece').value;
                updateUploadSection(typePiece, true); // true = afficher section OBD
            } else {
                // Pour les autres types de réclamation, ne pas afficher la section OBD
                updateUploadSection('autres', false); // Utiliser 'autres' comme valeur par défaut et false pour masquer OBD
            }
        } else if (step === 5) {
            generateRecap();
        }
    }
        
    function nextStep() {
        if (currentStep < steps.length) {
            // Gestion spéciale pour l'étape 2 vers l'étape 3 en fonction du type de réclamation
            if (currentStep === 2) {
                const claimType = document.getElementById('claim_type').value;
                
                // Si le type de réclamation n'est pas "pièce défectueuse", sauter l'étape 3 (techniques)
                if (claimType !== 'piece_defectueuse') {
                    currentStep = 3; // On est à l'étape 2, donc on saute à l'étape 4
                }
            }
            
            currentStep++;
            showStep(currentStep);
            window.scrollTo(0, 0);
        }
    }
    
    function prevStep() {
        if (currentStep > 1) {
            // Gestion spéciale pour revenir de l'étape 4 à l'étape 2 si le type n'est pas "pièce défectueuse"
            if (currentStep === 4) {
                const claimType = document.getElementById('claim_type').value;
                
                // Si le type de réclamation n'est pas "pièce défectueuse", sauter l'étape 3 en retour
                if (claimType !== 'piece_defectueuse') {
                    currentStep = 3; // On est à l'étape 4, donc on revient à l'étape 2
                }
            }
            
            currentStep--;
            showStep(currentStep);
            window.scrollTo(0, 0);
        }
    }
    
    function validateStep(step) {
        const currentStepElement = document.getElementById(`step-${step}`);
        const requiredFields = currentStepElement.querySelectorAll('[required]');
        
        let isValid = true;
        
        requiredFields.forEach(field => {
            // Réinitialiser les styles d'erreur
            field.style.borderColor = '';
            
            if (field.type === 'radio') {
                // Pour les boutons radio, vérifier si au moins un du même nom est coché
                const name = field.name;
                const checked = currentStepElement.querySelector(`input[name="${name}"]:checked`);
                
                if (!checked) {
                    isValid = false;
                    // Trouver le label parent et l'ajouter à la liste des champs avec erreur
                    const radioGroup = field.closest('.radio-group');
                    if (radioGroup) {
                        radioGroup.previousElementSibling.style.color = 'var(--primary-color)';
                    }
                }
            } else if (field.type === 'checkbox') {
                if (!field.checked) {
                    isValid = false;
                    field.nextElementSibling.style.color = 'var(--primary-color)';
                }
            } else {
                // Pour les autres types de champs
                if (!field.value.trim()) {
                    isValid = false;
                    field.style.borderColor = 'var(--primary-color)';
                }
            }
        });
        
        // Validations conditionnelles
        if (step === 3) {
            // Si "Pièce montée par un professionnel" est "Oui", le justificatif est requis
            if (document.getElementById('pro_oui').checked) {
                const justificatif = document.getElementById('justificatif_pro_file');
                if (!justificatif.files.length) {
                    isValid = false;
                    justificatif.style.borderColor = 'var(--primary-color)';
                }
            }
            
            // Si "Mise en huile effectuée" est "Oui", les détails sont requis
            if (document.getElementById('huile_oui').checked) {
                const quantite = document.getElementById('quantite_huile');
                const reference = document.getElementById('reference_huile');
                
                if (!quantite.value.trim()) {
                    isValid = false;
                    quantite.style.borderColor = 'var(--primary-color)';
                }
                
                if (!reference.value.trim()) {
                    isValid = false;
                    reference.style.borderColor = 'var(--primary-color)';
                }
            }
            
            // Si "Pièces neuves remplacées" est "Oui", les détails sont requis
            if (document.getElementById('pieces_oui').checked) {
                const details = document.getElementById('pieces_details');
                const factures = document.getElementById('factures_pieces');
                
                if (!details.value.trim()) {
                    isValid = false;
                    details.style.borderColor = 'var(--primary-color)';
                }
                
                if (!factures.files.length) {
                    isValid = false;
                    factures.style.borderColor = 'var(--primary-color)';
                }
            }
        }
        
        // Validation des fichiers à l'étape 4
        if (step === 4) {
            const requiredUploads = document.querySelectorAll('.upload-required');
            requiredUploads.forEach(upload => {
                if (!upload.files.length) {
                    isValid = false;
                    upload.style.borderColor = 'var(--primary-color)';
                }
            });
        }
        
        if (!isValid) {
            // Afficher une notification d'erreur
            showErrorNotification('Veuillez remplir tous les champs obligatoires.', 'Formulaire incomplet');
            
            // Mettre en évidence les champs en erreur
            requiredFields.forEach(field => {
                if (field.type === 'radio') {
                    // Pour les boutons radio, vérifier si aucun du même nom n'est coché
                    const name = field.getAttribute('name');
                    const checked = currentStepElement.querySelector(`input[name="${name}"]:checked`);
                    if (!checked) {
                        // Mettre en évidence le groupe de boutons radio
                        const radioGroup = field.closest('.radio-group');
                        if (radioGroup) {
                            radioGroup.classList.add('field-error');
                            // Supprimer l'erreur lors du clic sur un bouton radio
                            const radios = radioGroup.querySelectorAll('input[type="radio"]');
                            radios.forEach(radio => {
                                radio.addEventListener('change', function() {
                                    radioGroup.classList.remove('field-error');
                                }, { once: true });
                            });
                        }
                    }
                } else if (field.type === 'checkbox' && !field.checked) {
                    highlightErrorField(field, 'Ce champ est obligatoire');
                } else if (field.value.trim() === '') {
                    highlightErrorField(field, 'Ce champ est obligatoire');
                }
            });
        }
        
        return isValid;
    }
    
    function updateUploadSection(typePiece, showOBDSection = true) {
        const uploadSection = document.getElementById('upload-section');
        uploadSection.innerHTML = '';
        
        // Structure conditionnelle - n'afficher la section OBD que si showOBDSection est true
        if (showOBDSection) {
            const uploadHTML = `
                <div class="upload-item">
                    <h3>LECTURE OBD ${typePiece !== 'autres' ? '(OBLIGATOIRE)' : ''}</h3>
                    <label for="lecture_obd">Fichier de diagnostic 
                        <span class="tooltip-container">
                            <span class="tooltip-icon">i</span>
                            <div class="tooltip-content">
                                <div class="tooltip-title">Diagnostic électronique</div>
                                <p>Ce document est essentiel pour :</p>
                                <ul>
                                    <li>Identifier les codes d'erreur enregistrés</li>
                                    <li>Vérifier les paramètres de fonctionnement</li>
                                    <li>Déterminer si le véhicule communique correctement</li>
                                </ul>
                                <p>Même sans communication, veuillez fournir une capture d'écran de la tentative de lecture.</p>
                            </div>
                        </span>
                    </label>
                    <input type="file" id="lecture_obd" name="lecture_obd" accept=".jpg,.jpeg,.png,.pdf" ${typePiece !== 'autres' ? 'class="upload-required"' : ''}>
                    <div class="upload-progress-container" id="lecture_obd_progress" style="display: none;">
                        <div class="upload-progress-bar"></div>
                        <div class="upload-progress-text">0%</div>
                    </div>
                    <p class="file-requirements">Formats acceptés : JPG, PNG, PDF - Taille max : 5 Mo</p>
                </div>
            `;
            
            uploadSection.innerHTML = uploadHTML;
        } else {
            // Section générique pour les autres types de réclamation
            const claimType = document.getElementById('claim_type').value;
            let sectionTitle = "";
            let sectionDescription = "";
            
            switch(claimType) {
                case 'probleme_livraison':
                    sectionTitle = "DOCUMENTS DE LIVRAISON";
                    sectionDescription = "Photos du colis, preuve de livraison, etc.";
                    break;
                case 'erreur_reference':
                    sectionTitle = "PHOTOS DE LA PIÈCE REÇUE";
                    sectionDescription = "Photos de la pièce reçue, étiquettes, emballage, etc.";
                    break;
                case 'autre':
                    sectionTitle = "DOCUMENTS JUSTIFICATIFS";
                    sectionDescription = "Photos ou documents relatifs à votre réclamation";
                    break;
                default:
                    sectionTitle = "DOCUMENTS JUSTIFICATIFS";
                    sectionDescription = "Photos ou documents relatifs à votre réclamation";
            }
            
            const genericUploadHTML = `
                <div class="upload-item">
                    <h3>${sectionTitle}</h3>
                    <label for="documents_reclamation">Joindre des documents 
                        <span class="tooltip-container">
                            <span class="tooltip-icon">i</span>
                            <div class="tooltip-content">
                                <div class="tooltip-title">Documents justificatifs</div>
                                <p>${sectionDescription}</p>
                                <p>Ces éléments nous aideront à traiter plus rapidement votre réclamation.</p>
                            </div>
                        </span>
                    </label>
                    <input type="file" id="documents_reclamation" name="documents_reclamation" accept=".jpg,.jpeg,.png,.pdf" multiple>
                    <div class="upload-progress-container" id="documents_reclamation_progress" style="display: none;">
                        <div class="upload-progress-bar"></div>
                        <div class="upload-progress-text">0%</div>
                    </div>
                    <p class="file-requirements">Formats acceptés : JPG, PNG, PDF - Taille max : 5 Mo</p>
                </div>
            `;
            
            uploadSection.innerHTML = genericUploadHTML;
        }
        
        // Ajouter des champs spécifiques selon le type de pièce
        switch(typePiece) {
            case 'mecatronique':
                uploadSection.innerHTML += `
                    <div class="upload-item">
                        <h3>PHOTO DE LA PIÈCE (FACULTATIF)</h3>
                        <label for="photo_piece">Photos de la pièce 
                            <span class="tooltip-container">
                                <span class="tooltip-icon">i</span>
                                <div class="tooltip-content">
                                    <div class="tooltip-title">Photos du problème</div>
                                    <p>Des photos claires nous aident à :</p>
                                    <ul>
                                        <li>Identifier visuellement le problème</li>
                                        <li>Évaluer l'état général de la pièce</li>
                                        <li>Détecter d'éventuels signes d'usure anormale</li>
                                    </ul>
                                    <p>Conseil : Prenez plusieurs photos sous différents angles avec un bon éclairage.</p>
                                </div>
                            </span>
                        </label>
                        <input type="file" id="photo_piece" name="photo_piece" accept=".jpg,.jpeg,.png,.pdf" multiple>
                        <div class="upload-progress-container" id="photo_piece_progress" style="display: none;">
                            <div class="upload-progress-bar"></div>
                            <div class="upload-progress-text">0%</div>
                        </div>
                        <p class="file-requirements">Formats acceptés : JPG, PNG, PDF - Taille max : 5 Mo</p>
                    </div>
                `;
                break;
                
            case 'boite_transfert':
                uploadSection.innerHTML += `
                    <div class="upload-item">
                        <h3>PHOTO / VIDÉO (FACULTATIF)</h3>
                        <label for="media_boite_transfert">Médias 
                            <span class="tooltip-container">
                                <span class="tooltip-icon">i</span>
                                <div class="tooltip-content">
                                    <div class="tooltip-title">Médias de diagnostic</div>
                                    <p>Les médias sont particulièrement utiles pour les boîtes de transfert :</p>
                                    <ul>
                                        <li><strong>Photos</strong> : Fuites d'huile, état des joints, usure visible</li>
                                        <li><strong>Vidéos</strong> : Bruits anormaux, vibrations, comportement lors des changements de mode</li>
                                        <li><strong>Audio</strong> : Enregistrements des claquements ou grincements</li>
                                    </ul>
                                    <p>Pour les vidéos, un format court (30s maximum) avec un bon éclairage est préférable.</p>
                                </div>
                            </span>
                        </label>
                        <input type="file" id="media_boite_transfert" name="media_boite_transfert" accept=".jpg,.jpeg,.png,.pdf,.mp4" multiple>
                        <div class="upload-progress-container" id="media_boite_transfert_progress" style="display: none;">
                            <div class="upload-progress-bar"></div>
                            <div class="upload-progress-text">0%</div>
                        </div>
                        <p class="file-requirements">Formats acceptés : JPG, PNG, PDF, MP4 - Taille max : 5 Mo</p>
                    </div>
                `;
                break;
                
            case 'moteur':
                uploadSection.innerHTML += `
                    <div class="upload-item">
                        <h3>PHOTOS DU MOTEUR (FACULTATIF)</h3>
                        <label for="photos_moteur">Photos du moteur 
                            <span class="tooltip-container">
                                <span class="tooltip-icon">i</span>
                                <div class="tooltip-content">
                                    <div class="tooltip-title">Photos du moteur</div>
                                    <p>Des photos détaillées du moteur nous aident à évaluer :</p>
                                    <ul>
                                        <li>L'état général du bloc moteur</li>
                                        <li>La présence de fuites d'huile ou de liquide de refroidissement</li>
                                        <li>L'état des connecteurs et faisceaux électriques</li>
                                        <li>Les signes d'usure ou de surchauffe</li>
                                    </ul>
                                    <p>Prenez des photos de plusieurs angles, notamment des zones problématiques.</p>
                                </div>
                            </span>
                        </label>
                        <input type="file" id="photos_moteur" name="photos_moteur" accept=".jpg,.jpeg,.png,.pdf" multiple>
                        <div class="upload-progress-container" id="photos_moteur_progress" style="display: none;">
                            <div class="upload-progress-bar"></div>
                            <div class="upload-progress-text">0%</div>
                        </div>
                        <p class="file-requirements">Formats acceptés : JPG, PNG, PDF - Taille max : 5 Mo</p>
                    </div>
                    <div class="upload-item">
                        <h3>FACTURES D'ENTRETIEN (FACULTATIF)</h3>
                        <label for="factures_entretien">Factures d'entretien 
                            <span class="tooltip-container">
                                <span class="tooltip-icon">i</span>
                                <div class="tooltip-content">
                                    <div class="tooltip-title">Historique d'entretien</div>
                                    <p>Les factures d'entretien nous permettent de :</p>
                                    <ul>
                                        <li>Vérifier la régularité des entretiens du véhicule</li>
                                        <li>Confirmer les interventions récentes sur le moteur</li>
                                        <li>Identifier d'éventuels problèmes récurrents</li>
                                        <li>Vérifier les pièces déjà remplacées</li>
                                    </ul>
                                    <p>Incluez particulièrement les factures des 2 dernières années ou des 30 000 derniers kilomètres.</p>
                                </div>
                            </span>
                        </label>
                        <input type="file" id="factures_entretien" name="factures_entretien" accept=".jpg,.jpeg,.png,.pdf" multiple>
                        <div class="upload-progress-container" id="factures_entretien_progress" style="display: none;">
                            <div class="upload-progress-bar"></div>
                            <div class="upload-progress-text">0%</div>
                        </div>
                        <p class="file-requirements">Formats acceptés : JPG, PNG, PDF - Taille max : 5 Mo</p>
                    </div>
                `;
                break;
                
            case 'pont':
            case 'boite_vitesses':
                uploadSection.innerHTML += `
                    <div class="upload-item">
                        <h3>PHOTO / VIDÉO (FACULTATIF)</h3>
                        <label for="media_transmission">Médias 
                            <span class="tooltip-container">
                                <span class="tooltip-icon">i</span>
                                <div class="tooltip-content">
                                    <div class="tooltip-title">Médias de diagnostic</div>
                                    <p>Les médias sont essentiels pour diagnostiquer les problèmes de transmission :</p>
                                    <ul>
                                        <li><strong>Boîte de vitesses</strong> : Vidéos des difficultés de passage de vitesses, bruits lors des changements de rapport</li>
                                        <li><strong>Pont/Différentiel</strong> : Bruits en virage, à vitesse constante ou en accélération</li>
                                        <li><strong>Fuites</strong> : Photos des traces d'huile sous le véhicule ou sur les pièces</li>
                                    </ul>
                                    <p>Si possible, incluez une vidéo avec le son du problème en conditions réelles.</p>
                                </div>
                            </span>
                        </label>
                        <input type="file" id="media_transmission" name="media_transmission" accept=".jpg,.jpeg,.png,.pdf,.mp4" multiple>
                        <div class="upload-progress-container" id="media_transmission_progress" style="display: none;">
                            <div class="upload-progress-bar"></div>
                            <div class="upload-progress-text">0%</div>
                        </div>
                        <p class="file-requirements">Formats acceptés : JPG, PNG, PDF, MP4 - Taille max : 5 Mo</p>
                    </div>
                    <div class="upload-item">
                        <h3>FACTURES (FACULTATIF)</h3>
                        <label for="factures_transmission">Factures 
                            <span class="tooltip-container">
                                <span class="tooltip-icon">i</span>
                                <div class="tooltip-content">
                                    <div class="tooltip-title">Justificatifs de réparation</div>
                                    <p>Les factures de réparation nous aident à comprendre :</p>
                                    <ul>
                                        <li>Les interventions déjà réalisées sur la transmission</li>
                                        <li>Les pièces qui ont été remplacées récemment</li>
                                        <li>Les tentatives de résolution du problème</li>
                                        <li>L'historique des vidanges et entretiens</li>
                                    </ul>
                                    <p>Ces informations sont précieuses pour éviter de répéter des interventions déjà effectuées.</p>
                                </div>
                            </span>
                        </label>
                        <input type="file" id="factures_transmission" name="factures_transmission" accept=".jpg,.jpeg,.png,.pdf" multiple>
                        <div class="upload-progress-container" id="factures_transmission_progress" style="display: none;">
                            <div class="upload-progress-bar"></div>
                            <div class="upload-progress-text">0%</div>
                        </div>
                        <p class="file-requirements">Formats acceptés : JPG, PNG, PDF - Taille max : 5 Mo</p>
                    </div>
                `;
                break;
                
            case 'autres':
                uploadSection.innerHTML += `
                    <div class="upload-item">
                        <h3>DOCUMENTS UTILES (FACULTATIF)</h3>
                        <label for="documents_autres">Documents complémentaires 
                            <span class="tooltip-container">
                                <span class="tooltip-icon">i</span>
                                <div class="tooltip-content">
                                    <div class="tooltip-title">Documents de support</div>
                                    <p>Vous pouvez joindre tout document pertinent pour votre demande :</p>
                                    <ul>
                                        <li>Rapports de diagnostic d'un garage</li>
                                        <li>Historique d'entretien du véhicule</li>
                                        <li>Correspondances avec d'autres services techniques</li>
                                        <li>Photos ou vidéos supplémentaires du problème</li>
                                    </ul>
                                    <p>Ces documents complémentaires permettront une analyse plus précise de votre situation.</p>
                                </div>
                            </span>
                        </label>
                        <input type="file" id="documents_autres" name="documents_autres" accept=".jpg,.jpeg,.png,.pdf" multiple>
                        <div class="upload-progress-container" id="documents_autres_progress" style="display: none;">
                            <div class="upload-progress-bar"></div>
                            <div class="upload-progress-text">0%</div>
                        </div>
                        <p class="file-requirements">Formats acceptés : JPG, PNG, PDF - Taille max : 5 Mo</p>
                    </div>
                `;
                break;
        }
        
        // Ajouter les gestionnaires d'événements pour les barres de progression
        document.querySelectorAll('#upload-section input[type="file"]').forEach(fileInput => {
            fileInput.addEventListener('change', function() {
                if (this.files && this.files.length > 0) {
                    const progressContainer = document.getElementById(`${this.id}_progress`);
                    if (progressContainer) {
                        progressContainer.style.display = 'block';
                        simulateFileUploadProgress(this.id, progressContainer);
                    }
                }
            });
        });
    }
    
    // Fonctions auxiliaires pour les labels des types de réclamations
    function getClaimTypeLabel(value) {
        const labels = {
            'piece_defectueuse': 'Pièce défectueuse',
            'probleme_livraison': 'Problème de livraison',
            'erreur_reference': 'Erreur de référence/modèle',
            'autre': 'Autre problème'
        };
        return labels[value] || value;
    }
    
    function getCarrierLabel(value) {
        const labels = {
            'chronopost': 'Chronopost',
            'dhl': 'DHL',
            'dpd': 'DPD',
            'gls': 'GLS',
            'ups': 'UPS',
            'autre': 'Autre'
        };
        return labels[value] || value;
    }
    
    function getDeliveryProblemTypeLabel(value) {
        const labels = {
            'retard': 'Retard de livraison',
            'colis_endommage': 'Colis endommagé',
            'colis_perdu': 'Colis perdu',
            'livraison_partielle': 'Livraison partielle',
            'autre': 'Autre problème'
        };
        return labels[value] || value;
    }
    
    function getCompatibilityIssueLabel(value) {
        const labels = {
            'incompatible_vehicule': 'Incompatible avec mon véhicule',
            'incompatible_piece': 'Incompatible avec une autre pièce',
            'autre': 'Autre problème de compatibilité'
        };
        return labels[value] || value;
    }
    
    function getOtherProblemTypeLabel(value) {
        const labels = {
            'facturation': 'Problème de facturation',
            'remboursement': 'Problème de remboursement',
            'garantie': 'Question de garantie',
            'autre': 'Autre'
        };
        return labels[value] || value;
    }
    
    function formatDate(dateString) {
        if (!dateString) return 'Non spécifiée';
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR');
    }
    
    function generateRecap() {
        const recap = document.getElementById('recap');
        const formData = new FormData(form);
        const claimType = formData.get('claim_type');
        
        let recapHTML = `
            <div class="recap-section">
                <h3>Identification</h3>
                <div class="recap-item">
                    <div class="recap-label">Nom et prénom :</div>
                    <div class="recap-value highlight">${formData.get('nom')} ${formData.get('prenom')}</div>
                </div>
                <div class="recap-item">
                    <div class="recap-label">Email :</div>
                    <div class="recap-value">${formData.get('email')}</div>
                </div>
                <div class="recap-item">
                    <div class="recap-label">Téléphone :</div>
                    <div class="recap-value">${formData.get('telephone')}</div>
                </div>
                <div class="recap-item">
                    <div class="recap-label">N° de commande :</div>
                    <div class="recap-value highlight">${formData.get('commande')}</div>
                </div>
                <div class="recap-item">
                    <div class="recap-label">VIN / Immatriculation :</div>
                    <div class="recap-value highlight">${formData.get('vin')}</div>
                </div>
            </div>
            
            <div class="recap-section">
                <h3>Type de réclamation</h3>
                <div class="recap-item">
                    <div class="recap-label">Type de réclamation :</div>
                    <div class="recap-value highlight">${getClaimTypeLabel(claimType)}</div>
                </div>
            </div>
        `;
        
        // Ajouter les informations spécifiques selon le type de réclamation
        switch (claimType) {
            case 'piece_defectueuse':
                recapHTML += `
                    <div class="recap-section">
                        <h3>Pièce concernée</h3>
                        <div class="recap-item">
                            <div class="recap-label">Type de pièce :</div>
                            <div class="recap-value highlight">${getTypePieceLabel(formData.get('type_piece'))}</div>
                        </div>
                    </div>
                    
                    <div class="recap-section">
                        <h3>Description du problème</h3>
                        <div class="recap-item">
                            <div class="recap-label">Symptôme :</div>
                            <div class="recap-value highlight">${formData.get('symptome')}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Apparition de la panne :</div>
                            <div class="recap-value">${getApparitionPanneLabel(formData.get('panne_apparition'))}</div>
                        </div>
                    </div>
                `;
                break;
                
            case 'probleme_livraison':
                recapHTML += `
                    <div class="recap-section">
                        <h3>Détails de la livraison</h3>
                        <div class="recap-item">
                            <div class="recap-label">Numéro de suivi :</div>
                            <div class="recap-value highlight">${formData.get('tracking_number')}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Transporteur :</div>
                            <div class="recap-value">${getCarrierLabel(formData.get('carrier'))}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Date de livraison :</div>
                            <div class="recap-value">${formatDate(formData.get('delivery_date'))}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Type de problème :</div>
                            <div class="recap-value highlight">${getDeliveryProblemTypeLabel(formData.get('delivery_problem_type'))}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Description du problème :</div>
                            <div class="recap-value">${formData.get('delivery_problem_description')}</div>
                        </div>
                    </div>
                `;
                break;
                
            case 'erreur_reference':
                recapHTML += `
                    <div class="recap-section">
                        <h3>Détails de l'erreur de référence</h3>
                        <div class="recap-item">
                            <div class="recap-label">Référence reçue :</div>
                            <div class="recap-value highlight">${formData.get('received_reference')}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Référence attendue :</div>
                            <div class="recap-value highlight">${formData.get('expected_reference')}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Problème de compatibilité :</div>
                            <div class="recap-value">${getCompatibilityIssueLabel(formData.get('compatibility_issue'))}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Description du problème :</div>
                            <div class="recap-value">${formData.get('reference_error_description')}</div>
                        </div>
                    </div>
                `;
                break;
                
            case 'autre':
                recapHTML += `
                    <div class="recap-section">
                        <h3>Détails du problème</h3>
                        <div class="recap-item">
                            <div class="recap-label">Type de problème :</div>
                            <div class="recap-value highlight">${getOtherProblemTypeLabel(formData.get('other_problem_type'))}</div>
                        </div>
                        <div class="recap-item">
                            <div class="recap-label">Description du problème :</div>
                            <div class="recap-value">${formData.get('other_problem_description')}</div>
                        </div>
                    </div>
                `;
                break;
        }
                
                recapHTML += `<div class="recap-item">
                    <div class="recap-label">Codes défaut OBD :</div>
                    <div class="recap-value">${formData.get('codes_defaut') || 'Non fourni'}</div>
                </div>`;                
                
                recapHTML += `<div class="recap-item">
                    <div class="recap-label">Montage professionnel :</div>
                    <div class="recap-value">${formData.get('montage_pro') === 'oui' ? '<span class="highlight">Oui</span>' : 'Non'}</div>
                </div>`;                
                
                recapHTML += `<div class="recap-item">
                    <div class="recap-label">Mise en huile :</div>
                    <div class="recap-value">${formData.get('mise_huile') === 'oui' ? '<span class="highlight">Oui</span>' : 'Non'}</div>
                </div>`;                
                
                if(formData.get('mise_huile') === 'oui') {
                    recapHTML += `
                <div class="recap-item">
                    <div class="recap-label">Quantité d'huile :</div>
                    <div class="recap-value highlight">${formData.get('quantite_huile')} litres</div>
                </div>
                <div class="recap-item">
                    <div class="recap-label">Référence d'huile :</div>
                    <div class="recap-value">${formData.get('reference_huile')}</div>
                </div>
                `;
                }
                
                recapHTML += `<div class="recap-item">
                    <div class="recap-label">Pièces neuves remplacées :</div>
                    <div class="recap-value">${formData.get('pieces_neuves') === 'oui' ? '<span class="highlight">Oui</span>' : 'Non'}</div>
                </div>`;
                
                if(formData.get('pieces_neuves') === 'oui') {
                    recapHTML += `
                <div class="recap-item">
                    <div class="recap-label">Détails des pièces :</div>
                    <div class="recap-value">${formData.get('pieces_details')}</div>
                </div>
                `;
                }
                
                recapHTML += `
            </div>
            
            <div class="recap-section">
                <h3>Documents fournis</h3>
                <p>Les documents que vous avez téléchargés seront joints à votre demande.</p>
                <p><i class="fas fa-check-circle" style="color: var(--success-color);"></i> Tous les documents requis ont été fournis.</p>
            </div>
        `;
        
        recap.innerHTML = recapHTML;
        
        // Activer les boutons de modification
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const targetStep = parseInt(this.dataset.step);
                currentStep = targetStep;
                showStep(currentStep);
                window.scrollTo(0, 0);
            });
        });
    }
    
    function getTypePieceLabel(value) {
        const labels = {
            'mecatronique': 'Mécatronique / TCU',
            'boite_transfert': 'Boîte de transfert',
            'pont': 'Pont / Différentiel',
            'moteur': 'Moteur',
            'boite_vitesses': 'Boîte de vitesses',
            'autres': 'Autres'
        };
        
        return labels[value] || value;
    }
    
    function getApparitionPanneLabel(value) {
        const labels = {
            'montage': 'Dès le montage',
            '100km': 'Après 100 km',
            '500km': 'Après 500 km',
            'autre': document.querySelector('input[name="panne_autre_details"]').value
        };
        
        return labels[value] || value;
    }
    
    function submitForm() {
        console.log('Démarrage de la soumission du formulaire');
        
        // Identifier le type de réclamation sélectionné
        const claimType = document.getElementById('claim_type').value;
        console.log('Type de réclamation:', claimType);
        
        // Vérifier les champs obligatoires avant l'envoi
        console.log('Début de la validation des champs obligatoires');
        
        // Collecter les données spécifiques au type de réclamation
        const claimTypeData = collectClaimTypeData();
        console.log('Données spécifiques au type de réclamation:', claimTypeData);
        
        let erreurs = [];
        
        // Validation dynamique en fonction du type de réclamation sélectionné
        
        switch (claimType) {
            case 'piece_defectueuse':
                // Vérifier le type de pièce
                const typePiece = document.getElementById('type_piece');
                console.log('Select type_piece trouvé:', !!typePiece);
                if (typePiece) {
                    console.log('Valeur sélectionnée:', typePiece.value);
                    console.log('Options disponibles:', typePiece.options.length);
                }
                
                // Vérifier le champ des symptômes (symptome au singulier)
                const symptomeEl = document.getElementById('symptome');
                console.log('Champ symptome:', symptomeEl ? `trouvé, valeur: "${symptomeEl.value}"` : 'non trouvé');
                
                // Vérification des champs obligatoires pour pièce défectueuse
                if (!typePiece || typePiece.value === "" || typePiece.selectedIndex === 0) {
                    console.error('Validation échouée: type de pièce non sélectionné');
                    erreurs.push('Veuillez sélectionner un type de pièce');
                }
                
                if (!symptomeEl || !symptomeEl.value.trim()) {
                    console.error('Validation échouée: symptômes non renseignés');
                    erreurs.push('Veuillez décrire les symptômes');
                }
                break;
                
            case 'probleme_livraison':
                // Vérification des champs obligatoires pour problème de livraison
                const deliveryProblemType = document.getElementById('delivery_problem_type');
                
                // Les champs de numéro de suivi et transporteur ont été supprimés
                // donc on ne les vérifie plus
                
                if (!deliveryProblemType || deliveryProblemType.value === "" || deliveryProblemType.selectedIndex === 0) {
                    erreurs.push('Veuillez sélectionner le type de problème de livraison');
                }
                break;
                
            case 'erreur_reference':
                // Vérification des champs obligatoires pour erreur de référence
                const receivedReference = document.getElementById('received_reference');
                const expectedReference = document.getElementById('expected_reference');
                const compatibilityIssue = document.getElementById('compatibility_issue');
                
                if (!receivedReference || !receivedReference.value.trim()) {
                    erreurs.push('Veuillez indiquer la référence reçue');
                }
                
                if (!expectedReference || !expectedReference.value.trim()) {
                    erreurs.push('Veuillez indiquer la référence attendue');
                }
                
                if (!compatibilityIssue || compatibilityIssue.value === "" || compatibilityIssue.selectedIndex === 0) {
                    erreurs.push('Veuillez sélectionner le type de problème de compatibilité');
                }
                break;
                
            case 'autre':
                // Vérification des champs obligatoires pour autre problème
                const otherProblemType = document.getElementById('other_problem_type');
                const otherProblemDescription = document.getElementById('other_problem_description');
                
                if (!otherProblemType || otherProblemType.value === "" || otherProblemType.selectedIndex === 0) {
                    erreurs.push('Veuillez sélectionner le type de problème');
                }
                
                if (!otherProblemDescription || !otherProblemDescription.value.trim()) {
                    erreurs.push('Veuillez décrire le problème rencontré');
                }
                break;
                
            default:
                // Validation si aucun type de réclamation n'est sélectionné
                erreurs.push('Veuillez sélectionner un type de réclamation');
        }
        
        // Vérifier le HTML du formulaire pour voir les noms corrects des champs
        console.log('Structure du formulaire:');
        const formHTML = document.getElementById('sav-form').innerHTML;
        console.log('Validation dynamique effectuée pour le type:', claimType);
        
        // Si des erreurs sont détectées, afficher un message et arrêter l'envoi
        if (erreurs.length > 0) {
            const errorMessage = document.createElement('div');
            errorMessage.style.position = 'fixed';
            errorMessage.style.top = '20px';
            errorMessage.style.left = '50%';
            errorMessage.style.transform = 'translateX(-50%)';
            errorMessage.style.backgroundColor = '#f44336';
            errorMessage.style.color = 'white';
            errorMessage.style.padding = '15px';
            errorMessage.style.borderRadius = '5px';
            errorMessage.style.zIndex = '1000';
            errorMessage.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
            errorMessage.innerHTML = `<strong>Veuillez corriger les erreurs suivantes :</strong><br>${erreurs.join('<br>')}`;
            
            document.body.appendChild(errorMessage);
            
            // Faire défiler jusqu'au premier champ en erreur en fonction du type de réclamation
            const claimType = document.getElementById('claim_type').value;
            
            switch (claimType) {
                case 'piece_defectueuse':
                    const typePiece = document.getElementById('type_piece');
                    const symptomeEl = document.getElementById('symptome');
                    
                    if (!typePiece || typePiece.value === "" || typePiece.selectedIndex === 0) {
                        typePiece.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (!symptomeEl || !symptomeEl.value.trim()) {
                        symptomeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    break;
                    
                case 'probleme_livraison':
                    const trackingNumber = document.getElementById('tracking_number');
                    const carrier = document.getElementById('carrier');
                    const deliveryProblemType = document.getElementById('delivery_problem_type');
                    
                    if (!trackingNumber || !trackingNumber.value.trim()) {
                        trackingNumber.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (!carrier || carrier.value === "" || carrier.selectedIndex === 0) {
                        carrier.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (!deliveryProblemType || deliveryProblemType.value === "" || deliveryProblemType.selectedIndex === 0) {
                        deliveryProblemType.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    break;
                    
                case 'erreur_reference':
                    const receivedReference = document.getElementById('received_reference');
                    const expectedReference = document.getElementById('expected_reference');
                    const compatibilityIssue = document.getElementById('compatibility_issue');
                    
                    if (!receivedReference || !receivedReference.value.trim()) {
                        receivedReference.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (!expectedReference || !expectedReference.value.trim()) {
                        expectedReference.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (!compatibilityIssue || compatibilityIssue.value === "" || compatibilityIssue.selectedIndex === 0) {
                        compatibilityIssue.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    break;
                    
                case 'autre':
                    const otherProblemType = document.getElementById('other_problem_type');
                    const otherProblemDescription = document.getElementById('other_problem_description');
                    
                    if (!otherProblemType || otherProblemType.value === "" || otherProblemType.selectedIndex === 0) {
                        otherProblemType.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (!otherProblemDescription || !otherProblemDescription.value.trim()) {
                        otherProblemDescription.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    break;
                    
                default:
                    // Si aucun type n'est sélectionné, faire défiler jusqu'au sélecteur de type de réclamation
                    document.getElementById('claim_type').scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            // Supprimer le message d'erreur après 5 secondes
            setTimeout(() => {
                if (document.body.contains(errorMessage)) {
                    document.body.removeChild(errorMessage);
                }
            }, 5000);
            
            console.log('Validation échouée:', erreurs);
            return; // Arrêter l'envoi du formulaire
        }
        
        // Afficher l'overlay de chargement
        const loadingOverlay = document.createElement('div');
        loadingOverlay.style.position = 'fixed';
        loadingOverlay.style.top = '0';
        loadingOverlay.style.left = '0';
        loadingOverlay.style.width = '100%';
        loadingOverlay.style.height = '100%';
        loadingOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        loadingOverlay.style.display = 'flex';
        loadingOverlay.style.justifyContent = 'center';
        loadingOverlay.style.alignItems = 'center';
        loadingOverlay.style.zIndex = '1000';
        loadingOverlay.innerHTML = `<div style="background-color: white; padding: 20px; border-radius: 5px;">Envoi en cours...</div>`;
        document.body.appendChild(loadingOverlay);
        console.log('Overlay de chargement affiché');
        
        try {
            console.log('Début de la préparation des données');
            
            // Créer un nouvel objet FormData pour l'envoi multipart/form-data
            const formData = new FormData();
            console.log('FormData créé');
            
            // Créer un objet de données pour suivre ce qui est ajouté au FormData
            const ticketData = {};
            
            // Vérifier si les éléments existent avant d'accéder à leurs valeurs
            const prenomEl = document.getElementById('prenom');
            const nomEl = document.getElementById('nom');
            const emailEl = document.getElementById('email');
            const telephoneEl = document.getElementById('telephone');
            
            if (!prenomEl || !nomEl || !emailEl || !telephoneEl) {
                console.error('Un ou plusieurs champs client sont introuvables:', 
                    {prenom: !!prenomEl, nom: !!nomEl, email: !!emailEl, telephone: !!telephoneEl});
                throw new Error('Champs client introuvables');
            }
            
            // Ajouter les informations client
            console.log('Ajout des informations client');
            formData.append('firstName', prenomEl.value);
            formData.append('lastName', nomEl.value);
            formData.append('email', emailEl.value);
            formData.append('phone', telephoneEl.value);
            
            // Vérifier les champs de commande
            const numeroCommandeEl = document.getElementById('numero_commande');
            const dateCommandeEl = document.getElementById('date_commande');
            
            if (!numeroCommandeEl) {
                console.error('Champ numero_commande introuvable');
                throw new Error('Champ numero_commande introuvable');
            }
            
            // Ajouter les informations de commande
            console.log('Ajout des informations de commande');
            formData.append('orderNumber', numeroCommandeEl.value || 'Non spécifié');
            formData.append('orderDate', dateCommandeEl ? dateCommandeEl.value || '' : '');
            
            // Vérifier les champs véhicule
            console.log('Vérification des champs véhicule');
            const marqueEl = document.getElementById('marque');
            const modeleEl = document.getElementById('modele');
            const anneeEl = document.getElementById('annee');
            // Utiliser le bon ID pour le champ VIN
            const vinEl = document.getElementById('vin');
            const immatriculationEl = document.getElementById('immatriculation');
            const dateMontageEl = document.getElementById('date_montage');
            
            // Ajouter les informations du véhicule
            console.log('Ajout des informations du véhicule');
            formData.append('make', marqueEl ? marqueEl.value || '' : '');
            formData.append('model', modeleEl ? modeleEl.value || '' : '');
            formData.append('year', anneeEl ? anneeEl.value || '' : '');
            // Utiliser vinEl au lieu de numeroSerieEl
            formData.append('vin', vinEl ? vinEl.value || '' : '');
            formData.append('registrationNumber', immatriculationEl ? immatriculationEl.value || '' : '');
            // Utiliser dateMontageEl au lieu de dateInstallationEl
            formData.append('installationDate', dateMontageEl ? dateMontageEl.value || '' : '');
            
            // Vérifier les champs pièce
            console.log('Vérification des champs pièce');
            
            // Ajouter les informations de la pièce
            console.log('Ajout des informations de la pièce');
            const typePieceEl = document.getElementById('type_piece');
            console.log('Type de pièce sélectionné:', typePieceEl ? typePieceEl.value : 'aucun');
            console.log('Index sélectionné:', typePieceEl ? typePieceEl.selectedIndex : -1);
            console.log('Options disponibles:', typePieceEl ? Array.from(typePieceEl.options).map(o => `${o.value}: ${o.text}`).join(', ') : 'aucune');
            
            const partTypeValue = typePieceEl && typePieceEl.selectedIndex > 0 ? typePieceEl.value : '';
            console.log('Valeur partType à envoyer:', partTypeValue);
            
            // Stocker dans l'objet ticketData pour vérification
            ticketData.partType = partTypeValue;
            formData.append('partType', partTypeValue);
            
            const symptomeEl = document.getElementById('symptome');
            console.log('Champ symptome:', symptomeEl ? `trouvé, id=${symptomeEl.id}, name=${symptomeEl.name}` : 'non trouvé');
            console.log('Valeur symptome:', symptomeEl ? `"${symptomeEl.value}"` : 'aucune');
            
            const apparitionPanneEl = document.querySelector('input[name="panne_apparition"]:checked');
            const codesDefautEl = document.getElementById('codes_defaut');
            
            const symptomValue = symptomeEl ? symptomeEl.value || '' : '';
            console.log('Valeur symptom à envoyer:', symptomValue);
            
            // Stocker dans l'objet ticketData pour vérification
            ticketData.symptom = symptomValue;
            formData.append('symptom', symptomValue);
            formData.append('failureTime', apparitionPanneEl ? apparitionPanneEl.value || '' : '');
            formData.append('errorCodes', codesDefautEl ? codesDefautEl.value || '' : '');
            
            // Correction des noms de champs pour correspondre au formulaire HTML
            const installationPro = document.querySelector('input[name="montage_pro"]:checked');
            console.log('Installation pro:', installationPro ? installationPro.value : 'non sélectionné');
            formData.append('professionalInstallation', installationPro ? installationPro.value === 'oui' : false);
            formData.append('montage_pro', installationPro ? installationPro.value : 'non'); // Ajouter aussi le nom original
            
            const remplissageHuile = document.querySelector('input[name="mise_huile"]:checked');
            console.log('Remplissage huile:', remplissageHuile ? remplissageHuile.value : 'non sélectionné');
            formData.append('oilFilled', remplissageHuile ? remplissageHuile.value === 'oui' : false);
            formData.append('mise_huile', remplissageHuile ? remplissageHuile.value : 'non'); // Ajouter aussi le nom original
            
            const quantiteHuileEl = document.getElementById('quantite_huile');
            const referenceHuileEl = document.getElementById('reference_huile');
            
            formData.append('oilQuantity', quantiteHuileEl ? quantiteHuileEl.value || '' : '');
            formData.append('oilReference', referenceHuileEl ? referenceHuileEl.value || '' : '');
            
            const piecesNeuves = document.querySelector('input[name="pieces_neuves"]:checked');
            console.log('Pièces neuves:', piecesNeuves ? piecesNeuves.value : 'non sélectionné');
            formData.append('newParts', piecesNeuves ? piecesNeuves.value === 'oui' : false);
            
            // Correction: utiliser l'ID du textarea au lieu du div conteneur
            const detailsPiecesEl = document.getElementById('pieces_details');
            formData.append('newPartsDetails', detailsPiecesEl ? detailsPiecesEl.value || '' : '');
            formData.append('pieces_details', detailsPiecesEl ? detailsPiecesEl.value || '' : ''); // Ajouter aussi le nom original
            
            // Ajouter les données spécifiques au type de réclamation
            if (claimTypeData) {
                formData.append('claimType', claimTypeData.claimType);
                // Ajouter chaque propriété des données spécifiques au FormData
                Object.entries(claimTypeData.specificData).forEach(([key, value]) => {
                    formData.append(key, value);
                });
                console.log('Données spécifiques au type de réclamation ajoutées au formData');
            }
            
            // Ajouter tous les fichiers
            console.log('Préparation des fichiers');
            const fileInputs = document.querySelectorAll('input[type="file"]');
            console.log('Nombre d\'inputs de fichiers trouvés:', fileInputs.length);
            
            let filesAdded = 0;
            fileInputs.forEach((input, index) => {
                console.log(`Input de fichier ${index} (${input.id}):`, input.files.length, 'fichiers');
                if (input.files.length > 0) {
                    for (let i = 0; i < input.files.length; i++) {
                        console.log(`Ajout du fichier ${i} de l'input ${input.id}:`, input.files[i].name);
                        // Utiliser le nom du champ comme type de document
                        formData.append('documents', input.files[i]);
                        formData.append('documentTypes', input.id); // Envoyer le type de document correspondant
                        filesAdded++;
                    }
                }
            });
            console.log('Nombre total de fichiers ajoutés:', filesAdded);
            
            // Vérifier le contenu du FormData avant envoi
            console.log('FormData prêt pour envoi');
            for (let pair of formData.entries()) {
                if (pair[0] !== 'documents') { // Ne pas logger les fichiers binaires
                    console.log(pair[0] + ': ' + pair[1]);
                } else {
                    console.log(pair[0] + ': [Fichier]');
                }
            }
            
            // Vérification finale des données critiques
            console.log('Vérification finale des données critiques:');
            console.log('ticketData.partType =', ticketData.partType);
            console.log('ticketData.symptom =', ticketData.symptom);
            
            // Vérification des valeurs dans FormData (conversion en objet pour affichage)
            const formDataObj = {};
            for (let [key, value] of formData.entries()) {
                if (key !== 'documents') {
                    formDataObj[key] = value;
                } else {
                    formDataObj[key] = '[Fichier]';
                }
            }
            console.log('FormData complet:', formDataObj);
            
            // Envoyer les données au serveur
            console.log('Début de l\'envoi des données au serveur');
            fetch('/api/tickets', {
                method: 'POST',
                body: formData // Pas besoin de spécifier Content-Type, le navigateur le fait automatiquement
            })
            .then(response => {
                console.log('Réponse reçue du serveur:', response.status, response.statusText);
                if (!response.ok) {
                    console.error('Erreur HTTP:', response.status, response.statusText);
                    return response.text().then(text => {
                        console.error('Détails de l\'erreur:', text);
                        throw new Error(`Erreur ${response.status}: ${text || response.statusText}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                console.log('Données reçues du serveur:', data);
                
                // Retirer l'overlay de chargement
                document.body.removeChild(loadingOverlay);
                
                // Vérifier que les données contiennent un numéro de ticket
                if (!data.ticketNumber) {
                    console.error('Pas de numéro de ticket dans la réponse:', data);
                    throw new Error('Réponse invalide du serveur: pas de numéro de ticket');
                }
                
                // Afficher le numéro de ticket reçu du serveur
                const ticketNumberEl = document.getElementById('ticket-number');
                const trackingLinkEl = document.getElementById('tracking-link');
                
                if (!ticketNumberEl || !trackingLinkEl) {
                    console.error('Eléments de succès introuvables:', 
                        {ticketNumber: !!ticketNumberEl, trackingLink: !!trackingLinkEl});
                    throw new Error('Eléments de succès introuvables');
                }
                
                ticketNumberEl.textContent = data.ticketNumber;
                trackingLinkEl.href = `/tracking/?ticket=${data.ticketNumber}`;
                
                // Afficher le message de succès
                const formEl = document.getElementById('sav-form');
                const successEl = document.getElementById('success-message');
                
                if (!formEl || !successEl) {
                    console.error('Eléments de formulaire ou de succès introuvables:', 
                        {form: !!formEl, success: !!successEl});
                    throw new Error('Eléments de formulaire ou de succès introuvables');
                }
                
                formEl.classList.add('hidden');
                formEl.style.display = 'none';
                
                // Forcer l'affichage du message de succès en supprimant le style inline
                successEl.classList.remove('hidden');
                successEl.style.removeProperty('display'); // Supprimer le style display: none !important
                successEl.style.display = 'block';
                window.scrollTo(0, 0);
                
                // Effacer les données sauvegardées après envoi réussi
                localStorage.removeItem('savFormData');
                
                console.log('Demande SAV envoyée avec succès:', data);
            })
            .catch(error => {
                console.error('Erreur détaillée lors de l\'envoi du formulaire:', error);
                
                // Retirer l'overlay de chargement s'il existe encore
                if (document.body.contains(loadingOverlay)) {
                    document.body.removeChild(loadingOverlay);
                }
                
                // Détails de l'erreur pour le débogage
                console.error('Stack trace:', error.stack);
                console.error('Message:', error.message);
                
                // Afficher un message d'erreur à l'utilisateur
                const errorMessage = document.createElement('div');
                errorMessage.style.position = 'fixed';
                errorMessage.style.top = '20px';
                errorMessage.style.left = '50%';
                errorMessage.style.transform = 'translateX(-50%)';
                errorMessage.style.backgroundColor = '#f44336';
                errorMessage.style.color = 'white';
                errorMessage.style.padding = '15px';
                errorMessage.style.borderRadius = '5px';
                errorMessage.style.zIndex = '1000';
                errorMessage.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
                errorMessage.innerHTML = `Une erreur est survenue lors de l'envoi du formulaire: ${error.message}. Veuillez réessayer ou nous contacter directement.`;
                
                document.body.appendChild(errorMessage);
                
                // Supprimer le message d'erreur après 10 secondes
                setTimeout(() => {
                    if (document.body.contains(errorMessage)) {
                        document.body.removeChild(errorMessage);
                    }
                }, 10000);
            });
        } catch (error) {
            // Gérer les erreurs qui pourraient survenir lors de la préparation des données
            console.error('Erreur détaillée lors de la préparation des données:', error);
            console.error('Stack trace:', error.stack);
            console.error('Message:', error.message);
            
            // Vérifier si l'overlay existe encore avant de le supprimer
            if (document.body.contains(loadingOverlay)) {
                document.body.removeChild(loadingOverlay);
            }
            
            // Inspecter le DOM pour trouver les éléments manquants
            console.log('Vérification des éléments du formulaire:');
            const formElements = [
                'prenom', 'nom', 'email', 'telephone', 'numero_commande', 'date_commande',
                'marque', 'modele', 'annee', 'numero_serie', 'immatriculation', 'date_installation',
                'symptomes', 'apparition_panne', 'codes_defaut', 'quantite_huile', 'reference_huile', 'details_pieces',
                'sav-form', 'success-message', 'ticket-number', 'tracking-link'
            ];
            
            formElements.forEach(id => {
                const element = document.getElementById(id);
                console.log(`Elément ${id}: ${element ? 'trouvé' : 'MANQUANT'}`);
            });
            
            // Vérifier les éléments radio
            ['type_piece', 'installation_pro', 'remplissage_huile', 'pieces_neuves'].forEach(name => {
                const elements = document.querySelectorAll(`input[name="${name}"]`);
                console.log(`Radio ${name}: ${elements.length} éléments trouvés`);
            });
            
            // Vérifier les inputs de fichiers
            const fileInputs = document.querySelectorAll('input[type="file"]');
            console.log(`Inputs de fichiers: ${fileInputs.length} trouvés`);
            fileInputs.forEach((input, i) => {
                console.log(`  Input ${i}: id=${input.id}, name=${input.name}, files=${input.files.length}`);
            });
            
            // Afficher un message d'erreur à l'utilisateur avec des détails
            const errorMessage = document.createElement('div');
            errorMessage.style.position = 'fixed';
            errorMessage.style.top = '20px';
            errorMessage.style.left = '50%';
            errorMessage.style.transform = 'translateX(-50%)';
            errorMessage.style.backgroundColor = '#f44336';
            errorMessage.style.color = 'white';
            errorMessage.style.padding = '15px';
            errorMessage.style.borderRadius = '5px';
            errorMessage.style.zIndex = '1000';
            errorMessage.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
            errorMessage.innerHTML = `Une erreur est survenue lors de la préparation des données: ${error.message}. Veuillez réessayer.`;
            
            document.body.appendChild(errorMessage);
            
            // Supprimer le message d'erreur après 10 secondes
            setTimeout(() => {
                if (document.body.contains(errorMessage)) {
                    document.body.removeChild(errorMessage);
                }
            }, 10000);
        }
    }
    
    // Fonction pour valider les fichiers téléchargés
    function validateFiles() {
        const fileInputs = document.querySelectorAll('input[type="file"]');
        let isValid = true;
        
        fileInputs.forEach(input => {
            for (let i = 0; i < input.files.length; i++) {
                const file = input.files[i];
                
                // Vérifier la taille du fichier (max 5 Mo)
                if (file.size > 5 * 1024 * 1024) {
                    showErrorNotification(`Le fichier "${file.name}" dépasse la taille maximale autorisée (5 Mo).`, 'Fichier trop volumineux');
                    highlightErrorField(input, `Fichier trop volumineux (max 5 Mo)`);
                    isValid = false;
                }
                
                // Vérifier le format du fichier
                const allowedTypes = ['.jpg', '.jpeg', '.png', '.pdf'];
                const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
                
                if (!allowedTypes.includes(fileExtension)) {
                    showErrorNotification(`Le format du fichier "${file.name}" n'est pas autorisé. Formats acceptés : JPG, PNG, PDF.`, 'Format non supporté');
                    highlightErrorField(input, `Format non supporté (JPG, PNG, PDF uniquement)`);
                    isValid = false;
                }
            }
        });
        
        return isValid;
    }
    
    // Fonction pour sauvegarder les données du formulaire
    function saveFormData() {
        const formData = {};
        const inputs = form.querySelectorAll('input:not([type="file"]), select, textarea');
        
        inputs.forEach(input => {
            if (input.type === 'radio' || input.type === 'checkbox') {
                if (input.checked) {
                    formData[input.name] = input.value;
                }
            } else {
                formData[input.name] = input.value;
            }
        });
        
        localStorage.setItem('savFormData', JSON.stringify(formData));
    }
    
    // Fonction pour charger les données sauvegardées
    function loadSavedFormData() {
        const savedData = localStorage.getItem('savFormData');
        if (savedData) {
            const formData = JSON.parse(savedData);
            const formElement = document.getElementById('sav-form');
            
            if (!formElement) return; // S'assurer que le formulaire existe
            
            // Remplir les champs avec les données sauvegardées
            Object.keys(formData).forEach(name => {
                const input = formElement.querySelector(`[name="${name}"]`);
                if (input) {
                    if (input.type === 'radio' || input.type === 'checkbox') {
                        const radioInput = formElement.querySelector(`[name="${name}"][value="${formData[name]}"]`);
                        if (radioInput) {
                            radioInput.checked = true;
                            // Déclencher l'événement change pour activer les champs conditionnels
                            const event = new Event('change');
                            radioInput.dispatchEvent(event);
                        }
                    } else {
                        input.value = formData[name];
                    }
                }
            });
            
            // Nous ne faisons rien d'autre ici - l'affichage de l'étape sera géré par le code principal
            // après que toutes les fonctions soient définies
        }
        return true; // Indiquer que le chargement est terminé
    }
    
    // Fonction debounce pour limiter les appels à saveFormData
    function debounce(func, delay) {
        let timeout;
        return function() {
            const context = this;
            const args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }
    
    // Fonction pour initialiser les tooltips
    function initTooltips() {
        document.querySelectorAll('.tooltip-icon').forEach(icon => {
            // Assurez-vous que l'icône est bien positionnée
            icon.style.position = 'relative';
            
            // Ajoutez des événements tactiles pour les appareils mobiles
            icon.addEventListener('touchstart', function(e) {
                e.preventDefault();
                this.classList.toggle('tooltip-active');
            });
        });
    }
    
    // Fonction pour simuler la progression du téléchargement de fichiers
    function simulateFileUploadProgress(inputId, container) {
        const progressBar = container.querySelector('.upload-progress-bar');
        const progressText = container.querySelector('.upload-progress-text');
        let progress = 0;
        
        const interval = setInterval(() => {
            progress += Math.random() * 10;
            if (progress > 100) progress = 100;
            
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${Math.round(progress)}%`;
            
            if (progress === 100) {
                clearInterval(interval);
                setTimeout(() => {
                    container.style.display = 'none';
                }, 1000);
            }
        }, 200);
    }
    
    // Fonction pour valider un champ individuel
    function validateField(field) {
        // Réinitialiser les styles d'erreur
        field.style.borderColor = '';
        
        // Ajouter un message d'erreur si nécessaire
        let errorMessage = field.nextElementSibling;
        if (errorMessage && errorMessage.classList.contains('error-message')) {
            errorMessage.remove();
        }
        
        let isValid = true;
        
        if (field.type === 'checkbox') {
            if (field.hasAttribute('required') && !field.checked) {
                isValid = false;
                field.nextElementSibling.style.color = 'var(--primary-color)';
            } else {
                field.nextElementSibling.style.color = '';
            }
        } else if (field.type === 'file') {
            if (field.hasAttribute('required') && (!field.files || !field.files.length)) {
                isValid = false;
                field.style.borderColor = 'var(--primary-color)';
            }
        } else {
            // Pour les autres types de champs
            if (field.hasAttribute('required') && !field.value.trim()) {
                isValid = false;
                field.style.borderColor = 'var(--primary-color)';
                
                // Ajouter un message d'erreur
                errorMessage = document.createElement('div');
                errorMessage.className = 'error-message';
                errorMessage.textContent = 'Ce champ est obligatoire';
                errorMessage.style.color = 'var(--primary-color)';
                errorMessage.style.fontSize = '12px';
                errorMessage.style.marginTop = '5px';
                field.parentNode.insertBefore(errorMessage, field.nextSibling);
            }
            
            // Validation spécifique pour les emails
            if (field.type === 'email' && field.value.trim() && !validateEmail(field.value)) {
                isValid = false;
                field.style.borderColor = 'var(--primary-color)';
                
                // Ajouter un message d'erreur
                errorMessage = document.createElement('div');
                errorMessage.className = 'error-message';
                errorMessage.textContent = 'Veuillez entrer une adresse email valide';
                errorMessage.style.color = 'var(--primary-color)';
                errorMessage.style.fontSize = '12px';
                errorMessage.style.marginTop = '5px';
                field.parentNode.insertBefore(errorMessage, field.nextSibling);
            }
            
            // Validation spécifique pour les téléphones
            if (field.type === 'tel' && field.value.trim() && !validatePhone(field.value)) {
                isValid = false;
                field.style.borderColor = 'var(--primary-color)';
                
                // Ajouter un message d'erreur
                errorMessage = document.createElement('div');
                errorMessage.className = 'error-message';
                errorMessage.textContent = 'Veuillez entrer un numéro de téléphone valide';
                errorMessage.style.color = 'var(--primary-color)';
                errorMessage.style.fontSize = '12px';
                errorMessage.style.marginTop = '5px';
                field.parentNode.insertBefore(errorMessage, field.nextSibling);
            }
        }
        
        return isValid;
    }
    
    // Fonction pour valider un groupe de boutons radio
    function validateRadioGroup(name) {
        const radios = document.querySelectorAll(`input[name="${name}"]`);
        const radioGroup = radios[0].closest('.radio-group');
        const label = radioGroup ? radioGroup.previousElementSibling : null;
        
        let isValid = false;
        radios.forEach(radio => {
            if (radio.checked) {
                isValid = true;
            }
        });
        
        if (label) {
            label.style.color = isValid ? '' : 'var(--primary-color)';
        }
        
        return isValid;
    }
    
    // Fonction pour valider un email
    function validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }
    
    // Fonction pour valider un numéro de téléphone
    function validatePhone(phone) {
        // Accepte les formats: +33612345678, 0612345678, 06 12 34 56 78, etc.
        const re = /^(\+33|0)[1-9]([-. ]?[0-9]{2}){4}$/;
        return re.test(phone);
    }
    
    // Initialisation de la validation en temps réel des champs
    initLiveValidation();
    
    // Initialisation du gestionnaire de type de réclamation
    initClaimTypeHandler();
    
    // Fonction pour initialiser le gestionnaire de type de réclamation
    function initClaimTypeHandler() {
        const claimTypeSelect = document.getElementById('claim_type');
        if (claimTypeSelect) {
            claimTypeSelect.addEventListener('change', handleClaimTypeChange);
            // Initialiser l'affichage en fonction de la valeur actuelle
            handleClaimTypeChange.call(claimTypeSelect);
        }
    }
    
    // Fonction pour gérer le changement de type de réclamation
    function handleClaimTypeChange() {
        const selectedValue = this.value;
        const allSections = document.querySelectorAll('.claim-section');
        
        // Masquer toutes les sections
        allSections.forEach(section => {
            section.style.display = 'none';
            
            // Désactiver les champs requis pour éviter les erreurs de validation
            const requiredFields = section.querySelectorAll('[required]');
            requiredFields.forEach(field => {
                field.removeAttribute('required');
                field.dataset.wasRequired = 'true'; // Marquer comme précédemment requis
            });
        });
        
        // Afficher la section correspondante au type sélectionné
        let sectionToShow = null;
        switch (selectedValue) {
            case 'piece_defectueuse':
                sectionToShow = document.getElementById('piece_defectueuse_section');
                break;
            case 'probleme_livraison':
                sectionToShow = document.getElementById('probleme_livraison_section');
                break;
            case 'erreur_reference':
                sectionToShow = document.getElementById('erreur_reference_section');
                break;
            case 'autre':
                sectionToShow = document.getElementById('autre_section');
                break;
        }
        
        if (sectionToShow) {
            sectionToShow.style.display = 'block';
            
            // Réactiver les champs requis dans la section visible
            const fieldsToActivate = sectionToShow.querySelectorAll('[data-was-required="true"]');
            fieldsToActivate.forEach(field => {
                field.setAttribute('required', '');
            });
        }
        
        // Mettre à jour la validation du formulaire
        updateFormValidation();
    }
    
    // Fonction pour mettre à jour la validation du formulaire en fonction du type de réclamation
    function updateFormValidation() {
        const claimType = document.getElementById('claim_type').value;
        
        // Mise à jour des champs requis pour l'étape 3 en fonction du type de réclamation
        const symptomeField = document.getElementById('symptome');
        const apparitionPanneRadios = document.querySelectorAll('input[name="apparition_panne"]');
        
        if (claimType === 'piece_defectueuse') {
            // Pour les pièces défectueuses, les champs de l'étape 3 sont requis
            if (symptomeField) {
                symptomeField.setAttribute('required', '');
                symptomeField.closest('.form-group').style.display = 'block';
            }
            
            // Afficher les radios pour l'apparition de la panne
            if (apparitionPanneRadios.length > 0) {
                const radioGroup = apparitionPanneRadios[0].closest('.radio-group');
                if (radioGroup) {
                    radioGroup.style.display = 'flex';
                    const label = radioGroup.previousElementSibling;
                    if (label) label.style.display = 'block';
                }
            }
        } else {
            // Pour les autres types de réclamations, adapter les champs de l'étape 3
            if (symptomeField) {
                // Changer le libellé et le placeholder en fonction du type de réclamation
                const symptomeLabel = symptomeField.previousElementSibling;
                if (symptomeLabel) {
                    switch (claimType) {
                        case 'probleme_livraison':
                            symptomeField.setAttribute('placeholder', 'Informations complémentaires sur le problème de livraison...');
                            symptomeField.removeAttribute('required');
                            symptomeField.closest('.form-group').style.display = 'none'; // Masquer car déjà dans la section spécifique
                            break;
                        case 'erreur_reference':
                            symptomeField.setAttribute('placeholder', 'Informations complémentaires sur l\'erreur de référence...');
                            symptomeField.removeAttribute('required');
                            symptomeField.closest('.form-group').style.display = 'none'; // Masquer car déjà dans la section spécifique
                            break;
                        case 'autre':
                            symptomeField.setAttribute('placeholder', 'Informations complémentaires sur votre demande...');
                            symptomeField.removeAttribute('required');
                            symptomeField.closest('.form-group').style.display = 'none'; // Masquer car déjà dans la section spécifique
                            break;
                    }
                }
            }
            
            // Masquer les radios pour l'apparition de la panne si ce n'est pas une pièce défectueuse
            if (apparitionPanneRadios.length > 0) {
                const radioGroup = apparitionPanneRadios[0].closest('.radio-group');
                if (radioGroup) {
                    radioGroup.style.display = 'none';
                    const label = radioGroup.previousElementSibling;
                    if (label) label.style.display = 'none';
                }
            }
        }
    }
    
    // Fonction pour collecter les données spécifiques au type de réclamation
    function collectClaimTypeData() {
        const claimType = document.getElementById('claim_type').value;
        let specificData = {};
        
        switch (claimType) {
            case 'piece_defectueuse':
                specificData = {
                    typePiece: document.getElementById('type_piece')?.value || '',
                    symptome: document.getElementById('symptome')?.value || ''
                };
                break;
            case 'probleme_livraison':
                specificData = {
                    deliveryDate: document.getElementById('delivery_date')?.value || '',
                    deliveryProblemType: document.getElementById('delivery_problem_type')?.value || '',
                    deliveryProblemDescription: document.getElementById('delivery_problem_description')?.value || ''
                };
                break;
            case 'erreur_reference':
                specificData = {
                    receivedReference: document.getElementById('received_reference')?.value || '',
                    expectedReference: document.getElementById('expected_reference')?.value || '',
                    compatibilityIssue: document.getElementById('compatibility_issue')?.value || '',
                    referenceErrorDescription: document.getElementById('reference_error_description')?.value || ''
                };
                break;
            case 'autre':
                specificData = {
                    otherProblemType: document.getElementById('other_problem_type')?.value || '',
                    otherProblemDescription: document.getElementById('other_problem_description')?.value || ''
                };
                break;
        }
        
        return {
            claimType,
            specificData
        };
    }
    
    // Fonction pour initialiser la validation en temps réel
    function initLiveValidation() {
        // Sélectionner tous les champs de texte, email, téléphone, etc.
        const fields = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"], select, textarea');
        
        fields.forEach(field => {
            // Ajouter un écouteur d'événement pour la validation lors de la perte de focus
            field.addEventListener('blur', function() {
                validateFieldWithAnimation(this);
            });
            
            // Validation en temps réel pour certains champs (email, téléphone)
            if (field.type === 'email' || field.type === 'tel') {
                field.addEventListener('input', debounceValidation(function() {
                    validateFieldWithAnimation(field);
                }, 500));
            }
        });
    }
    
    // Fonction pour valider un champ avec animation
    function validateFieldWithAnimation(field) {
        // Supprimer la classe de validation précédente
        field.classList.remove('field-valid');
        
        // Vérifier si le champ est valide selon son type
        let isValid = false;
        
        if (field.value.trim() === '') {
            // Champ vide, pas d'animation
            return;
        }
        
        switch(field.type) {
            case 'email':
                isValid = validateEmail(field.value);
                break;
            case 'tel':
                isValid = validatePhone(field.value);
                break;
            case 'text':
                // Pour les champs texte, valider selon l'ID ou le nom
                if (field.id === 'nom' || field.id === 'prenom') {
                    isValid = field.value.trim().length >= 2;
                } else if (field.id === 'commande') {
                    isValid = /^[A-Za-z0-9-]{5,}$/.test(field.value.trim());
                } else {
                    isValid = field.value.trim().length >= 1;
                }
                break;
            default:
                // Pour les autres types, considérer comme valide si non vide
                isValid = field.value.trim().length > 0;
        }
        
        // Appliquer l'animation si valide
        if (isValid) {
            field.classList.add('field-valid');
        }
    }
    
    // Fonction debounce pour limiter les validations pendant la saisie
    function debounceValidation(func, wait) {
        let timeout;
        return function() {
            const context = this;
            const args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    }
});
