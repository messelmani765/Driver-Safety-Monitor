/*
 ==============================================================================
  DRIVER SAFETY MONITOR - ESP32-CAM FIRMWARE
  Modèle : ESP32-CAM (AI-Thinker)
  
  Fonctionnalités :
  - Résolution MOYENNE fluide & nette (VGA 640x480 / SVGA 800x600)
  - Qualité JPEG élevée (quality = 10) pour détection précise des yeux
  - Torche LED Flash (GPIO 4) ACTIVÉE AUTOMATIQUEMENT à l'allumage
  - Serveur MJPEG sur le port 81 : http://<IP>:81/stream
  - Snapshot JPEG sur le port 80 : http://<IP>/cam-hi.jpg
  - Contrôle de la torche via HTTP : http://<IP>/led?val=1 (ON) ou 0 (OFF)
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

// ── 1. VOS IDENTIFIANTS WI-FI ────────────────────────────────────────────────
const char* ssid = "VOTRE_NOM_WIFI";       // Mettez le nom de votre Wi-Fi (ex: smartphone ou box)
const char* password = "VOTRE_MOT_DE_PASSE"; // Mettez le mot de passe Wi-Fi

// ── 2. BROCHE DU FLASH LED (TORCHE) ──────────────────────────────────────────
#define FLASH_LED_PIN 4

// ── 3. DÉFINITION DES PINS ESP32-CAM (AI THINKER) ────────────────────────────
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

// ── Gestion de la Torche ────────────────────────────────────────────────────
void setTorch(bool on) {
  digitalWrite(FLASH_LED_PIN, on ? HIGH : LOW);
}

// ── Handler Snapshot JPEG (/cam-hi.jpg & /capture) ──────────────────────────
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

// ── Handler Contrôle Torche (/led?val=1 ou /control?var=led_intensity&val=...)
static esp_err_t led_handler(httpd_req_t *req) {
  char buf[64];
  size_t buf_len = sizeof(buf);
  bool state = true;
  if (httpd_req_get_url_query_str(req, buf, buf_len) == ESP_OK) {
    char param[32];
    if (httpd_query_key_value(buf, "val", param, sizeof(param)) == ESP_OK) {
      int v = atoi(param);
      state = (v > 0);
    }
  }
  setTorch(state);
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  char resp[64];
  snprintf(resp, sizeof(resp), "{\"ok\":true,\"torch\":\"%s\"}", state ? "on" : "off");
  return httpd_resp_send(req, resp, strlen(resp));
}

// ── Handler Flux MJPEG (/stream sur port 81) ─────────────────────────────────
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

  httpd_uri_t snap_uri = { .uri = "/cam-hi.jpg", .method = HTTP_GET, .handler = capture_handler, .user_ctx = NULL };
  httpd_uri_t cap_uri  = { .uri = "/capture",    .method = HTTP_GET, .handler = capture_handler, .user_ctx = NULL };
  httpd_uri_t led_uri  = { .uri = "/led",        .method = HTTP_GET, .handler = led_handler,     .user_ctx = NULL };
  httpd_uri_t ctrl_uri = { .uri = "/control",    .method = HTTP_GET, .handler = led_handler,     .user_ctx = NULL };

  httpd_uri_t stream_uri = { .uri = "/stream", .method = HTTP_GET, .handler = stream_handler, .user_ctx = NULL };

  // Serveur Web principal (Port 80)
  config.server_port = 80;
  if (httpd_start(&camera_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &snap_uri);
    httpd_register_uri_handler(camera_httpd, &cap_uri);
    httpd_register_uri_handler(camera_httpd, &led_uri);
    httpd_register_uri_handler(camera_httpd, &ctrl_uri);
  }

  // Serveur Flux Vidéo (Port 81)
  config.server_port = 81;
  config.ctrl_port = 32769;
  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Désactiver le brownout detector pour éviter les reboot
  
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println("\n--- Driver Safety Monitor: ESP32-CAM ---");

  // 1. Initialisation de la torche (Flash LED GPIO 4)
  pinMode(FLASH_LED_PIN, OUTPUT);
  setTorch(true); // ALLUMAGE AUTOMATIQUE DE LA TORCHE !
  Serial.println("💡 Torche ESP32-CAM activée automatiquement.");

  // 2. Configuration Caméra (Taille moyenne & Bonne qualité)
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

  // TAILLE MOYENNE & QUALITÉ OPTIMALE (VGA 640x480 ou SVGA 800x600)
  if (psramFound()) {
    config.frame_size = FRAMESIZE_VGA; // 640x480 (Taille moyenne idéale sans lag)
    config.jpeg_quality = 10;          // 10 = Excellente netteté pour les yeux
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_CIF; // 400x296 secours sans PSRAM
    config.jpeg_quality = 12;
    config.fb_count = 1;
  }

  // Initialisation du capteur caméra
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Échec d'initialisation caméra: 0x%x\n", err);
    return;
  }

  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 1);     // Légère clarté pour l'habitacle de la voiture
    s->set_contrast(s, 1);       // Bon contraste pour bien voir les pupilles
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);       // Balance des blancs automatique
    s->set_awb_gain(s, 1);
  }

  // 3. Connexion au réseau Wi-Fi
  Serial.printf("Connexion au Wi-Fi %s ...\n", ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ Wi-Fi connecté !");
  Serial.print("📡 Adresse IP de l'ESP32-CAM : ");
  Serial.println(WiFi.localIP());

  // 4. Démarrage des serveurs
  startCameraServer();
  Serial.println("\n🎥 Caméra prête :");
  Serial.printf(" - Flux Vidéo Stream : http://%s:81/stream\n", WiFi.localIP().toString().c_str());
  Serial.printf(" - Snapshot Image    : http://%s/cam-hi.jpg\n", WiFi.localIP().toString().c_str());
  Serial.printf(" - Contrôle Torche   : http://%s/led?val=1 (ou 0)\n", WiFi.localIP().toString().c_str());
}

void loop() {
  delay(10000);
}
