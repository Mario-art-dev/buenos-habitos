"use client";

import { AbsoluteFill, Video, Sequence } from "remotion";

export interface CompositionCustomText {
  id: string;
  text: string;
  start: number;
  end: number;
  xPct: number;
  yPct: number;
  fontName: string;
  fontSize: number;
  colorHex: string;
  uppercase?: boolean;
}

export interface EditorCompositionProps {
  sourceVideoUrl: string;
  trimBeforeFrames: number;
  trimAfterFrames: number;
  fps: number;
  texts: CompositionCustomText[];
  [key: string]: unknown;
}

/**
 * Composición de Remotion usada SOLO para la vista previa en vivo del editor (el render final
 * sigue siendo con ffmpeg en el servidor — ver regenerateClip.ts). Recorta directamente el vídeo
 * FUENTE original (sin verticalizar) al tramo [effectiveStartSec, endSec] con `trimBefore`/
 * `trimAfter` (Remotion, no confundir con los `startFrom`/`endAt` obsoletos), y usa
 * `object-fit: cover` para aproximar en CSS el mismo recorte centrado que hace `cutVerticalClip`
 * en el servidor (scale+crop centrado) — así el texto se coloca donde realmente va a acabar en el
 * vídeo final, no sobre el encuadre original sin recortar.
 */
export function EditorComposition({
  sourceVideoUrl,
  trimBeforeFrames,
  trimAfterFrames,
  texts,
  fps,
}: EditorCompositionProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Video
        src={sourceVideoUrl}
        trimBefore={trimBeforeFrames}
        trimAfter={trimAfterFrames}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {texts.map((t) => {
        const from = Math.max(0, Math.round(t.start * fps));
        const durationInFrames = Math.max(1, Math.round((t.end - t.start) * fps));
        return (
          <Sequence key={t.id} from={from} durationInFrames={durationInFrames} layout="none">
            <div
              data-text-id={t.id}
              style={{
                position: "absolute",
                left: `${t.xPct}%`,
                top: `${t.yPct}%`,
                transform: "translate(-50%, -50%)",
                whiteSpace: "nowrap",
                fontFamily: `"${t.fontName}", sans-serif`,
                color: `#${t.colorHex}`,
                fontSize: t.fontSize,
                fontWeight: "bold",
                WebkitTextStroke: `${Math.max(1, Math.round(t.fontSize / 12))}px black`,
                textTransform: t.uppercase ? "uppercase" : "none",
              }}
            >
              {t.text}
            </div>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
