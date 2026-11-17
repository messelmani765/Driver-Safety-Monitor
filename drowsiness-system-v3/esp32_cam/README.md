# 📷 Guide ESP32-CAM - Driver Safety Monitor

Ce dossier contient le code Arduino optimisé pour l'**ESP32-CAM (AI-Thinker)** connecté au système de surveillance.

---

## ⚡ Caractéristiques configurées

1. **Taille Moyenne Optimale** : Résolution VGA (640x480) ou SVGA (800x600) — fluide, sans lag Wi-Fi et parfaitement proportionnée.
2. **Excellente Qualité** : Compression JPEG fine (`quality = 10`), contraste et luminosité ajustés pour bien détecter l'ouverture/fermeture des yeux.
3. **Torche LED Flash Automatique** : La LED flash sur la broche **GPIO 4** s'allume automatiquement dès l'allumage pour éclairer le visage du conducteur.
4. **Contrôle à distance** : Allumage/extinction de la torche depuis le site web via l'API.

---

## 🚀 Comment téléverser le code (Arduino IDE)

1. Ouvrez l'Arduino IDE.
2. Allez dans **Fichier > Ouvrir** et sélectionnez `esp32_cam_driver_safety.ino`.
3. Modifiez vos identifiants Wi-Fi au début du fichier :
   ```cpp
   const char* ssid = "VOTRE_NOM_WIFI";
   const char* password = "VOTRE_MOT_DE_PASSE";
   ```
4. Dans **Outils > Type de carte**, choisissez **AI Thinker ESP32-CAM**.
5. Connectez l'ESP32-CAM via un adaptateur FTDI / USB-TTL :
   - Reliez `GPIO 0` à `GND` pour passer en mode programmation (flashing).
   - Appuyez sur le bouton **RST** de l'ESP32-CAM.
   - Cliquez sur **Téléverser**.
6. Une fois le téléversement terminé :
   - Débranchez `GPIO 0` de `GND`.
   - Appuyez sur **RST**.
7. Ouvrez le Moniteur Série à **115200 bauds** pour lire l'adresse IP affichée (ex: `192.168.1.50`).

---

## 📱 Utilisation avec le système

1. Dans le site web (sur PC ou téléphone) dans l'onglet **Caméra ESP32-CAM**, entrez simplement l'adresse IP de votre ESP32-CAM.
2. Ou lancez le détecteur Python directement :
   ```powershell
   python detector_eyes.py --esp32 192.168.1.50 --show
   ```
