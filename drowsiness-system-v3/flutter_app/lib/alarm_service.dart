import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:vibration/vibration.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

/// Son d'alarme + vibration + voix. Tout passe par le canal "ALARME" d'Android
/// (il faut donc monter le VOLUME ALARME du téléphone).
///
/// IMPORTANT: avec audioplayers, AssetSource('beep.wav') cherche déjà dans le
/// dossier assets/. Il ne faut PAS écrire 'assets/beep.wav' (sinon: aucun son).
class AlarmService {
  final AudioPlayer _siren = AudioPlayer();
  final AudioPlayer _beep = AudioPlayer();
  final FlutterTts _tts = FlutterTts();
  Timer? _vibTimer;
  bool _ready = false;
  bool sirenOn = false;

  Future<void> init() async {
    if (_ready) return;
    try {
      final ctx = AudioContext(
        android: const AudioContextAndroid(
          isSpeakerphoneOn: true,
          stayAwake: true,
          contentType: AndroidContentType.sonification,
          usageType: AndroidUsageType.alarm,
          audioFocus: AndroidAudioFocus.gain,
        ),
        iOS: AudioContextIOS(
          category: AVAudioSessionCategory.playback,
          options: const <AVAudioSessionOptions>{},
        ),
      );
      await _siren.setAudioContext(ctx);
      await _beep.setAudioContext(ctx);
      await _siren.setReleaseMode(ReleaseMode.loop);
      await _beep.setReleaseMode(ReleaseMode.stop);
      await _siren.setVolume(1.0);
      await _beep.setVolume(1.0);
    } catch (e) {
      debugPrint('Audio init: $e');
    }
    try {
      await _tts.setLanguage('fr-FR');
      await _tts.setSpeechRate(0.45);
      await _tts.setVolume(1.0);
    } catch (e) {
      debugPrint('TTS init: $e');
    }
    _ready = true;
  }

  Future<void> _vibrateLong() async {
    try {
      final has = await Vibration.hasVibrator();
      if (has != true) {
        HapticFeedback.heavyImpact();
        return;
      }
      await Vibration.vibrate(
        pattern: [0, 500, 200, 500, 200, 1000],
        intensities: [0, 255, 0, 255, 0, 255],
      );
    } catch (_) {
      HapticFeedback.heavyImpact();
    }
  }

  /// Petit bip (alarmes niveau 1 à 3 ou test).
  Future<void> playBeep() async {
    try {
      await _beep.stop();
      await _beep.play(AssetSource('beep.wav'));
    } catch (e) {
      debugPrint('Beep: $e');
      SystemSound.play(SystemSoundType.alert);
    }
    try {
      final has = await Vibration.hasVibrator();
      if (has == true) await Vibration.vibrate(duration: 400, amplitude: 255);
    } catch (_) {}
  }

  /// Sirène d'urgence en boucle + vibration répétée + écran qui reste allumé.
  Future<void> startSiren() async {
    if (sirenOn) return;
    sirenOn = true;
    try {
      WakelockPlus.enable();
    } catch (_) {}
    try {
      await _siren.stop();
      await _siren.setVolume(1.0);
      await _siren.play(AssetSource('siren.wav'));
    } catch (e) {
      debugPrint('Siren: $e');
      SystemSound.play(SystemSoundType.alert);
    }
    _vibrateLong();
    _vibTimer?.cancel();
    _vibTimer = Timer.periodic(const Duration(milliseconds: 2800), (_) => _vibrateLong());
  }

  Future<void> stopSiren() async {
    sirenOn = false;
    _vibTimer?.cancel();
    try {
      await _siren.stop();
    } catch (_) {}
    try {
      await Vibration.cancel();
    } catch (_) {}
  }

  Future<void> speak(String text) async {
    try {
      await _tts.stop();
      await _tts.speak(text);
    } catch (e) {
      debugPrint('TTS: $e');
    }
  }

  Future<void> stopSpeech() async {
    try {
      await _tts.stop();
    } catch (_) {}
  }

  Future<void> stopAll() async {
    await stopSiren();
    await stopSpeech();
    try {
      WakelockPlus.disable();
    } catch (_) {}
  }

  void keepAwake(bool on) {
    try {
      if (on) {
        WakelockPlus.enable();
      } else {
        WakelockPlus.disable();
      }
    } catch (_) {}
  }
}
