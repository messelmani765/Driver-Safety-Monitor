import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'app_state.dart';

const kGreen = Color(0xFF10B981);
const kNavy = Color(0xFF0F172A);

String fmtDate(dynamic ts) {
  if (ts is! num) return '—';
  final d = DateTime.fromMillisecondsSinceEpoch(ts.toInt());
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}:${two(d.second)}';
}

String initialOf(String s) => s.isEmpty ? '?' : s.substring(0, 1).toUpperCase();

Widget statusBadge(String? label) {
  final l = label ?? 'En attente';
  Color bg = const Color(0xFFFEF3C7);
  Color text = const Color(0xFFB45309);

  if (l.contains('Annulé')) {
    bg = const Color(0xFFD1FAE5);
    text = const Color(0xFF047857);
  } else if (l.contains('appelée') || l.contains('Escalade')) {
    bg = const Color(0xFFFEE2E2);
    text = const Color(0xFFB91C1C);
  } else if (l.contains('répondu') || l.contains('Unité')) {
    bg = const Color(0xFFDBEAFE);
    text = const Color(0xFF1D4ED8);
  } else if (l.contains('Clôturé')) {
    bg = const Color(0xFFF3F4F6);
    text = const Color(0xFF4B5563);
  }

  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
    child: Text(l, style: TextStyle(color: text, fontSize: 12, fontWeight: FontWeight.w700)),
  );
}

// =================================================================== CONNEXION CLIENT
class ConnectPage extends StatefulWidget {
  final AppState app;
  const ConnectPage({super.key, required this.app});
  @override
  State<ConnectPage> createState() => _ConnectPageState();
}

class _ConnectPageState extends State<ConnectPage> {
  late final TextEditingController _hostCtrl;
  late final TextEditingController _userCtrl;
  late final TextEditingController _passCtrl;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _hostCtrl = TextEditingController(text: widget.app.host.isEmpty ? '10.55.27.243:8000' : widget.app.host);
    _userCtrl = TextEditingController(text: 'client1');
    _passCtrl = TextEditingController(text: 'client123');
  }

  @override
  void dispose() {
    _hostCtrl.dispose();
    _userCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _loading = true);
    final ok = await widget.app.login(_hostCtrl.text, _userCtrl.text, _passCtrl.text);
    if (mounted) setState(() => _loading = false);
    if (!ok && mounted && widget.app.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(widget.app.error!), backgroundColor: Colors.red),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kNavy,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(color: kGreen, borderRadius: BorderRadius.circular(24)),
                  child: const Icon(Icons.remove_red_eye, color: Colors.white, size: 44),
                ),
                const SizedBox(height: 16),
                const Text('DRIVER SAFETY MONITOR',
                    style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900)),
                const SizedBox(height: 4),
                const Text('Espace Conducteur (Client)', style: TextStyle(color: Colors.white70)),
                const SizedBox(height: 24),

                TextField(
                  controller: _hostCtrl,
                  keyboardType: TextInputType.url,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Adresse serveur (IP:port)',
                    labelStyle: const TextStyle(color: Colors.white70),
                    filled: true,
                    fillColor: const Color(0xFF1E293B),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    prefixIcon: const Icon(Icons.wifi, color: Colors.white70),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _userCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Identifiant client',
                    labelStyle: const TextStyle(color: Colors.white70),
                    filled: true,
                    fillColor: const Color(0xFF1E293B),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    prefixIcon: const Icon(Icons.person, color: Colors.white70),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _passCtrl,
                  obscureText: true,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Mot de passe',
                    labelStyle: const TextStyle(color: Colors.white70),
                    filled: true,
                    fillColor: const Color(0xFF1E293B),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    prefixIcon: const Icon(Icons.lock, color: Colors.white70),
                  ),
                ),
                const SizedBox(height: 18),

                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: kGreen,
                      padding: const EdgeInsets.all(16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: _loading ? null : _submit,
                    icon: _loading
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.login),
                    label: const Text('Se connecter à mon compte', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(height: 14),

                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: Colors.white70),
                  onPressed: () {
                    _userCtrl.text = 'client1';
                    _passCtrl.text = 'client123';
                  },
                  icon: const Icon(Icons.key, size: 18),
                  label: const Text('Remplir compte démo (client1 / client123)'),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Simulation : tout compte créé sur le site web fonctionne ici.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white38, fontSize: 12),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

// =================================================================== MON TRAJET (CARTE)
class TripPage extends StatelessWidget {
  final AppState app;
  const TripPage({super.key, required this.app});

  @override
  Widget build(BuildContext context) {
    final st = app.clientState ?? {};
    final isOnline = st['online'] == true;
    final stateStr = stateLabel(st['state']);
    final speed = (st['speed'] as num?)?.round() ?? 0;
    final pos = app.currentPos ?? const LatLng(35.8256, 10.5908);

    return Column(children: [
      // Carte d'état temps réel
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        color: Theme.of(context).cardColor,
        child: Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: isOnline ? const Color(0xFFD1FAE5) : const Color(0xFFF3F4F6),
              borderRadius: BorderRadius.circular(99),
            ),
            child: Row(children: [
              Icon(Icons.circle, size: 10, color: isOnline ? kGreen : Colors.grey),
              const SizedBox(width: 6),
              Text(isOnline ? 'EN LIGNE' : 'HORS LIGNE',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: isOnline ? const Color(0xFF047857) : Colors.grey)),
            ]),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(stateStr, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
              Text('Voiture: ${app.plate} (${app.vehicleCode})', style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('$speed km/h', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: kGreen)),
            const Text('Vitesse', style: TextStyle(fontSize: 11, color: Colors.grey)),
          ]),
        ]),
      ),

      // Carte FlutterMap
      Expanded(
        child: FlutterMap(
          options: MapOptions(
            initialCenter: pos,
            initialZoom: 15.0,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.example.drowsiness_app',
            ),
            if (app.route.isNotEmpty)
              PolylineLayer(polylines: [
                Polyline(points: app.route, strokeWidth: 5.0, color: const Color(0xFF10B981).withOpacity(0.8)),
              ]),
            MarkerLayer(markers: [
              Marker(
                point: pos,
                width: 44,
                height: 44,
                child: Container(
                  decoration: BoxDecoration(
                    color: kGreen,
                    shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: kGreen.withOpacity(0.4), blurRadius: 10, spreadRadius: 3)],
                  ),
                  child: const Icon(Icons.directions_car, color: Colors.white, size: 26),
                ),
              ),
            ]),
          ],
        ),
      ),

      // Bouton de simulation d'alerte
      Padding(
        padding: const EdgeInsets.all(12),
        child: SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(padding: const EdgeInsets.all(14)),
            onPressed: app.testAlert,
            icon: const Icon(Icons.warning_amber_rounded, color: Colors.red),
            label: const Text('Tester l\'alerte somnolence (5 s)'),
          ),
        ),
      ),
    ]);
  }
}

// =================================================================== MES ALARMES
class AlertsPage extends StatelessWidget {
  final AppState app;
  const AlertsPage({super.key, required this.app});

  @override
  Widget build(BuildContext context) {
    final alerts = app.alerts;
    return RefreshIndicator(
      onRefresh: app.loadAlerts,
      child: alerts.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(Icons.check_circle_outline, color: kGreen, size: 64),
                  SizedBox(height: 12),
                  Text('Aucune alarme pour le moment', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
                  SizedBox(height: 6),
                  Text('Tout va bien. Bonne route !', style: TextStyle(color: Colors.grey)),
                ]),
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: alerts.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (ctx, i) {
                final a = alerts[i];
                final eyes = a['eyes_closed_s'] is num ? (a['eyes_closed_s'] as num).toStringAsFixed(1) : '5.0';
                return Card(
                  elevation: 1,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        const Icon(Icons.warning_amber_rounded, color: Colors.red, size: 22),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(a['title'] ?? 'Somnolence détectée',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        ),
                        statusBadge(a['status_label']),
                      ]),
                      const SizedBox(height: 8),
                      Text('Durée yeux fermés : $eyes s', style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                        Text(fmtDate(a['ts']), style: const TextStyle(fontSize: 12, color: Colors.grey)),
                        if (a['image_url'] != null)
                          TextButton.icon(
                            style: TextButton.styleFrom(padding: EdgeInsets.zero),
                            onPressed: () => showDialog(
                              context: ctx,
                              builder: (_) => Dialog(
                                child: Image.network('${app.base}${a['image_url']}', fit: BoxFit.contain),
                              ),
                            ),
                            icon: const Icon(Icons.photo, size: 16),
                            label: const Text('Voir photo'),
                          ),
                      ]),
                    ]),
                  ),
                );
              },
            ),
    );
  }
}

// =================================================================== MES DÉTECTIONS
class DetectionsPage extends StatelessWidget {
  final AppState app;
  const DetectionsPage({super.key, required this.app});

  @override
  Widget build(BuildContext context) {
    final dets = app.detections;
    return RefreshIndicator(
      onRefresh: app.loadDetections,
      child: dets.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text('Aucune capture pour le moment.\nActivez la détection webcam sur le PC.',
                    textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
              ),
            )
          : GridView.builder(
              padding: const EdgeInsets.all(14),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 0.85,
              ),
              itemCount: dets.length,
              itemBuilder: (ctx, i) {
                final d = dets[i];
                final url = d['image_url'];
                final eyes = d['eyes_closed_s'] is num ? (d['eyes_closed_s'] as num).toStringAsFixed(1) : '5.0';
                return Card(
                  clipBehavior: Clip.antiAlias,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Expanded(
                      child: url != null
                          ? Image.network(
                              '${app.base}$url',
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Container(
                                color: Colors.black12,
                                child: const Icon(Icons.broken_image, color: Colors.grey),
                              ),
                            )
                          : Container(
                              color: Colors.black12,
                              child: const Icon(Icons.photo, color: Colors.grey),
                            ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(8),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('$eyes s fermés', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.red)),
                        Text(fmtDate(d['ts']), style: const TextStyle(fontSize: 10, color: Colors.grey)),
                      ]),
                    ),
                  ]),
                );
              },
            ),
    );
  }
}

// =================================================================== MON PROFIL
class ProfilePage extends StatelessWidget {
  final AppState app;
  const ProfilePage({super.key, required this.app});

  Widget _tile(String title, String val, IconData icon) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(icon, color: kGreen),
        title: Text(title, style: const TextStyle(fontSize: 12, color: Colors.grey)),
        subtitle: Text(val.isNotEmpty ? val : '—', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
      );

  @override
  Widget build(BuildContext context) {
    final u = app.user ?? {};
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Carte d'en-tête
        Center(
          child: Column(children: [
            CircleAvatar(
              radius: 40,
              backgroundColor: kGreen,
              child: Text(initialOf('${u['full_name']}'),
                  style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.white)),
            ),
            const SizedBox(height: 12),
            Text('${u['full_name'] ?? 'Conducteur'}',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: Colors.grey.withOpacity(0.15), borderRadius: BorderRadius.circular(8)),
              child: Text('Matricule : ${u['plate'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          ]),
        ),
        const SizedBox(height: 24),

        const Text('INFORMATIONS PERSONNELLES', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.grey)),
        _tile('CIN (fictif)', '${u['cin'] ?? ''}', Icons.badge_outlined),
        _tile('Téléphone', '${u['phone'] ?? ''}', Icons.phone_outlined),
        _tile('Email', '${u['email'] ?? ''}', Icons.email_outlined),
        const Divider(),

        const Text('VÉHICULE ASSOCIÉ', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.grey)),
        _tile('Code Détection Webcam', '${u['vehicle_code'] ?? 'car01'}', Icons.videocam_outlined),
        _tile('Marque & Modèle', '${u['brand'] ?? ''} ${u['model'] ?? ''}', Icons.directions_car_outlined),
        const Divider(),

        const Text('CONTACT D\'URGENCE', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.grey)),
        _tile('Nom du contact', '${u['emergency_name'] ?? ''}', Icons.emergency_outlined),
        _tile('Téléphone d\'urgence', '${u['emergency_phone'] ?? ''}', Icons.phone_in_talk_outlined),
        const SizedBox(height: 24),

        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: Colors.red, padding: const EdgeInsets.all(14)),
            onPressed: app.logout,
            icon: const Icon(Icons.logout),
            label: const Text('Se déconnecter'),
          ),
        ),
      ]),
    );
  }
}
