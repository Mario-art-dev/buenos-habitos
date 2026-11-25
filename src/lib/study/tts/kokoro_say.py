# Convierte el texto (stdin) en WAV con Kokoro-82M (voz inglesa gratuita, Apache 2.0, corre en CPU).
# Uso: python3 -I kokoro_say.py <modelo.onnx> <voces.bin> <voz> <velocidad> <salida.wav>
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

model, voices, voice, speed, out = sys.argv[1:6]
text = sys.stdin.read().strip()
kokoro = Kokoro(model, voices)
samples, rate = kokoro.create(text, voice=voice, speed=float(speed), lang="en-us")
sf.write(out, samples, rate)
