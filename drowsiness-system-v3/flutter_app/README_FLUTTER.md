# App mobile Flutter — Driver Safety Monitor

## Installer sur le téléphone (1 commande)
Téléphone branché en USB (débogage USB activé), puis dans PowerShell:

    cd <dossier du projet>\flutter_app
    powershell -ExecutionPolicy Bypass -File .\install_app.ps1

Le script: copie `lib/`, `assets/`, `pubspec.yaml` dans `C:\dev\drowsiness_app`, ajoute les
permissions Android (INTERNET, VIBRATE, WAKE_LOCK + http autorisé), fait `flutter pub get`
et `flutter run`. Autre téléphone: `-Device <id>` (voir `flutter devices`).

## Utiliser
1. Dans l'app: écris l'IP du PC + `:8000` (ex: `192.168.0.110:8000`), ton **identifiant** (ex: `client1`), ton **mot de passe** (ex: `client123`) puis clique sur **Se connecter à mon compte**.
   (`ipconfig` sur le PC pour trouver l'adresse IPv4; le téléphone et le PC doivent être sur le même réseau Wi-Fi).
2. Onglets disponibles pour le conducteur :
   - **Trajet** : carte en direct de ta voiture, vitesse, état des yeux et bouton *Tester l'alerte*.
   - **Alarmes** : historique de tes alertes avec statut synchronisé (*Annulé par moi*, *Police appelée*, *Police a répondu*, *Clôturé*).
   - **Détections** : photos prises par la webcam lors des fermetures d'yeux.
   - **Profil** : tes informations (CIN, téléphone, véhicule, contact d'urgence) et bouton déconnexion.
3. Réglages (roue dentée en haut à droite) : **monte le VOLUME ALARME** du téléphone, puis teste le bip ou la sirène.
4. Trajet → **Tester l'alerte** : écran rouge d'urgence + sirène + vibration + compte à rebours 10 s :
   - « Je suis réveillé » annule l'alerte (statut : *Annulé par moi*).
   - Sans réponse après 10 s : bascule en appel de police SIMULÉ (numéro fictif, voix) et alerte la salle de contrôle Police.

## Xiaomi (MIUI/HyperOS)
- Paramètres → Applications → drowsiness_app → Économie de batterie: **Aucune restriction**; Démarrage automatique: ON.
- Garde l'écran allumé pendant le test (l'app le fait aussi quand la sirène sonne).
- Options développeur → "Install via USB": ON, et le toggle de drowsiness_app en OFF si l'installation est bloquée.

## Pourquoi il n'y avait pas de son avant
L'ancienne version jouait `AssetSource('assets/beep.wav')`. Avec audioplayers le bon chemin est
`AssetSource('beep.wav')` (le dossier `assets/` est déjà ajouté). C'est corrigé dans `alarm_service.dart`.
