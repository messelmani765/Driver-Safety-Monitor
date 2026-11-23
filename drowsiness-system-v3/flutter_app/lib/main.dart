import 'package:flutter/material.dart';

import 'alert_screen.dart';
import 'app_state.dart';
import 'home_page.dart';
import 'pages.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final app = AppState();
  runApp(DriverApp(app: app));
  app.init();
}

ThemeData _theme(Brightness b) => ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: kGreen, brightness: b),
      appBarTheme: const AppBarTheme(backgroundColor: kNavy, foregroundColor: Colors.white),
    );

class DriverApp extends StatelessWidget {
  final AppState app;
  const DriverApp({super.key, required this.app});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: app,
      builder: (context, _) => MaterialApp(
        title: 'Driver Safety Monitor',
        debugShowCheckedModeBanner: false,
        themeMode: app.dark ? ThemeMode.dark : ThemeMode.light,
        theme: _theme(Brightness.light),
        darkTheme: _theme(Brightness.dark),
        home: Shell(app: app),
      ),
    );
  }
}

class Shell extends StatefulWidget {
  final AppState app;
  const Shell({super.key, required this.app});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _i = 0;
  static const _titles = ['Accueil', 'Mon Trajet', 'Mes Alarmes', 'Mes Détections', 'Mon Profil'];

  void _settings() {
    final app = widget.app;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: ListenableBuilder(
          listenable: app,
          builder: (_, __) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Réglages & Statut', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Text('Connecté en tant que : ${app.driverName} (${app.plate})', style: const TextStyle(fontWeight: FontWeight.bold)),
            Text('Serveur : ${app.host}', style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 12),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Son & Sirène activés'), value: !app.muted, onChanged: (v) => app.setMuted(!v)),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Mode sombre'), value: app.dark, onChanged: app.setDark),
            Wrap(spacing: 8, children: [
              OutlinedButton.icon(onPressed: () => app.alarm.playBeep(), icon: const Icon(Icons.volume_up), label: const Text('Tester le bip')),
              OutlinedButton.icon(
                onPressed: () async {
                  await app.alarm.startSiren();
                  await Future.delayed(const Duration(seconds: 3));
                  await app.alarm.stopSiren();
                },
                icon: const Icon(Icons.campaign),
                label: const Text('Tester la sirène (3 s)'),
              ),
            ]),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                onPressed: () {
                  Navigator.pop(ctx);
                  app.logout();
                },
                icon: const Icon(Icons.logout),
                label: const Text('Se déconnecter'),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = widget.app;
    if (app.token == null || app.user == null) {
      return ConnectPage(app: app);
    }
    final pages = <Widget>[
      HomePage(app: app, onGoto: (i) => setState(() => _i = i)),
      TripPage(app: app),
      AlertsPage(app: app),
      DetectionsPage(app: app),
      ProfilePage(app: app),
    ];
    return Stack(children: [
      Scaffold(
        appBar: AppBar(
          title: Text(_titles[_i]),
          actions: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: Icon(Icons.circle, size: 14, color: app.connected ? kGreen : const Color(0xFFEF4444)),
            ),
            IconButton(onPressed: () => app.setDark(!app.dark), icon: Icon(app.dark ? Icons.light_mode : Icons.dark_mode)),
            IconButton(onPressed: _settings, icon: const Icon(Icons.settings)),
          ],
        ),
        body: LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= 700;
            if (!wide) return IndexedStack(index: _i, children: pages);
            return Row(children: [
              Container(
                width: 92,
                margin: const EdgeInsets.fromLTRB(10, 10, 0, 10),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: Theme.of(context).dividerColor.withOpacity(.35)),
                ),
                child: NavigationRail(
                  backgroundColor: Colors.transparent,
                  selectedIndex: _i,
                  onDestinationSelected: (v) => setState(() => _i = v),
                  labelType: NavigationRailLabelType.all,
                  destinations: const [
                    NavigationRailDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: Text('Accueil')),
                    NavigationRailDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: Text('Trajet')),
                    NavigationRailDestination(icon: Icon(Icons.notifications_outlined), selectedIcon: Icon(Icons.notifications), label: Text('Alarmes')),
                    NavigationRailDestination(icon: Icon(Icons.photo_library_outlined), selectedIcon: Icon(Icons.photo_library), label: Text('Détections')),
                    NavigationRailDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: Text('Profil')),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Expanded(child: IndexedStack(index: _i, children: pages)),
            ]);
          },
        ),
        bottomNavigationBar: MediaQuery.sizeOf(context).width < 700
            ? NavigationBar(
                selectedIndex: _i,
                onDestinationSelected: (v) => setState(() => _i = v),
                destinations: const [
                  NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Accueil'),
                  NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Trajet'),
                  NavigationDestination(icon: Icon(Icons.notifications_outlined), selectedIcon: Icon(Icons.notifications), label: 'Alarmes'),
                  NavigationDestination(icon: Icon(Icons.photo_library_outlined), selectedIcon: Icon(Icons.photo_library), label: 'Détections'),
                  NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profil'),
                ],
              )
            : null,
      ),
      AlertOverlay(app: app),
      CallOverlay(app: app),
    ]);
  }
}
