import fs from "fs";
import { config } from "@/lib/config";
import { run } from "./exec";
import type { VerticalResolution } from "./probe";

// Mismo amarillo de marca que rankingIntroCard.ts/coverCard.ts.
const YELLOW_BGR = "&H00D4FF&";
const FONT_NAME = "Anton";

function assTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "").replace(/[{}]/g, "").trim();
}

function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

export interface RankingListItem {
  position: number; // 1 = mejor, se muestra ARRIBA de la lista
  label: string;
  // Segundo del vídeo YA MONTADO en el que empieza el clip de este puesto — a partir de ahí se
  // revela la etiqueta junto al número; antes solo se ve el número suelto.
  revealAtSec: number;
}

function buildRankingListAss(items: RankingListItem[], totalDurationSec: number, resolution: VerticalResolution): string {
  const { width, height } = resolution;
  const n = items.length;
  const listTop = height * 0.3;
  const listBottom = height * 0.88;
  const rowHeight = (listBottom - listTop) / Math.max(1, n);
  const fontSize = Math.max(20, Math.round(rowHeight * 0.5));
  const boxPadding = Math.max(4, Math.round(fontSize * 0.22));
  const x = Math.round(width * 0.06);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: RankList,${FONT_NAME},${fontSize},&H00FFFFFF,&H000000FF,&H70000000,&H70000000,1,0,0,0,100,100,0,0,3,${boxPadding},0,4,${x},${x},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [];
  const sorted = [...items].sort((a, b) => a.position - b.position);
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const y = Math.round(listTop + i * rowHeight + rowHeight / 2);
    const bareText = `${item.position}.`;
    const revealedText = `${item.position}. {\\c${YELLOW_BGR}}${escapeAssText(item.label)}`;
    const revealAt = Math.max(0, Math.min(item.revealAtSec, totalDurationSec));

    if (revealAt > 0.05) {
      lines.push(
        `Dialogue: 0,${assTime(0)},${assTime(revealAt)},RankList,,0,0,0,,{\\an4\\pos(${x},${y})}${bareText}`
      );
    }
    lines.push(
      `Dialogue: 0,${assTime(revealAt)},${assTime(totalDurationSec)},RankList,,0,0,0,,{\\an4\\pos(${x},${y})}${revealedText}`
    );
  }

  return header + lines.join("\n") + "\n";
}

/**
 * Quema la lista numerada del ranking (1., 2., 3.… — con el estilo/fuente de la captura de
 * referencia) como capa PERSISTENTE encima del vídeo YA montado entero (intro + todos los
 * clips), pedido explícito: "que salga en pantalla todo el rato durante todo el vídeo". Cada
 * puesto se ve solo como número suelto hasta el segundo exacto en que empieza su propio clip,
 * momento en el que se revela su etiqueta (en amarillo de marca) y se queda así el resto del
 * vídeo — así el espectador ve de un vistazo qué puestos ya se han visto y cuáles faltan, igual
 * que en la cuenta atrás de la referencia real. Caja semitransparente detrás de cada línea
 * (BorderStyle 3) para que se lea bien encima de cualquier fotograma del clip.
 */
export async function burnRankingList(
  inputPath: string,
  outputPath: string,
  items: RankingListItem[],
  totalDurationSec: number,
  resolution: VerticalResolution
): Promise<void> {
  if (items.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  const assPath = `${outputPath}.ass`;
  fs.writeFileSync(assPath, buildRankingListAss(items, totalDurationSec, resolution), "utf-8");

  try {
    await run(config.ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `subtitles=${escapeSubtitlesPath(assPath)}`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    fs.rmSync(assPath, { force: true });
  }
}
