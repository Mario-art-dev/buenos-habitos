#!/usr/bin/env python3
"""Transcribe un archivo de audio en el propio servidor, sin coste de API.

Usa faster-whisper (implementación optimizada de Whisper que corre bien en CPU).
Imprime por stdout un JSON con los segmentos y sus marcas de tiempo, que es lo
que espera src/lib/pipeline/transcribe.ts.

Uso: python3 local_whisper.py <ruta_audio> <modelo>
  modelo: tiny | base | small | medium | large-v3
          (cuanto más grande, mejor transcribe y más tarda)
"""

import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: local_whisper.py <ruta_audio> [modelo]", file=sys.stderr)
        return 2

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "Falta faster-whisper. Instálalo con:\n"
            "  pip3 install faster-whisper\n"
            "(en Docker ya viene instalado)",
            file=sys.stderr,
        )
        return 3

    # int8 en CPU: bastante más rápido y con menos memoria, calidad casi idéntica.
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    # word_timestamps=True: da la marca de tiempo de cada palabra suelta, no solo de la frase
    # entera — lo necesita src/lib/pipeline/bigCaptions.ts para resaltar palabra por palabra
    # en vez de bloques de frase completa.
    segments, info = model.transcribe(audio_path, vad_filter=True, word_timestamps=True)

    result_segments = []
    for s in segments:
        if not s.text or not s.text.strip():
            continue
        words = [
            {"start": float(w.start), "end": float(w.end), "text": w.word.strip()}
            for w in (s.words or [])
            if w.word and w.word.strip()
        ]
        result_segments.append(
            {"start": float(s.start), "end": float(s.end), "text": s.text.strip(), "words": words}
        )

    # info.language: código ISO 639-1 (p.ej. "en", "es") detectado por faster-whisper — lo usa
    # src/lib/lang.ts para generar título/descripción/subtítulos en el idioma REAL del vídeo en
    # vez del idioma fijo configurado del canal.
    output = {"segments": result_segments, "language": info.language if info else None}
    json.dump(output, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
