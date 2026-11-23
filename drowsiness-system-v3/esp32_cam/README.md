# 📷 Guide ESP32-CAM - Driver Safety Monitor

Ce dossier contient le code Arduino optimisé pour l'**ESP32-CAM (AI-Thinker)** connecté au système de surveillance.

---

## ⚡ Caractéristiques configurées

0. **Vidéo dès l'allumage** : dès que l'ESP32-CAM est branchée et connectée au Wi-Fi, le flux est disponible sur `http://<IP>:81/stream` (reconnexion Wi-Fi automatique).
1. **Taille Moyenne Optimale** : Résolution VGA (640x480) ou SVGA (800x600) — fluide, sans lag Wi-Fi et parfaitement proportionnée.
2. **Excellente Qualité** : Compression JPEG fine (`quality = 10`), contraste et luminosité ajustés pour bien détecter l'ouverture/fermeture des yeux.
3. **Torche LED Flash Automatique** : La LED flash sur la broche **GPIO 4** s'allume automatiquement dès l'allumage pour éclairer le visage du conducteur.
4. **Contrôle à distance** : Allumage/extinction de la torche depuis le site web via l'API, et réglages `/control?var=framesize|quality|brightness|contrast&val=...` (maintenant vraiment pris en compte). Etat de la caméra : `http://<IP>/status`.

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

---

## 🤖 Téléverser avec Antigravity (ou VS Code)

Antigravity ne contient pas d'outil ESP32 en natif, mais il a un **terminal** : l'agent (ou vous) peut compiler et téléverser avec `arduino-cli`, tant que l'ESP32-CAM est branchée en USB sur le PC (via le module ESP32-CAM-MB ou un adaptateur FTDI).

1. Une seule fois : installez l'outil → `winget install ArduinoSA.CLI` (puis rouvrez le terminal).
2. Mettez votre Wi-Fi dans `esp32_cam_driver_safety/esp32_cam_driver_safety.ino`.
3. Dans le terminal d'Antigravity :
   ```powershell
   cd esp32_cam
   .\upload_esp32.ps1            # compile + affiche les ports (ex: COM5)
   .\upload_esp32.ps1 -Port COM5 # compile + téléverse
   ```
4. Avec un adaptateur FTDI : `GPIO 0` → `GND` + RST avant le téléversement, puis retirez le fil et RST après. (Avec le module ESP32-CAM-MB, c'est automatique.)
5. Lisez l'IP : `arduino-cli monitor -p COM5 -c baudrate=115200`.

Vous pouvez aussi demander à l'agent Antigravity : *« lance esp32_cam/upload_esp32.ps1 sur le port COM5 »*.
