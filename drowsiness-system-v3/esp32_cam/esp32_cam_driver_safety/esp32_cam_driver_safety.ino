/*
 ==============================================================================
  DRIVER SAFETY MONITOR - ESP32-CAM FIRMWARE (version finale)
  Modèle : ESP32-CAM (AI-Thinker), avec ou sans module ESP32-CAM-MB

  Ce que fait ce code, tout seul, dès que la carte est alimentée :
  - Se connecte au Wi-Fi configuré ci-dessous (reconnexion automatique)
  - Prend toujours la MÊME adresse IP (IP fixe, voir FIXED_LAST_OCTET)
  - Torche LED (GPIO 4) allumée automatiquement, force réglable
  - Vidéo de taille moyenne (VGA 640x480), qualité JPEG élevée
  - Image remise dans le bon sens (FLIP_VERTICAL / FLIP_MIRROR)

  Adresses (remplacez IP par l'IP affichée au démarrage) :
  - Vidéo     : http://IP:81/stream
  - Photo     : http://IP/cam-hi.jpg
  - Torche    : http://IP/led?val=1 (allumer) ou val=0 (éteindre)
  - Réglages  : http://IP/control?var=framesize&val=6 | quality&val=10 | led_intensity&val=10
  - Etat      : http://IP/status

  IMPORTANT : l'ESP32-CAM ne fait PAS la détection IA (trop faible pour ça).
  Elle envoie la vidéo. La détection des yeux est faite par le PC
  (detector_eyes.py, lancé par start_all.ps1 -Esp32 IP), qui envoie ensuite
  les alertes au site web et à l'application mobile.
 ==============================================================================
*/

#include "esp_camera.h"
#include <WiFi.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"

// ── 1. WI-FI (2.4 GHz obligatoire) ───────────────────────────────────────────
const char* ssid     = "Redmi Note 13";
const char* password = "Mohamed123";

// ── 2. IP FIXE ───────────────────────────────────────────────────────────────
// La carte se connecte d'abord normalement, lit l'adresse de la box/du téléphone
// (passerelle), puis se reconfigure avec : même réseau + ce dernier nombre.
// Exemple : réseau 10.55.27.x et FIXED_LAST_OCTET = 200  ->  IP 10.55.27.200
// Choisissez un nombre entre 2 et 254, de préférence haut (150 à 250) pour ne pas
// tomber sur une adresse déjà donnée à un autre appareil.
// Mettez 0 pour désactiver l'IP fixe (IP automatique).
#define FIXED_LAST_OCTET 200

// ── 3. TORCHE (FLASH LED, GPIO 4) ────────────────────────────────────────────
#define FLASH_LED_PIN 4
#define TORCH_PERCENT 4            // luminosité de la torche en % (0 à 100)
#define TORCH_LEDC_CHANNEL 2       // canal 2 : la caméra utilise déjà le canal 0
int torchDuty = (255 * TORCH_PERCENT) / 100;

// ── 4. SENS DE L'IMAGE ───────────────────────────────────────────────────────
// Image à l'envers (haut/bas)      : FLIP_VERTICAL 1, FLIP_MIRROR 0
// Image en miroir (gauche/droite)  : FLIP_VERTICAL 0, FLIP_MIRROR 1
// Image tournée de 180 degrés      : FLIP_VERTICAL 1, FLIP_MIRROR 1
#define FLIP_VERTICAL 1
#define FLIP_MIRROR   0

// ── 5. PINS ESP32-CAM (AI THINKER) ───────────────────────────────────────────
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t stream_httpd = NULL;
httpd_handle_t camera_httpd = NULL;

// ── Torche ───────────────────────────────────────────────────────────────────
bool torchOn = false;

void torchInit() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttachChannel(FLASH_LED_PIN, 5000, 8, TORCH_LEDC_CHANNEL);
#else
  ledcSetup(TORCH_LEDC_CHANNEL, 5000, 8);
  ledcAttachPin(FLASH_LED_PIN, TORCH_LEDC_CHANNEL);
#endif
}

void torchWrite(int duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(FLASH_LED_PIN, duty);
#else
  ledcWrite(TORCH_LEDC_CHANNEL, duty);
#endif
}

void setTorch(bool on) {
  torchOn = on;
  torchWrite(on ? torchDuty : 0);
}

// ── Photo JPEG (/cam-hi.jpg et /capture) ─────────────────────────────────────
static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// ── Torche : /led?val=1 ou 0 ─────────────────────────────────────────────────
static esp_err_t led_handler(httpd_req_t *req) {
  char buf[64];
  bool state = true;
  if (httpd_req_get_url_query_str(req, buf, sizeof(buf)) == ESP_OK) {
    char param[32];
    if (httpd_query_key_value(buf, "val", param, sizeof(param)) == ESP_OK) {
      state = (atoi(param) > 0);
    }
  }
  setTorch(state);
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  char resp[64];
  snprintf(resp, sizeof(resp), "{\"ok\":true,\"torch\":\"%s\"}", state ? "on" : "off");
  return httpd_resp_send(req, resp, strlen(resp));
}

// ── Réglages : /control?var=<nom>&val=<nombre> ───────────────────────────────
//   framesize (6 = VGA 640x480, 7 = SVGA 800x600), quality (4-63, petit = meilleur),
//   brightness / contrast (-2..2), vflip / hmirror (0 ou 1),
//   led_intensity (0-255), flash | torch (0 = éteint, >0 = allumé)
static esp_err_t control_handler(httpd_req_t *req) {
  char buf[96], variable[32], value[16];
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  if (httpd_req_get_url_query_str(req, buf, sizeof(buf)) != ESP_OK ||
      httpd_query_key_value(buf, "var", variable, sizeof(variable)) != ESP_OK ||
      httpd_query_key_value(buf, "val", value, sizeof(value)) != ESP_OK) {
    return httpd_resp_send(req, "{\"ok\":false,\"error\":\"var/val manquants\"}", HTTPD_RESP_USE_STRLEN);
  }
  int val = atoi(value);
  sensor_t * s = esp_camera_sensor_get();
  int res = 0;

  if (!strcmp(variable, "led_intensity")) {
    torchDuty = constrain(val, 0, 255);
    setTorch(torchDuty > 0);
  } else if (!strcmp(variable, "flash") || !strcmp(variable, "torch")) {
    setTorch(val > 0);
  } else if (s == NULL) {
    res = -1;
  } else if (!strcmp(variable, "framesize")) {
    if (val >= 0 && val <= 13) res = s->set_framesize(s, (framesize_t)val);
    else res = -1;
  } else if (!strcmp(variable, "quality")) {
    res = s->set_quality(s, constrain(val, 4, 63));
  } else if (!strcmp(variable, "brightness")) {
    res = s->set_brightness(s, constrain(val, -2, 2));
  } else if (!strcmp(variable, "contrast")) {
    res = s->set_contrast(s, constrain(val, -2, 2));
  } else if (!strcmp(variable, "vflip")) {
    res = s->set_vflip(s, val > 0 ? 1 : 0);
  } else if (!strcmp(variable, "hmirror")) {
    res = s->set_hmirror(s, val > 0 ? 1 : 0);
  } else {
    res = -1;
  }
  char resp[64];
  snprintf(resp, sizeof(resp), "{\"ok\":%s}", res == 0 ? "true" : "false");
  return httpd_resp_send(req, resp, strlen(resp));
}

// ── Etat : /status ───────────────────────────────────────────────────────────
static esp_err_t status_handler(httpd_req_t *req) {
  sensor_t * s = esp_camera_sensor_get();
  char resp[200];
  snprintf(resp, sizeof(resp),
           "{\"ip\":\"%s\",\"rssi\":%d,\"framesize\":%d,\"quality\":%d,\"torch\":\"%s\"}",
           WiFi.localIP().toString().c_str(), WiFi.RSSI(),
           s ? (int)s->status.framesize : -1, s ? (int)s->status.quality : -1,
           torchOn ? "on" : "off");
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, resp, strlen(resp));
}

// ── Flux vidéo MJPEG (/stream sur le port 81) ────────────────────────────────
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char part_buf[64];

  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      res = ESP_FAIL;
      break;
    }
    _jpg_buf_len = fb->len;
    _jpg_buf = fb->buf;

    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    }
    if (res == ESP_OK) {
      size_t hlen = snprintf(part_buf, 64, _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, part_buf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }
    esp_camera_fb_return(fb);
    fb = NULL;
    _jpg_buf = NULL;
    if (res != ESP_OK) break;
  }
  return res;
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.lru_purge_enable = true;   // libère les anciennes connexions si le Wi-Fi coupe

  httpd_uri_t snap_uri = { .uri = "/cam-hi.jpg", .method = HTTP_GET, .handler = capture_handler, .user_ctx = NULL };
  httpd_uri_t cap_uri  = { .uri = "/capture",    .method = HTTP_GET, .handler = capture_handler, .user_ctx = NULL };
  httpd_uri_t led_uri  = { .uri = "/led",        .method = HTTP_GET, .handler = led_handler,     .user_ctx = NULL };
  httpd_uri_t ctrl_uri = { .uri = "/control",    .method = HTTP_GET, .handler = control_handler, .user_ctx = NULL };
  httpd_uri_t stat_uri = { .uri = "/status",     .method = HTTP_GET, .handler = status_handler,  .user_ctx = NULL };
  httpd_uri_t stream_uri = { .uri = "/stream",   .method = HTTP_GET, .handler = stream_handler,  .user_ctx = NULL };

  // Serveur principal (port 80)
  config.server_port = 80;
  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &snap_uri);
    httpd_register_uri_handler(camera_httpd, &cap_uri);
    httpd_register_uri_handler(camera_httpd, &led_uri);
    httpd_register_uri_handler(camera_httpd, &ctrl_uri);
    httpd_register_uri_handler(camera_httpd, &stat_uri);
  }

  // Serveur vidéo (port 81)
  config.server_port = 81;
  config.ctrl_port = 32769;
  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
  }
}

// ── Wi-Fi : attend la connexion (retourne false si délai dépassé) ────────────
bool waitWiFi(unsigned long timeoutMs) {
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (millis() - t0 > timeoutMs) return false;
  }
  return true;
}

// ── Wi-Fi : connexion puis passage en IP fixe ────────────────────────────────
void connectWiFi() {
  Serial.printf("Connexion au Wi-Fi %s ...\n", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);            // pas de veille Wi-Fi = vidéo plus fluide
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);          // n'use pas la mémoire flash à chaque connexion
  WiFi.begin(ssid, password);
  if (!waitWiFi(30000)) {
    Serial.println("\nWi-Fi introuvable, redémarrage...");
    ESP.restart();
  }
  Serial.println("\n✅ Wi-Fi connecté (IP automatique) : " + WiFi.localIP().toString());

#if FIXED_LAST_OCTET > 0
  IPAddress gw   = WiFi.gatewayIP();
  IPAddress mask = WiFi.subnetMask();
  IPAddress dns  = WiFi.dnsIP();
  IPAddress fixedIp(gw[0], gw[1], gw[2], FIXED_LAST_OCTET);   // même réseau (/24), dernier nombre choisi
  if (fixedIp != WiFi.localIP()) {
    Serial.println("Passage en IP fixe : " + fixedIp.toString());
    WiFi.disconnect();
    delay(200);
    WiFi.config(fixedIp, gw, mask, dns);
    WiFi.begin(ssid, password);
    if (!waitWiFi(20000)) {
      Serial.println("\nIP fixe refusée, redémarrage...");
      ESP.restart();
    }
  }
#endif
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // pas de redémarrage quand l'alimentation faiblit un instant

  Serial.begin(115200);
  Serial.println("\n--- Driver Safety Monitor: ESP32-CAM ---");

  // 1. Torche allumée automatiquement
  torchInit();
  setTorch(true);
  Serial.printf("💡 Torche ESP32-CAM activée à %d %%.\n", TORCH_PERCENT);

  // 2. Caméra : taille moyenne (VGA 640x480) et bonne qualité
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;   // toujours l'image la plus récente
  config.fb_location  = CAMERA_FB_IN_PSRAM;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;   // 640x480
    config.jpeg_quality = 10;              // petit nombre = meilleure qualité
    config.fb_count     = 2;
  } else {
    config.frame_size   = FRAMESIZE_CIF;   // 400x296 (secours sans PSRAM)
    config.jpeg_quality = 12;
    config.fb_count     = 1;
    config.fb_location  = CAMERA_FB_IN_DRAM;
    config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Échec d'initialisation caméra: 0x%x -> redémarrage dans 3 s\n", err);
    delay(3000);
    ESP.restart();
  }

  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 1);
    s->set_contrast(s, 1);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_vflip(s, FLIP_VERTICAL);       // remet l'image dans le bon sens
    s->set_hmirror(s, FLIP_MIRROR);
  }

  // 3. Wi-Fi + IP fixe
  connectWiFi();
  Serial.println("📡 Adresse IP de l'ESP32-CAM : " + WiFi.localIP().toString());

  // 4. Serveurs vidéo
  setTorch(true);
  startCameraServer();
  Serial.println("\n🎥 Caméra prête :");
  Serial.printf(" - Flux Vidéo Stream : http://%s:81/stream\n", WiFi.localIP().toString().c_str());
  Serial.printf(" - Snapshot Image    : http://%s/cam-hi.jpg\n", WiFi.localIP().toString().c_str());
  Serial.printf(" - Contrôle Torche   : http://%s/led?val=1 (ou 0)\n", WiFi.localIP().toString().c_str());
}

void loop() {
  // Si le Wi-Fi est perdu plus de 20 s, on redémarre : la carte refait tout toute seule
  // (connexion, IP fixe, caméra) dès que le Wi-Fi est de retour.
  static unsigned long lostSince = 0;
  if (WiFi.status() != WL_CONNECTED) {
    if (lostSince == 0) lostSince = millis();
    if (millis() - lostSince > 20000) {
      Serial.println("Wi-Fi perdu, redémarrage...");
      ESP.restart();
    }
  } else {
    lostSince = 0;
  }
  delay(2000);
}