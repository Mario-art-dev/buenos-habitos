#!/usr/bin/env python3
"""Detecta el tempo (BPM) y los tiempos de los golpes de percusión (beats) de un audio.

Se usa en el modo Canción para sincronizar los cortes de vídeo con el ritmo de la canción
elegida por el usuario. Usa librosa (gratis, corre en el propio servidor).

Uso: python3 beat_detect.py <ruta_audio> <ruta_salida.json>
Salida JSON: {"bpm": 128.0, "beatTimes": [0.42, 0.89, ...]}
"""

import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("Uso: beat_detect.py <ruta_audio> <ruta_salida.json>", file=sys.stderr)
        return 2

    audio_path = sys.argv[1]
    out_path = sys.argv[2]

    try:
        import librosa
    except ImportError:
        print(
            "Falta librosa. Instálalo con:\n  pip3 install librosa\n(en Docker ya viene instalado)",
            file=sys.stderr,
        )
        return 3

    y, sr = librosa.load(audio_path, sr=None, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)

    bpm = float(tempo[0]) if hasattr(tempo, "__len__") else float(tempo)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"bpm": bpm, "beatTimes": [round(float(t), 3) for t in beat_times]}, f)

    return 0


if __name__ == "__main__":
    sys.exit(main())
