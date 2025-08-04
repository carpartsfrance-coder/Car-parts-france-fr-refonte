# Système de Gestion SAV Car Parts France

Ce projet comprend un formulaire de Service Après-Vente multi-étapes et un système complet de gestion des tickets SAV pour le site web Car Parts France. Le système permet aux clients de déclarer un problème après l'achat d'une pièce automobile, de suivre l'évolution de leur demande, et à l'équipe SAV de gérer efficacement les tickets via une interface d'administration.

## Fonctionnalités

### Formulaire SAV
- Formulaire multi-étapes avec progression visuelle
- Logique conditionnelle selon le type de pièce sélectionnée
- Validation des champs obligatoires et des formats (VIN, immatriculation)
- Upload de fichiers avec vérification de format et taille
- Récapitulatif dynamique avant soumission
- Design responsive conforme à la charte graphique Car Parts France
- Infobulles détaillées pour guider l'utilisateur

### Système de Tickets
- Génération automatique de numéros de ticket uniques
- Page de suivi pour les clients
- Interface d'administration sécurisée
- Gestion des statuts et historique des tickets
- Upload et stockage de documents
- Notifications par email
- Filtrage et recherche de tickets

## Structure du projet

### Frontend
- `index.html` : Structure HTML du formulaire SAV
- `styles.css` : Styles CSS pour l'apparence du formulaire
- `script.js` : Logique JavaScript pour la navigation et validation
- `tracking/` : Page de suivi des tickets pour les clients
- `admin/` : Interface d'administration pour l'équipe SAV

### Backend
- `server/` : Serveur Node.js avec Express
- `server/models/` : Modèles Mongoose pour MongoDB
- `server/middleware/` : Middlewares (authentification, etc.)
- `uploads/` : Stockage des fichiers uploadés

## Installation et Configuration

### Prérequis
- Node.js (v14 ou supérieur)
- MongoDB (v4.4 ou supérieur)
- npm ou yarn

### Étapes d'installation

1. Clonez le dépôt ou téléchargez les fichiers dans un répertoire de votre serveur

2. Installez les dépendances :
```bash
npm install
```

3. Configurez les variables d'environnement :
   - Copiez le fichier `.env.example` en `.env`
   - Modifiez les valeurs selon votre environnement :
     ```
     # Configuration MongoDB
     MONGO_URI=mongodb://localhost:27017/carparts-sav
     
     # Configuration serveur
     PORT=3000
     
     # JWT Secret pour l'authentification
     JWT_SECRET=votre_secret_jwt_tres_securise
     
     # Configuration des uploads
     UPLOAD_DIR=uploads/
     MAX_FILE_SIZE=5242880 # 5MB
     ```
   
   > **Note**: Si le fichier `.env` n'existe pas ou si `JWT_SECRET` n'est pas défini, le script de démarrage en générera un automatiquement lors du premier lancement.

4. Créez le dossier pour les uploads :
```bash
mkdir uploads
chmod 755 uploads
```

5. Démarrez le serveur avec l'initialisation de l'administrateur :
```bash
npm start
```

Le script de démarrage vérifiera si un compte administrateur existe et vous guidera pour en créer un si nécessaire. Vous pouvez définir un nom d'utilisateur, mot de passe et adresse email personnalisés lors de cette étape.

Vous disposez également des commandes suivantes :

```bash
npm run dev        # Démarrer le serveur en mode développement avec nodemon
npm run server     # Démarrer le serveur directement sans vérification d'admin
npm run create-admin  # Créer un compte administrateur uniquement
```

### Déploiement en production

Pour un déploiement en production, nous recommandons :

1. Utiliser un gestionnaire de processus comme PM2 :
```bash
npm install -g pm2
pm2 start server/server.js --name "carparts-sav"
```

2. Configurer un serveur web (Nginx, Apache) comme proxy inverse :

Exemple de configuration Nginx :
```nginx
server {
    listen 80;
    server_name sav.carpartsfrance.fr;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

3. Sécuriser la connexion avec un certificat SSL (Let's Encrypt)

4. Configurer MongoDB pour la production (authentification, réplication, etc.)

## Utilisation

### Interface client

1. **Formulaire SAV** : Accessible à la racine du site (`/`)
   - Les clients remplissent le formulaire multi-étapes
   - Après soumission, ils reçoivent un numéro de ticket

2. **Page de suivi** : Accessible via `/tracking/`
   - Les clients peuvent entrer leur numéro de ticket
   - Ils peuvent consulter l'état actuel et l'historique de leur demande

### Interface d'administration

Accessible via `/admin/` après authentification.

#### Système d'authentification

Le système utilise une authentification basée sur JWT (JSON Web Tokens) avec deux niveaux de rôles :

1. **Administrateur** (`admin`) :
   - Accès complet à toutes les fonctionnalités
   - Gestion des tickets SAV
   - Gestion des utilisateurs (création, modification, suppression)
   - Réinitialisation des mots de passe

2. **Agent SAV** (`agent_sav`) :
   - Accès limité aux fonctionnalités de gestion des tickets
   - Pas d'accès à la gestion des utilisateurs

Pour accéder à l'interface d'administration, vous devez vous connecter à `/admin/login.html` avec vos identifiants.

#### Interface principale

1. **Tableau de bord** :
   - Vue d'ensemble des tickets (nouveaux, en cours, résolus, urgents)
   - Filtres par statut, type de pièce, date
   - Recherche par numéro de ticket, nom de client, etc.

2. **Détails du ticket** :
   - Informations complètes sur la demande
   - Documents joints téléchargeables
   - Historique des statuts

3. **Gestion des statuts** :
   - Mise à jour du statut avec commentaires
   - Demande d'informations complémentaires
   - Notification au client par email

4. **Notes internes** :
   - Ajout de notes visibles uniquement par l'équipe

## Personnalisation

### Modifier les couleurs

Vous pouvez ajuster les couleurs dans le fichier `styles.css` en modifiant les variables CSS au début du fichier :

```css
:root {
    --primary-color: #E60000;
    --primary-hover: #C00000;
    --success-color: #0C6B48;
    /* etc. */
}
```

### Modifier les destinataires des emails

Dans le fichier `process.php`, modifiez la variable `$recipient_email` :

```php
$recipient_email = "votre-email@carpartsfrance.fr";
```

## Sécurité et bonnes pratiques

- Le formulaire inclut une validation côté client, mais assurez-vous de maintenir la validation côté serveur dans `process.php`
- Pour un environnement de production, utilisez une bibliothèque comme PHPMailer pour gérer les emails avec pièces jointes
- Envisagez d'ajouter un captcha pour éviter les soumissions automatisées
- Limitez la taille des fichiers uploadés dans la configuration de votre serveur

## Support

Pour toute question ou assistance concernant ce formulaire, contactez votre développeur web.
