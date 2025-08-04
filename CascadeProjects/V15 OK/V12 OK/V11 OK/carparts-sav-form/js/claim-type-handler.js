/**
 * Gestionnaire des types de réclamations
 * Ce fichier contient les fonctions pour gérer les différents types de réclamations
 * dans le formulaire SAV Car Parts France
 */

// Fonction pour afficher la section correspondant au type de réclamation sélectionné
function handleClaimTypeChange(claimType) {
    // Masquer toutes les sections de réclamation
    const claimSections = document.querySelectorAll('.claim-section');
    claimSections.forEach(section => {
        section.style.display = 'none';
    });
    
    // Afficher la section correspondant au type sélectionné
    if (claimType) {
        const selectedSection = document.getElementById(`${claimType}_section`);
        if (selectedSection) {
            selectedSection.style.display = 'block';
        }
    }
    
    // Mettre à jour les champs requis en fonction du type de réclamation
    updateRequiredFields(claimType);
}

// Fonction pour mettre à jour les champs requis en fonction du type de réclamation
function updateRequiredFields(claimType) {
    // Réinitialiser tous les champs requis
    resetRequiredFields();
    
    // Définir les champs requis en fonction du type de réclamation
    switch(claimType) {
        case 'piece_defectueuse':
            // Champs requis pour les pièces défectueuses
            document.getElementById('type_piece').setAttribute('required', '');
            document.getElementById('symptom').setAttribute('required', '');
            break;
            
        case 'probleme_livraison':
            // Champs requis pour les problèmes de livraison
            document.getElementById('delivery_issue_type').setAttribute('required', '');
            document.getElementById('delivery_issue_description').setAttribute('required', '');
            break;
            
        case 'erreur_reference':
            // Champs requis pour les erreurs de référence
            document.getElementById('received_part_reference').setAttribute('required', '');
            document.getElementById('expected_part_reference').setAttribute('required', '');
            document.getElementById('reference_issue_description').setAttribute('required', '');
            break;
            
        case 'autre':
            // Champs requis pour les autres problèmes
            document.getElementById('autre_issue_description').setAttribute('required', '');
            break;
    }
}

// Fonction pour réinitialiser tous les champs requis spécifiques aux types de réclamation
function resetRequiredFields() {
    // Pièces défectueuses
    const pieceFields = ['type_piece', 'symptom'];
    pieceFields.forEach(field => {
        const element = document.getElementById(field);
        if (element) element.removeAttribute('required');
    });
    
    // Problèmes de livraison
    const deliveryFields = ['delivery_issue_type', 'delivery_issue_description'];
    deliveryFields.forEach(field => {
        const element = document.getElementById(field);
        if (element) element.removeAttribute('required');
    });
    
    // Erreurs de référence
    const referenceFields = ['received_part_reference', 'expected_part_reference', 'reference_issue_description'];
    referenceFields.forEach(field => {
        const element = document.getElementById(field);
        if (element) element.removeAttribute('required');
    });
    
    // Autres problèmes
    const autreFields = ['autre_issue_description'];
    autreFields.forEach(field => {
        const element = document.getElementById(field);
        if (element) element.removeAttribute('required');
    });
}

// Fonction pour collecter les données spécifiques au type de réclamation
function collectClaimTypeData(claimType) {
    const data = {};
    
    switch(claimType) {
        case 'piece_defectueuse':
            data.partInfo = {
                partType: document.getElementById('type_piece').value,
                symptom: document.getElementById('symptom').value,
                failureTime: document.getElementById('failure_time').value,
                errorCodes: document.getElementById('error_codes').value,
                professionalInstallation: document.getElementById('pro_oui').checked,
                oilFilled: document.getElementById('huile_oui').checked,
                oilQuantity: document.getElementById('quantite_huile').value,
                oilReference: document.getElementById('reference_huile').value,
                newParts: document.getElementById('pieces_oui').checked,
                newPartsDetails: document.getElementById('pieces_details').value
            };
            break;
            
        case 'probleme_livraison':
            data.deliveryInfo = {
                trackingNumber: document.getElementById('tracking_number').value,
                deliveryDate: document.getElementById('delivery_date').value,
                carrier: document.getElementById('carrier').value,
                issueType: document.getElementById('delivery_issue_type').value,
                issueDescription: document.getElementById('delivery_issue_description').value
            };
            break;
            
        case 'erreur_reference':
            data.referenceErrorInfo = {
                receivedPartReference: document.getElementById('received_part_reference').value,
                expectedPartReference: document.getElementById('expected_part_reference').value,
                compatibilityIssue: document.getElementById('compatibility_issue').checked,
                issueDescription: document.getElementById('reference_issue_description').value
            };
            break;
            
        case 'autre':
            data.otherIssueDescription = document.getElementById('autre_issue_description').value;
            break;
    }
    
    return data;
}
