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
    segments, _info = model.transcribe(audio_path, vad_filter=True)

    result = [
        {"start": float(s.start), "end": float(s.end), "text": s.text.strip()}
        for s in segments
        if s.text and s.text.strip()
    ]

    json.dump(result, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
