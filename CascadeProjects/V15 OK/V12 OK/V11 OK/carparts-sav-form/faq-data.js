// Données FAQ pour le formulaire SAV
const faqData = {
    // Questions communes à toutes les étapes
    "global": [
        {
            "question": "❓Qui peut faire une demande SAV ?",
            "answer": "Toute personne ayant passé commande sur notre site, par mail ou par téléphone peut faire une demande SAV."
        },
        {
            "question": "❓Dois-je créer un compte pour faire ma demande ?",
            "answer": "Non, aucune création de compte n'est nécessaire. Le formulaire est accessible à tous les clients."
        },
        {
            "question": "❓Quels documents dois-je fournir ?",
            "answer": "Cela dépend du type de pièce, mais dans tous les cas :<br>* Photos de la pièce (si utile)<br>* Facture de montage si réalisé par un professionnel<br>* Factures d'autres pièces remplacées pendant le montage si c'est le cas"
        },
        {
            "question": "❓Que se passe-t-il après avoir envoyé ma demande ?",
            "answer": "* Vous recevez un e-mail de confirmation avec un numéro de ticket<br>* Notre équipe SAV analyse votre demande sous 48 à 72h ouvrées<br>* Nous vous contactons par e-mail ou téléphone en cas de besoin"
        },
        {
            "question": "❓Dans quels cas le SAV peut-il être refusé ?",
            "answer": "Le SAV peut être refusé si :<br>* La pièce n'a pas été montée correctement<br>* Aucun diagnostic ou justification n'est fourni<br>* La panne est causée par un autre élément du véhicule<br>* Les conditions d'utilisation n'ont pas été respectées"
        },
        {
            "question": "❓Dois-je renvoyer la pièce immédiatement ?",
            "answer": "Non. N'envoyez jamais une pièce sans notre accord. Nous vous informerons si un retour est nécessaire et vous fournirons l'étiquette de retour si besoin."
        },
        {
            "question": "❓La pièce a été reçue cassée ou abîmée, que faire ?",
            "answer": "Signalez-le via le formulaire et joignez des photos du colis, de l'étiquette transporteur et de la pièce abîmée. Le SAV prendra en charge les démarches rapidement."
        },
        {
            "question": "❓Quels sont les délais de traitement ?",
            "answer": "En général, vous recevez une réponse sous 48 à 72h ouvrées. Les résolutions peuvent prendre entre 2 et 7 jours selon le type de problème."
        }
    ],
    
    // Étape 1: Identification (utilise les questions globales)
    "1": [],
    
    // Étape 2: Type de pièce (utilise les questions globales)
    "2": [],
    
    // Étape 3: Description (utilise les questions globales)
    "3": [],
    
    // Étape 4: Documents (utilise les questions globales)
    "4": [],
    
    // Étape 5: Confirmation (utilise les questions globales)
    "5": []
};
