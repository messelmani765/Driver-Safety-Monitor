from __future__ import annotations
import math
import struct
import wave
from pathlib import Path

def generate_wav(filepath: Path, duration_s: float, freq_func, sample_rate: int = 44100):
    n_samples = int(duration_s * sample_rate)
    with wave.open(str(filepath), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        data = bytearray()
        for i in range(n_samples):
            t = i / sample_rate
            f = freq_func(t)
            val = int(32767.0 * 0.8 * math.sin(2.0 * math.pi * f * t))
            data.extend(struct.pack('<h', max(-32767, min(32767, val))))
        wav.writeframes(data)

def beep_f(t):
    return 880.0

def siren_f(t):
    return 700.0 if (int(t * 4) % 2 == 0) else 1100.0

ws_assets = Path(__file__).resolve().parent / "flutter_app" / "assets"
dev_assets = Path("C:/dev/drowsiness_app/assets")

for folder in [ws_assets, dev_assets]:
    folder.mkdir(parents=True, exist_ok=True)
    generate_wav(folder / "beep.wav", 0.4, beep_f)
    generate_wav(folder / "siren.wav", 1.6, siren_f)
    print(f"Generated wavs in {folder}")
