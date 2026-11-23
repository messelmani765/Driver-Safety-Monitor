import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'alarm_service.dart';

typedef Json = Map<String, dynamic>;

const kStateLabels = <String, String>{
  'EyesOpen': 'Yeux ouverts',
  'EyesClosed': 'Yeux fermés',
  'Asleep': 'ENDORMI',
  'NoFace': 'Visage non détecté',
  'NoDetection': '—',
};
String stateLabel(String? s) => kStateLabels[s ?? ''] ?? (s ?? '—');

/// Tout l'état de l'application conducteur (authentification, profil, trajet, alarmes, détections).
class AppState extends ChangeNotifier {
  final AlarmService alarm = AlarmService();

  // réglages locaux & auth
  String host = '';
  String? token;
  Json? user;
  bool dark = false;
  bool muted = false;

  // connexion
  bool wantConnection = false;
  bool connected = false;
  String? error;
  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _reconnect;
  Timer? _ping;

  // données client
  Json? clientState;
  List<Json> alerts = [];
  List<Json> detections = [];
  List<LatLng> route = [];
  LatLng? currentPos;
  bool routeFallback = false;
  double? routeKm;

  // alerte plein écran
  Json? alert;
  final List<Json> queue = [];
  int ackLeft = 0;
  Timer? _ackTimer;

  // appel de police SIMULÉ
  Json? call;
  int callSeconds = 0;
  Timer? _callTimer;

  String get base => 'http://$host';
  String get vehicleCode => user?['vehicle_code'] ?? 'car01';
  String get plate => user?['plate'] ?? '—';
  String get driverName => user?['full_name'] ?? '—';
  String plateOf(String? code) => (code == null || code == vehicleCode ? plate : code);
  String driverOf(String? code) => (code == null || code == vehicleCode ? driverName : '—');

  // ------------------------------------------------------------ démarrage
  Future<void> init() async {
    try {
      final p = await SharedPreferences.getInstance();
      host = p.getString('host') ?? '';
      token = p.getString('token');
      final userRaw = p.getString('user');
      if (userRaw != null) {
        user = jsonDecode(userRaw);
      }
      dark = p.getBool('dark') ?? false;
      muted = p.getBool('muted') ?? false;
    } catch (_) {}
    await alarm.init();
    notifyListeners();

    if (host.isNotEmpty && token != null && token!.isNotEmpty) {
      await verifySessionAndConnect();
    }
  }

  Future<void> setDark(bool v) async {
    dark = v;
    notifyListeners();
    try {
      (await SharedPreferences.getInstance()).setBool('dark', v);
    } catch (_) {}
  }

  Future<void> setMuted(bool v) async {
    muted = v;
    if (v) await alarm.stopAll();
    notifyListeners();
    try {
      (await SharedPreferences.getInstance()).setBool('muted', v);
    } catch (_) {}
  }

  // ------------------------------------------------------------ authentification
  String _cleanHost(String h) {
    var s = h.trim().replaceAll('http://', '').replaceAll('https://', '').replaceAll(RegExp(r'/+$'), '');
    if (s.isNotEmpty && !s.contains(':')) s = '$s:8000';
    return s;
  }

  Future<bool> login(String h, String username, String password) async {
    host = _cleanHost(h);
    error = null;
    notifyListeners();

    try {
      final uri = Uri.parse('$base/api/auth/login');
      final res = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'username': username.trim(), 'password': password.trim()}),
      ).timeout(const Duration(seconds: 8));

      final data = jsonDecode(utf8.decode(res.bodyBytes));
      if (res.statusCode == 200 && data['ok'] == true) {
        token = data['token'];
        user = data['user'];
        wantConnection = true;

        final p = await SharedPreferences.getInstance();
        await p.setString('host', host);
        await p.setString('token', token!);
        await p.setString('user', jsonEncode(user));

        notifyListeners();
        await loadAll();
        await _openWs();
        return true;
      } else {
        error = data['error'] ?? 'Identifiant ou mot de passe incorrect';
        notifyListeners();
        return false;
      }
    } catch (e) {
      error = 'Connexion au serveur impossible ($host). Vérifiez l\'adresse IP et le Wi-Fi.';
      notifyListeners();
      return false;
    }
  }

  Future<void> verifySessionAndConnect() async {
    try {
      final res = await _get('/api/auth/me');
      if (res['ok'] == true && res['user'] != null) {
        user = res['user'];
        wantConnection = true;
        notifyListeners();
        await loadAll();
        await _openWs();
        return;
      }
    } catch (_) {}
    // Session expirée
    await logout();
  }

  Future<void> logout() async {
    if (token != null) {
      try {
        await http.post(
          Uri.parse('$base/api/auth/logout'),
          headers: {'Authorization': 'Bearer $token'},
        ).timeout(const Duration(seconds: 4));
      } catch (_) {}
    }
    disconnect();
    token = null;
    user = null;
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
    await p.remove('user');
    notifyListeners();
  }

  void disconnect() {
    wantConnection = false;
    connected = false;
    _reconnect?.cancel();
    _ping?.cancel();
    _sub?.cancel();
    try {
      _channel?.sink.close();
    } catch (_) {}
    notifyListeners();
  }

  // ------------------------------------------------------------ WebSocket
  Future<void> _openWs() async {
    _sub?.cancel();
    _ping?.cancel();
    try {
      _channel?.sink.close();
    } catch (_) {}
    if (!wantConnection || token == null) return;

    try {
      final uri = Uri.parse('ws://$host/ws?token=${Uri.encodeComponent(token!)}');
      final ch = WebSocketChannel.connect(uri);
      await ch.ready;
      _channel = ch;
      connected = true;
      error = null;
      notifyListeners();

      _sub = ch.stream.listen(_onData, onDone: _onClosed, onError: (_) => _onClosed());
      _ping = Timer.periodic(const Duration(seconds: 20), (_) {
        try {
          _channel?.sink.add('ping');
        } catch (_) {}
      });
    } catch (e) {
      _onClosed();
    }
  }

  void _onClosed() {
    connected = false;
    notifyListeners();
    _reconnect?.cancel();
    if (wantConnection && token != null) {
      _reconnect = Timer(const Duration(seconds: 3), _openWs);
    }
  }

  // ------------------------------------------------------------ HTTP helpers
  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<dynamic> _get(String path) async {
    final r = await http.get(Uri.parse('$base$path'), headers: _headers).timeout(const Duration(seconds: 6));
    if (r.statusCode == 401) {
      logout();
      throw Exception('Session expirée');
    }
    if (r.statusCode != 200) throw Exception('HTTP ${r.statusCode}');
    return jsonDecode(utf8.decode(r.bodyBytes));
  }

  Future<dynamic> _post(String path, [dynamic body]) async {
    final r = await http.post(
      Uri.parse('$base$path'),
      headers: _headers,
      body: body != null ? jsonEncode(body) : null,
    ).timeout(const Duration(seconds: 8));
    if (r.statusCode != 200) throw Exception('HTTP ${r.statusCode}');
    return jsonDecode(utf8.decode(r.bodyBytes));
  }

  List<Json> _list(dynamic d) => (d as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  Future<void> loadAll() async {
    await Future.wait([loadProfile(), loadRoute(), loadAlerts(), loadDetections(), loadClientState()]);
  }

  Future<void> loadProfile() async {
    try {
      user = Map<String, dynamic>.from(await _get('/api/client/profile') as Map);
      notifyListeners();
    } catch (_) {}
  }

  Future<void> loadRoute() async {
    try {
      final d = Map<String, dynamic>.from(await _get('/api/client/route') as Map);
      route = (d['points'] as List)
          .map((p) => LatLng((p[0] as num).toDouble(), (p[1] as num).toDouble()))
          .toList();
      routeFallback = d['fallback'] == true;
      routeKm = (d['distance_km'] as num?)?.toDouble();
      if (d['current_pos'] != null) {
        final cp = d['current_pos'] as List;
        currentPos = LatLng((cp[0] as num).toDouble(), (cp[1] as num).toDouble());
      } else if (route.isNotEmpty) {
        currentPos = route.first;
      }
      notifyListeners();
    } catch (_) {}
  }

  Future<void> loadAlerts() async {
    try {
      alerts = _list(await _get('/api/client/alerts?limit=500'));
      notifyListeners();
    } catch (_) {}
  }

  Future<void> loadDetections() async {
    try {
      detections = _list(await _get('/api/client/detections'));
      notifyListeners();
    } catch (_) {}
  }

  Future<void> loadClientState() async {
    try {
      clientState = Map<String, dynamic>.from(await _get('/api/client/state') as Map);
      if (clientState?['lat'] != null && clientState?['lon'] != null) {
        currentPos = LatLng((clientState!['lat'] as num).toDouble(), (clientState!['lon'] as num).toDouble());
      }
      notifyListeners();
    } catch (_) {}
  }

  Future<void> testAlert() async {
    try {
      await http.post(Uri.parse('$base/api/simulate/asleep?vehicle=$vehicleCode'));
    } catch (_) {}
  }

  // ------------------------------------------------------------ WebSocket Messages
  void _onData(dynamic raw) {
    try {
      final m = jsonDecode(raw as String) as Map;
      final type = m['type'];
      final vid = m['vehicle_id'] ?? m['vehicle_code'];

      // Ne traiter que les messages de SA voiture (ou messages système)
      if (vid != null && vid != vehicleCode && type != 'snapshot') {
        return;
      }

      switch (type) {
        case 'snapshot':
          final stList = m['states'] as List?;
          if (stList != null && stList.isNotEmpty) {
            clientState = Map<String, dynamic>.from(stList.first as Map);
            if (clientState?['lat'] != null && clientState?['lon'] != null) {
              currentPos = LatLng((clientState!['lat'] as num).toDouble(), (clientState!['lon'] as num).toDouble());
            }
          }
          notifyListeners();
          break;

        case 'state':
          clientState = Map<String, dynamic>.from(m);
          if (m['lat'] != null && m['lon'] != null) {
            currentPos = LatLng((m['lat'] as num).toDouble(), (m['lon'] as num).toDouble());
          }
          notifyListeners();
          break;

        case 'alert':
          loadAlerts();
          if ((m['level'] as num? ?? 0) >= 4) {
            _pushAlert(Map<String, dynamic>.from(m));
          }
          break;

        case 'detection_update':
          if (alert != null && alert?['detection_id'] == m['detection_id']) {
            alert?['image_url'] = m['image_url'];
            notifyListeners();
          }
          loadDetections();
          break;

        case 'escalation':
          if (alert != null && alert?['detection_id'] == m['detection_id']) {
            _startCall(Map<String, dynamic>.from(m));
          }
          loadAlerts();
          break;

        case 'ack':
        case 'alert_status':
          if (alert != null &&
              (alert?['detection_id'] == m['detection_id'] || alert?['alert_id'] == m['alert_id'])) {
            _closeAlert();
          }
          loadAlerts();
          break;
      }
    } catch (_) {}
  }

  // ------------------------------------------------------------ Alerte plein écran
  void _pushAlert(Json a) {
    if (alert == null) {
      _showAlert(a);
    } else {
      queue.add(a);
      notifyListeners();
    }
  }

  Future<void> _showAlert(Json a) async {
    alert = a;
    ackLeft = ((a['ack_timeout_s'] as num?)?.toInt()) ?? 10;
    notifyListeners();

    if (!muted) {
      await alarm.startSiren();
      await alarm.speak('Attention, conducteur endormi.');
    }

    _ackTimer?.cancel();
    _ackTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      ackLeft -= 1;
      notifyListeners();
      if (ackLeft <= 0) {
        t.cancel();
      }
    });
  }

  void _closeAlert() {
    _ackTimer?.cancel();
    alarm.stopAll();
    alert = null;
    notifyListeners();
    if (queue.isNotEmpty) {
      _showAlert(queue.removeAt(0));
    }
  }

  Future<void> acknowledge() async {
    final a = alert;
    _closeAlert();
    if (a != null) {
      final aid = a['alert_id'] ?? a['id'];
      if (aid != null) {
        try {
          await _post('/api/client/alerts/$aid/awake');
        } catch (_) {}
      }
    }
    await loadAlerts();
  }

  void stopSirenOnly() {
    alarm.stopSiren();
  }

  // ------------------------------------------------------------ Appel simulé
  void _startCall(Json esc) {
    _closeAlert();
    call = esc;
    callSeconds = 0;
    notifyListeners();
    if (!muted) alarm.speak('Appel de secours à la police en cours.');

    _callTimer?.cancel();
    _callTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      callSeconds += 1;
      notifyListeners();
    });
  }

  void endCall() {
    _callTimer?.cancel();
    call = null;
    notifyListeners();
  }
}
