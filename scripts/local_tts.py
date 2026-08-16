#!/usr/bin/env python3
"""Convierte texto a voz en el propio servidor, sin coste de API.

Usa Piper (motor de voz neuronal rápido y gratuito). La primera vez que se usa
una voz, la descarga automáticamente (~60 MB) desde el repositorio oficial de
voces de Piper en Hugging Face y la deja cacheada en storage/voices/.

Uso: python3 local_tts.py <ruta_texto.txt> <ruta_salida.wav> [voz]
  voz: nombre de voz de Piper, ej. "es_ES-davefx-medium" (ver
       https://github.com/OHF-voice/piper1-gpl para el catálogo completo)
"""

import sys
import wave
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print("Uso: local_tts.py <ruta_texto.txt> <ruta_salida.wav> [voz]", file=sys.stderr)
        return 2

    text_path = sys.argv[1]
    out_path = sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else "es_ES-davefx-medium"

    try:
        from piper import PiperVoice
        from piper.download_voices import download_voice
    except ImportError:
        print(
            "Falta piper-tts. Instálalo con:\n"
            "  pip3 install piper-tts\n"
            "(en Docker ya viene instalado)",
            file=sys.stderr,
        )
        return 3

    voices_dir = Path(__file__).resolve().parent.parent / "storage" / "voices"
    voices_dir.mkdir(parents=True, exist_ok=True)

    model_path = voices_dir / f"{voice}.onnx"
    if not model_path.exists():
        print(f"Descargando la voz '{voice}' (solo la primera vez)...", file=sys.stderr)
        download_voice(voice, voices_dir)

    with open(text_path, "r", encoding="utf-8") as f:
        text = f.read().strip()

    if not text:
        print("El texto a narrar está vacío.", file=sys.stderr)
        return 4

    piper_voice = PiperVoice.load(str(model_path))
    with wave.open(out_path, "wb") as wav_file:
        piper_voice.synthesize_wav(text, wav_file)

    return 0


if __name__ == "__main__":
    sys.exit(main())
