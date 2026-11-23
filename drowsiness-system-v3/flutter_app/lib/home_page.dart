import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'app_state.dart';
import 'pages.dart';

const _kRed = Color(0xFFEF4444);
const _kBlue = Color(0xFF3B82F6);
const _kAmber = Color(0xFFF59E0B);

Color _lvlColor(int v) => v >= 70 ? kGreen : (v >= 40 ? _kAmber : _kRed);

String _two(int n) => n.toString().padLeft(2, '0');

String _hms(dynamic ts) {
  if (ts is! num) return '—';
  final d = DateTime.fromMillisecondsSinceEpoch(ts.toInt());
  return '${_two(d.hour)}:${_two(d.minute)}:${_two(d.second)}';
}

String _dmy(dynamic ts) {
  if (ts is! num) return '—';
  final d = DateTime.fromMillisecondsSinceEpoch(ts.toInt());
  return '${_two(d.day)}/${_two(d.month)}/${d.year}';
}

/// Page d'accueil conducteur : même design que le tableau de bord du site web.
class HomePage extends StatelessWidget {
  final AppState app;
  final void Function(int index) onGoto;
  const HomePage({super.key, required this.app, required this.onGoto});

  // ---------------------------------------------------------------- briques
  Widget _card(BuildContext context, {required Widget child}) {
    final t = Theme.of(context);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: t.cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: t.dividerColor.withOpacity(.35)),
      ),
      child: child,
    );
  }

  Widget _head(IconData icon, Color color, String title, {String? action, VoidCallback? onAction}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(color: color.withOpacity(.15), borderRadius: BorderRadius.circular(10)),
          child: Icon(icon, color: color, size: 18),
        ),
        const SizedBox(width: 10),
        Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
        if (action != null)
          TextButton(
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(0, 30)),
            onPressed: onAction,
            child: Text(action, style: const TextStyle(fontSize: 12)),
          ),
      ]),
    );
  }

  Widget _kpi(BuildContext context, IconData icon, Color color, String label, String value) {
    final t = Theme.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: t.cardColor,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: t.dividerColor.withOpacity(.35)),
        ),
        child: Row(children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(color: color.withOpacity(.15), borderRadius: BorderRadius.circular(12)),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: Colors.grey)),
              const SizedBox(height: 2),
              Text(value, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _bar(double pct, Color color) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: LinearProgressIndicator(
        value: (pct / 100).clamp(0.0, 1.0),
        minHeight: 10,
        color: color,
        backgroundColor: Colors.grey.withOpacity(.2),
      ),
    );
  }

  Widget _field(String label, String? val, double width) {
    final v = (val == null || val.trim().isEmpty) ? '—' : val.trim();
    return SizedBox(
      width: width,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
        const SizedBox(height: 2),
        Text(v, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
      ]),
    );
  }

  // ---------------------------------------------------------------- page
  @override
  Widget build(BuildContext context) {
    final u = app.user ?? <String, dynamic>{};
    final st = app.clientState ?? <String, dynamic>{};
    final alerts = app.alerts;
    final dets = app.detections;

    final weekAgo = DateTime.now().millisecondsSinceEpoch - 7 * 86400000;
    final critical = alerts.where((a) => ((a['level'] as num?) ?? 4) >= 4).toList();
    final alertsWeek = critical.where((a) => ((a['ts'] as num?) ?? 0) > weekAgo).length;
    final score = math.max(0, 100 - alertsWeek * 10);
    final last = critical.isNotEmpty ? critical.first : (alerts.isNotEmpty ? alerts.first : null);

    final online = st['online'] == true;
    final stateRaw = st['state'] as String?;
    final eyesLabel = stateRaw == null
        ? 'En attente de données'
        : (stateRaw == 'EyesClosed' || stateRaw == 'Asleep')
            ? 'Yeux fermés'
            : stateRaw == 'NoFace'
                ? 'Visage non détecté'
                : 'Yeux ouverts';
    final speed = (st['speed'] as num?)?.round() ?? 0;
    final closedS = (st['eyes_closed_s'] as num?)?.toDouble() ?? 0;
    final vig = (100 - (closedS / 5) * 100).round().clamp(0, 100);
    final progress = (st['route_progress'] as num?)?.toDouble();
    final km = app.routeKm;

    final fullName = '${u['full_name'] ?? u['username'] ?? '—'}';
    final brandModel = '${u['brand'] ?? ''} ${u['model'] ?? ''}'.trim();

    return RefreshIndicator(
      onRefresh: app.loadAll,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(14),
        children: [
          // ---- 4 cartes de stats
          Row(children: [
            _kpi(context, Icons.notifications_active, _kRed, 'Alertes critiques (7 j)', '$alertsWeek'),
            const SizedBox(width: 10),
            _kpi(context, Icons.photo_camera, _kBlue, 'Images détectées', '${dets.length}'),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            _kpi(context, Icons.route, kGreen, 'Distance du trajet', km == null ? '—' : '${km.toStringAsFixed(1)} km'),
            const SizedBox(width: 10),
            _kpi(context, Icons.schedule, _kAmber, 'Dernière alerte',
                last == null ? 'Aucune' : '${_dmy(last['ts'])}\n${_hms(last['ts'])}'),
          ]),
          const SizedBox(height: 14),

          // ---- bandeau d'état en direct
          _card(
            context,
            child: Row(children: [
              Container(
                width: 14,
                height: 14,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: online ? kGreen : Colors.grey,
                  boxShadow: online ? [BoxShadow(color: kGreen.withOpacity(.5), blurRadius: 8, spreadRadius: 2)] : null,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 3,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Voiture ${app.plate}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                  Text(online ? 'En ligne' : 'Hors ligne', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                  const SizedBox(height: 6),
                  Text('État', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                  Text(eyesLabel, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                ]),
              ),
              Expanded(
                flex: 2,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Vitesse', style: TextStyle(fontSize: 11, color: Colors.grey)),
                  Text('$speed km/h', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: kGreen)),
                  const SizedBox(height: 6),
                  const Text('Mise à jour', style: TextStyle(fontSize: 11, color: Colors.grey)),
                  Text(_hms(st['ts']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                ]),
              ),
            ]),
          ),

          // ---- carte
          _card(
            context,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(Icons.map, kGreen, 'Surveillance cartographique', action: 'Plein écran', onAction: () => onGoto(1)),
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(height: 220, child: _MiniMap(app: app)),
              ),
            ]),
          ),

          // ---- fiche client
          _card(
            context,
            child: LayoutBuilder(builder: (ctx, c) {
              final w = (c.maxWidth - 12) / 2;
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _head(Icons.badge, _kBlue, 'Fiche client', action: 'Modifier', onAction: () => onGoto(4)),
                Row(children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: kGreen,
                    child: Text(initialOf(fullName),
                        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(fullName, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                      Text('${u['email'] ?? u['username'] ?? '—'}',
                          overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Colors.grey)),
                    ]),
                  ),
                ]),
                const SizedBox(height: 14),
                Wrap(spacing: 12, runSpacing: 12, children: [
                  _field('CIN (fictif)', '${u['cin'] ?? u['license_no'] ?? ''}', w),
                  _field('Téléphone', '${u['phone'] ?? ''}', w),
                  _field('Véhicule', '${u['plate'] ?? ''}', w),
                  _field('Code véhicule', '${u['vehicle_code'] ?? ''}', w),
                  _field('Marque / Modèle', brandModel, w),
                  _field("Contact d'urgence", '${u['emergency_name'] ?? ''}', w),
                  _field("Tél d'urgence", '${u['emergency_phone'] ?? ''}', w),
                ]),
              ]);
            }),
          ),

          // ---- score de sécurité
          _card(
            context,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(Icons.shield, kGreen, 'Score de sécurité'),
              Row(children: [
                SizedBox(
                  width: 110,
                  height: 110,
                  child: CustomPaint(
                    painter: _RingPainter(score / 100, _lvlColor(score), Colors.grey.withOpacity(.2)),
                    child: Center(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text('$score', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
                        const Text('/ 100', style: TextStyle(fontSize: 11, color: Colors.grey)),
                      ]),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    alertsWeek == 0
                        ? 'Aucune alerte cette semaine. Bonne conduite !'
                        : '$alertsWeek alerte${alertsWeek > 1 ? 's' : ''} critique${alertsWeek > 1 ? 's' : ''} cette semaine.',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                  ),
                ),
              ]),
            ]),
          ),

          // ---- vigilance en direct
          _card(
            context,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(Icons.visibility, kGreen, 'Vigilance en direct'),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                const Text('Niveau de vigilance', style: TextStyle(fontSize: 13)),
                Text('$vig%', style: const TextStyle(fontWeight: FontWeight.w900)),
              ]),
              const SizedBox(height: 6),
              _bar(vig.toDouble(), _lvlColor(vig)),
              const SizedBox(height: 18),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                const Text('Progression du trajet', style: TextStyle(fontSize: 13)),
                Text(progress == null ? '—' : '${progress.round()} %', style: const TextStyle(fontWeight: FontWeight.w900)),
              ]),
              const SizedBox(height: 6),
              _bar(progress ?? 0, _kBlue),
              const SizedBox(height: 6),
              Text(
                progress == null
                    ? 'En attente de la voiture'
                    : (km != null ? '${(km * (1 - progress / 100)).toStringAsFixed(1)} km restants' : 'Trajet en cours'),
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ]),
          ),

          // ---- dernières images
          _card(
            context,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(Icons.photo_library, _kBlue, 'Dernières images détectées', action: 'Tout voir', onAction: () => onGoto(3)),
              if (dets.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Center(child: Text('Aucune image détectée pour le moment.', style: TextStyle(color: Colors.grey))),
                )
              else
                GridView.count(
                  crossAxisCount: 3,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                  children: dets.take(6).map((d) => _thumb(context, d)).toList(),
                ),
            ]),
          ),

          // ---- dernières alertes
          _card(
            context,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _head(Icons.notifications, _kRed, 'Dernières alertes', action: 'Tout voir', onAction: () => onGoto(2)),
              if (alerts.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Center(child: Text('Aucune alerte. Tout va bien.', style: TextStyle(color: Colors.grey))),
                )
              else
                ...alerts.take(6).map((a) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Container(width: 10, height: 10, decoration: const BoxDecoration(color: _kRed, shape: BoxShape.circle)),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${a['title'] ?? 'Somnolence'}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                            Text(fmtDate(a['ts']), style: const TextStyle(fontSize: 11, color: Colors.grey)),
                          ]),
                        ),
                        statusBadge(a['status_label'] as String?),
                      ]),
                    )),
            ]),
          ),

          // ---- graphique 7 jours
          _card(context, child: _weekChart(context, alerts)),
        ],
      ),
    );
  }

  Widget _thumb(BuildContext context, Map<String, dynamic> d) {
    final url = d['image_url'];
    final eyes = d['eyes_closed_s'] is num ? '${(d['eyes_closed_s'] as num).toStringAsFixed(1)} s' : '—';
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => showDialog(
        context: context,
        builder: (_) => Dialog(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (url != null) Image.network('${app.base}$url', fit: BoxFit.contain),
              const SizedBox(height: 10),
              Text('Détection du ${fmtDate(d['ts'])}', style: const TextStyle(fontWeight: FontWeight.bold)),
              Text('Yeux fermés : $eyes'),
            ]),
          ),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Stack(fit: StackFit.expand, children: [
          if (url != null)
            Image.network(
              '${app.base}$url',
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(color: Colors.black12, child: const Icon(Icons.broken_image, color: Colors.grey)),
            )
          else
            Container(color: Colors.black12, child: const Icon(Icons.photo, color: Colors.grey)),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              color: Colors.black54,
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Text(eyes, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _weekChart(BuildContext context, List<Map<String, dynamic>> alerts) {
    const names = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    final now = DateTime.now();
    final days = List.generate(7, (i) => now.subtract(Duration(days: 6 - i)));
    final counts = days.map((d) {
      return alerts.where((a) {
        final ts = a['ts'];
        if (ts is! num) return false;
        final x = DateTime.fromMillisecondsSinceEpoch(ts.toInt());
        return x.year == d.year && x.month == d.month && x.day == d.day;
      }).length;
    }).toList();
    final maxC = math.max(1, counts.reduce(math.max));

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _head(Icons.bar_chart, kGreen, 'Mes alertes des 7 derniers jours'),
      SizedBox(
        height: 150,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: List.generate(7, (i) {
            final h = 90.0 * counts[i] / maxC;
            return Expanded(
              child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                Text('${counts[i]}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                const SizedBox(height: 3),
                Container(
                  height: math.max(counts[i] == 0 ? 3.0 : 8.0, h),
                  margin: const EdgeInsets.symmetric(horizontal: 6),
                  decoration: BoxDecoration(
                    color: counts[i] == 0 ? Colors.grey.withOpacity(.3) : kGreen.withOpacity(.85),
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                const SizedBox(height: 5),
                Text('${names[days[i].weekday - 1]}\n${_two(days[i].day)}',
                    textAlign: TextAlign.center, style: const TextStyle(fontSize: 10, color: Colors.grey)),
              ]),
            );
          }),
        ),
      ),
    ]);
  }
}

// ======================================================= anneau du score
class _RingPainter extends CustomPainter {
  final double value;
  final Color color;
  final Color track;
  _RingPainter(this.value, this.color, this.track);

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = math.min(size.width, size.height) / 2 - 8;
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 10
      ..strokeCap = StrokeCap.round
      ..color = track;
    canvas.drawCircle(c, r, base);
    if (value > 0) {
      final p = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 10
        ..strokeCap = StrokeCap.round
        ..color = color;
      canvas.drawArc(Rect.fromCircle(center: c, radius: r), -math.pi / 2, 2 * math.pi * value, false, p);
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.value != value || old.color != color || old.track != track;
}

// ======================================================= mini carte
class _MiniMap extends StatefulWidget {
  final AppState app;
  const _MiniMap({required this.app});
  @override
  State<_MiniMap> createState() => _MiniMapState();
}

class _MiniMapState extends State<_MiniMap> {
  final MapController _c = MapController();
  LatLng? _last;

  @override
  void didUpdateWidget(covariant _MiniMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final p = widget.app.currentPos;
    if (p == null || p == _last) return;
    _last = p;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      try {
        _c.move(p, _c.camera.zoom);
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    final pos = app.currentPos ?? const LatLng(35.8256, 10.5908);
    return FlutterMap(
      mapController: _c,
      options: MapOptions(
        initialCenter: pos,
        initialZoom: 14.5,
        // pas de glissement : la carte ne bloque pas le défilement de la page
        interactionOptions: const InteractionOptions(flags: InteractiveFlag.pinchZoom | InteractiveFlag.doubleTapZoom),
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.example.drowsiness_app',
        ),
        if (app.route.isNotEmpty)
          PolylineLayer(polylines: [
            Polyline(points: app.route, strokeWidth: 5.0, color: kGreen.withOpacity(0.8)),
          ]),
        MarkerLayer(markers: [
          Marker(
            point: pos,
            width: 40,
            height: 40,
            child: Container(
              decoration: BoxDecoration(
                color: kGreen,
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: kGreen.withOpacity(0.4), blurRadius: 10, spreadRadius: 3)],
              ),
              child: const Icon(Icons.directions_car, color: Colors.white, size: 22),
            ),
          ),
        ]),
      ],
    );
  }
}
