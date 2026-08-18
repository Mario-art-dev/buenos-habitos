import fs from "fs";
import { config } from "@/lib/config";
import { getAIProvider } from "@/lib/ai/provider";
import { extractFrameAt } from "./clip";

const CHECK_OFFSET_SEC = 0.4; // evita el fotograma justo en el corte (a veces negro/borroso)
const NUDGE_SEC = 1.2;

/**
 * Un short engancha mucho más si desde el segundo 0 se ve a una persona en pantalla (cara,
 * presencia) que si arranca con un plano vacío, de transición o de espaldas — es lo primero que
 * mira el ojo. Aquí se comprueba con un único fotograma y una única llamada al modelo de visión
 * (para no disparar el gasto de tokens en vídeos con muchos clips, sobre todo con el cupo diario
 * gratuito ya ajustado para vídeos de 1 hora); si no se ve a nadie, se adelanta el inicio un poco
 * como mejor intento SIN otra llamada de IA (ajuste local, gratis). Cualquier fallo (límite de
 * IA alcanzado, fotograma no extraíble, respuesta inesperada) se ignora en silencio y se usa el
 * startSec original tal cual — esta comprobación nunca debe bloquear ni tirar un clip.
 */
export async function pickHookStartSec(params: {
  sourcePath: string;
  startSec: number;
  endSec: number;
  framePath: string;
}): Promise<number> {
  const { sourcePath, startSec, endSec, framePath } = params;
  if (!config.hookFrameCheck.enabled) return startSec;

  try {
    const checkAt = Math.min(startSec + CHECK_OFFSET_SEC, Math.max(startSec, endSec - 0.2));
    await extractFrameAt(sourcePath, checkAt, framePath);

    const provider = getAIProvider();
    const raw = await provider.chatJson({
      system: "Respondes EXCLUSIVAMENTE con JSON válido, sin texto adicional, sin markdown.",
      prompt:
        "¿Se ve con claridad una persona (cara o cuerpo reconocible, en primer plano o protagonizando " +
        "la escena — no de fondo, muy lejana o totalmente de espaldas) en esta imagen? " +
        'Responde SOLO: {"personVisible": true} o {"personVisible": false}',
      images: [{ base64: fs.readFileSync(framePath).toString("base64"), mediaType: "image/jpeg" }],
      maxTokens: 300,
    });

    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as { personVisible?: boolean };
    if (parsed.personVisible !== false) return startSec;

    const nudged = startSec + NUDGE_SEC;
    return nudged + config.pipeline.clipMinSeconds <= endSec ? nudged : startSec;
  } catch {
    return startSec;
  } finally {
    fs.rmSync(framePath, { force: true });
  }
}
