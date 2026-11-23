import 'package:flutter/material.dart';

import 'app_state.dart';

String _fmtTime(dynamic ts) {
  if (ts is! num) return '—';
  final d = DateTime.fromMillisecondsSinceEpoch(ts.toInt());
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.hour)}:${two(d.minute)}:${two(d.second)}';
}

/// Écran rouge plein écran: CONDUCTEUR ENDORMI (image, matricule, compte à rebours).
class AlertOverlay extends StatelessWidget {
  final AppState app;
  const AlertOverlay({super.key, required this.app});

  @override
  Widget build(BuildContext context) {
    final a = app.alert;
    if (a == null) return const SizedBox.shrink();
    final code = '${a['vehicle_id']}';
    final imageUrl = a['image_url'];
    final isImpact = a['kind'] == 'impact';
    final lat = a['lat'] is num ? (a['lat'] as num).toStringAsFixed(4) : '—';
    final lon = a['lon'] is num ? (a['lon'] as num).toStringAsFixed(4) : '—';
    final countdown = app.ackLeft > 0
        ? 'Appel de police (simulé) dans ${app.ackLeft} s…'
        : 'Appel de police en cours (simulation)…';

    Widget info(String k, String v) => Container(
          width: 150,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(12)),
          child: Column(children: [
            Text(k, style: const TextStyle(color: Colors.white70, fontSize: 12)),
            const SizedBox(height: 2),
            Text(v, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ]),
        );

    return Positioned.fill(
      child: Material(
        color: const Color(0xFF7F1D1D),
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(children: [
              const Icon(Icons.warning_amber_rounded, color: Colors.white, size: 54),
              Text(isImpact ? 'IMPACT' : 'CONDUCTEUR ENDORMI',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w900, letterSpacing: 1)),
              const SizedBox(height: 4),
              Text('${a['message'] ?? ''}', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 12),
              if (imageUrl != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    color: Colors.black,
                    constraints: const BoxConstraints(maxHeight: 280),
                    child: Image.network(
                      '${app.base}$imageUrl',
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const Padding(
                        padding: EdgeInsets.all(40),
                        child: Icon(Icons.broken_image, color: Colors.white54, size: 48),
                      ),
                    ),
                  ),
                )
              else
                Container(
                  height: 120,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(14)),
                  child: const Text('Image en cours d\'envoi…', style: TextStyle(color: Colors.white70)),
                ),
              const SizedBox(height: 12),
              Wrap(spacing: 10, runSpacing: 10, alignment: WrapAlignment.center, children: [
                info('Matricule', '${a['plate'] ?? app.plateOf(code)}'),
                info('Conducteur', '${a['driver'] ?? app.driverOf(code)}'),
                info('Heure', _fmtTime(a['ts'])),
                info('Position', '$lat, $lon'),
              ]),
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.black38, borderRadius: BorderRadius.circular(12)),
                child: Text(countdown,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              ),
              if (app.queue.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('+${app.queue.length} autre(s) alerte(s) en attente',
                      style: const TextStyle(color: Color(0xFFFECACA), fontWeight: FontWeight.w600)),
                ),
              const SizedBox(height: 14),
              Wrap(spacing: 10, runSpacing: 10, alignment: WrapAlignment.center, children: [
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: const Color(0xFF7F1D1D), padding: const EdgeInsets.all(16)),
                  onPressed: app.stopSirenOnly,
                  icon: const Icon(Icons.volume_off),
                  label: const Text('Arrêter l\'alarme'),
                ),
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFF10B981), padding: const EdgeInsets.all(16)),
                  onPressed: app.acknowledge,
                  icon: const Icon(Icons.pan_tool),
                  label: const Text('Je suis réveillé'),
                ),
              ]),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Appel de police SIMULÉ: numéro fictif, chronomètre, voix. AUCUN vrai appel.
class CallOverlay extends StatelessWidget {
  final AppState app;
  const CallOverlay({super.key, required this.app});

  @override
  Widget build(BuildContext context) {
    final c = app.call;
    if (c == null) return const SizedBox.shrink();
    final s = app.callSeconds;
    final timer = '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
    return Positioned.fill(
      child: Material(
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF0B1220), Color(0xFF1E293B)]),
          ),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(color: const Color(0xFFF59E0B), borderRadius: BorderRadius.circular(10)),
                  child: const Text('SIMULATION — aucun appel réel', style: TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF1F2937))),
                ),
                const SizedBox(height: 28),
                const CircleAvatar(radius: 54, backgroundColor: Color(0xFFDC2626), child: Icon(Icons.phone_in_talk, color: Colors.white, size: 52)),
                const SizedBox(height: 18),
                const Text('Protection civile (simulé)', style: TextStyle(color: Colors.white70, fontSize: 16)),
                const SizedBox(height: 6),
                Text('${c['number']}', style: const TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.bold, letterSpacing: 1)),
                const SizedBox(height: 6),
                Text(timer, style: const TextStyle(color: Colors.white70, fontSize: 22)),
                const SizedBox(height: 18),
                Text('« ${c['message']} »', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70, fontStyle: FontStyle.italic)),
                const SizedBox(height: 30),
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626), padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 16)),
                  onPressed: app.endCall,
                  icon: const Icon(Icons.call_end),
                  label: const Text('Raccrocher'),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
