# Convierte el texto (stdin) en un WAV con la voz Piper (gratis, corre en el propio servidor).
# Uso: python3 -I piper_say.py <modelo.onnx> <salida.wav>
import sys
import wave

from piper import PiperVoice

model, out = sys.argv[1], sys.argv[2]
text = sys.stdin.read().strip()
voice = PiperVoice.load(model)
with wave.open(out, "wb") as wav:
    if hasattr(voice, "synthesize_wav"):
        voice.synthesize_wav(text, wav)
    else:
        voice.synthesize(text, wav)
