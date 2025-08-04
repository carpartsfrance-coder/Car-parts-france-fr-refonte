<?php
// Configuration
$recipient_email = "sav@carpartsfrance.fr";
$site_name = "Car Parts France";
$site_url = "https://carpartsfrance.fr";

// Fonction pour nettoyer les entrées
function clean_input($data) {
    $data = trim($data);
    $data = stripslashes($data);
    $data = htmlspecialchars($data);
    return $data;
}

// Vérifier si le formulaire a été soumis
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Générer un numéro de ticket unique
    $ticket_number = 'SAV-' . date('Y') . '-' . mt_rand(10000, 99999);
    
    // Récupérer et nettoyer les données du formulaire
    $nom = clean_input($_POST['nom']);
    $prenom = clean_input($_POST['prenom']);
    $email = clean_input($_POST['email']);
    $telephone = clean_input($_POST['telephone']);
    $commande = clean_input($_POST['commande']);
    $vin = clean_input($_POST['vin']);
    $date_montage = isset($_POST['date_montage']) ? clean_input($_POST['date_montage']) : 'Non spécifié';
    
    $type_piece = clean_input($_POST['type_piece']);
    $symptome = clean_input($_POST['symptome']);
    $panne_apparition = clean_input($_POST['panne_apparition']);
    $panne_autre_details = isset($_POST['panne_autre_details']) ? clean_input($_POST['panne_autre_details']) : '';
    $codes_defaut = clean_input($_POST['codes_defaut']);
    $montage_pro = clean_input($_POST['montage_pro']);
    $mise_huile = clean_input($_POST['mise_huile']);
    
    $quantite_huile = isset($_POST['quantite_huile']) ? clean_input($_POST['quantite_huile']) : '';
    $reference_huile = isset($_POST['reference_huile']) ? clean_input($_POST['reference_huile']) : '';
    $pieces_neuves = clean_input($_POST['pieces_neuves']);
    $pieces_details = isset($_POST['pieces_details']) ? clean_input($_POST['pieces_details']) : '';
    
    // Préparer le contenu de l'email
    $subject = "Nouvelle demande SAV #$ticket_number";
    
    // Corps de l'email pour l'équipe SAV
    $message_sav = "
    <html>
    <head>
        <title>Nouvelle demande SAV #$ticket_number</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 800px; margin: 0 auto; }
            h2 { color: #E60000; }
            .section { margin-bottom: 20px; padding: 15px; background-color: #f9f9f9; border-radius: 5px; }
            .label { font-weight: bold; }
            table { width: 100%; border-collapse: collapse; }
            table, th, td { border: 1px solid #ddd; }
            th, td { padding: 10px; text-align: left; }
            th { background-color: #f2f2f2; }
        </style>
    </head>
    <body>
        <div class='container'>
            <h1>Nouvelle demande SAV #$ticket_number</h1>
            
            <div class='section'>
                <h2>Informations client</h2>
                <table>
                    <tr>
                        <th>Nom</th>
                        <td>$nom $prenom</td>
                    </tr>
                    <tr>
                        <th>Email</th>
                        <td>$email</td>
                    </tr>
                    <tr>
                        <th>Téléphone</th>
                        <td>$telephone</td>
                    </tr>
                    <tr>
                        <th>N° de commande</th>
                        <td>$commande</td>
                    </tr>
                    <tr>
                        <th>VIN / Immatriculation</th>
                        <td>$vin</td>
                    </tr>
                    <tr>
                        <th>Date de montage</th>
                        <td>$date_montage</td>
                    </tr>
                </table>
            </div>
            
            <div class='section'>
                <h2>Informations sur la pièce</h2>
                <table>
                    <tr>
                        <th>Type de pièce</th>
                        <td>$type_piece</td>
                    </tr>
                    <tr>
                        <th>Symptôme</th>
                        <td>$symptome</td>
                    </tr>
                    <tr>
                        <th>Apparition de la panne</th>
                        <td>" . ($panne_apparition == 'autre' ? $panne_autre_details : $panne_apparition) . "</td>
                    </tr>
                    <tr>
                        <th>Codes défaut OBD</th>
                        <td>$codes_defaut</td>
                    </tr>
                    <tr>
                        <th>Montage professionnel</th>
                        <td>$montage_pro</td>
                    </tr>
                    <tr>
                        <th>Mise en huile effectuée</th>
                        <td>$mise_huile</td>
                    </tr>";
    
    if ($mise_huile == 'oui') {
        $message_sav .= "
                    <tr>
                        <th>Quantité d'huile</th>
                        <td>$quantite_huile litres</td>
                    </tr>
                    <tr>
                        <th>Référence d'huile</th>
                        <td>$reference_huile</td>
                    </tr>";
    }
    
    $message_sav .= "
                    <tr>
                        <th>Pièces neuves remplacées</th>
                        <td>$pieces_neuves</td>
                    </tr>";
    
    if ($pieces_neuves == 'oui') {
        $message_sav .= "
                    <tr>
                        <th>Détails des pièces</th>
                        <td>$pieces_details</td>
                    </tr>";
    }
    
    $message_sav .= "
                </table>
            </div>
            
            <div class='section'>
                <h2>Fichiers joints</h2>
                <p>Veuillez consulter les pièces jointes à cet email.</p>
            </div>
        </div>
    </body>
    </html>
    ";
    
    // Corps de l'email pour le client
    $message_client = "
    <html>
    <head>
        <title>Confirmation de votre demande SAV #$ticket_number</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; }
            h2 { color: #E60000; }
            .section { margin-bottom: 20px; }
            .footer { margin-top: 30px; font-size: 12px; color: #777; }
        </style>
    </head>
    <body>
        <div class='container'>
            <h1>Confirmation de votre demande SAV</h1>
            
            <div class='section'>
                <p>Bonjour $prenom $nom,</p>
                <p>Nous avons bien reçu votre demande SAV concernant votre commande <strong>$commande</strong>.</p>
                <p>Votre demande a été enregistrée sous le numéro de ticket : <strong>#$ticket_number</strong>.</p>
                <p>Notre équipe technique va analyser votre dossier et vous recontactera dans les meilleurs délais.</p>
            </div>
            
            <div class='section'>
                <h2>Récapitulatif de votre demande</h2>
                <p><strong>Type de pièce :</strong> $type_piece</p>
                <p><strong>Symptôme signalé :</strong> $symptome</p>
                <p><strong>Véhicule concerné :</strong> $vin</p>
            </div>
            
            <div class='section'>
                <p>Si vous avez des informations complémentaires à nous communiquer, vous pouvez répondre directement à cet email.</p>
            </div>
            
            <div class='footer'>
                <p>Cordialement,<br>
                L'équipe SAV $site_name<br>
                <a href='$site_url'>$site_url</a></p>
            </div>
        </div>
    </body>
    </html>
    ";
    
    // Configuration des en-têtes pour l'email
    $headers = "MIME-Version: 1.0" . "\r\n";
    $headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
    $headers .= "From: $site_name <noreply@carpartsfrance.fr>" . "\r\n";
    
    // Traitement des fichiers joints
    $attachments = [];
    $upload_dir = "uploads/";
    
    // Créer le répertoire d'upload s'il n'existe pas
    if (!file_exists($upload_dir)) {
        mkdir($upload_dir, 0755, true);
    }
    
    // Fonction pour gérer les uploads de fichiers
    function handle_file_upload($file_input, $upload_dir) {
        $uploaded_files = [];
        
        if(isset($_FILES[$file_input]) && $_FILES[$file_input]['error'][0] != UPLOAD_ERR_NO_FILE) {
            $file_count = count($_FILES[$file_input]['name']);
            
            for($i = 0; $i < $file_count; $i++) {
                // Vérifier s'il y a une erreur
                if($_FILES[$file_input]['error'][$i] == UPLOAD_ERR_OK) {
                    $tmp_name = $_FILES[$file_input]['tmp_name'][$i];
                    $name = basename($_FILES[$file_input]['name'][$i]);
                    $size = $_FILES[$file_input]['size'][$i];
                    $type = $_FILES[$file_input]['type'][$i];
                    
                    // Vérifier la taille (max 5 Mo)
                    if($size > 5 * 1024 * 1024) {
                        continue; // Ignorer les fichiers trop volumineux
                    }
                    
                    // Vérifier le type de fichier
                    $allowed_types = ['image/jpeg', 'image/png', 'application/pdf'];
                    if(!in_array($type, $allowed_types)) {
                        continue; // Ignorer les types non autorisés
                    }
                    
                    // Générer un nom de fichier unique
                    $new_name = uniqid() . '_' . $name;
                    $upload_path = $upload_dir . $new_name;
                    
                    // Déplacer le fichier
                    if(move_uploaded_file($tmp_name, $upload_path)) {
                        $uploaded_files[] = $upload_path;
                    }
                }
            }
        }
        
        return $uploaded_files;
    }
    
    // Traiter tous les champs de fichiers possibles
    $file_fields = [
        'justificatif_pro_file',
        'factures_pieces',
        'lecture_obd',
        'photo_piece',
        'media_boite_transfert',
        'photos_moteur',
        'factures_entretien',
        'media_transmission',
        'factures_transmission',
        'documents_autres'
    ];
    
    foreach($file_fields as $field) {
        $uploaded = handle_file_upload($field, $upload_dir);
        $attachments = array_merge($attachments, $uploaded);
    }
    
    // Dans un environnement de production, vous utiliseriez une bibliothèque comme PHPMailer
    // pour gérer correctement les pièces jointes. Voici un exemple simplifié :
    
    // En environnement local, simuler l'envoi d'emails
    // Enregistrer les données dans un fichier pour vérification
    $log_file = __DIR__ . '/uploads/sav_requests.log';
    $log_data = "[" . date('Y-m-d H:i:s') . "] Nouvelle demande SAV #$ticket_number - $nom $prenom ($email)\n";
    file_put_contents($log_file, $log_data, FILE_APPEND);
    
    // Enregistrer les fichiers téléchargés dans le dossier uploads
    $upload_success = true;
    
    // Réponse JSON
    header('Content-Type: application/json');
    
    // En local, on considère que tout s'est bien passé
    echo json_encode([
        'success' => true,
        'ticket' => $ticket_number,
        'message' => 'Votre demande a été traitée avec succès.'
    ]);
    
    exit;
}

// Si la méthode n'est pas POST, rediriger vers la page du formulaire
header("Location: index.html");
exit;
?>
