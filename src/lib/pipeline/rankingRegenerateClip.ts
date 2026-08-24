import fs from "fs";
import { db } from "@/lib/db";
import { sourceVideoPath, customTextPath as customTextAssPath } from "@/lib/storagePaths";
import { probeVideo, pickVerticalResolution } from "./probe";
import { assembleRankingVideo, finalizeWithoutMusic, type RenderRankingItem } from "./rankingRender";
import type { RankingOverlayTemplate } from "./rankingListOverlay";
import { applyCustomTextOverlay } from "./clip";
import { buildCustomTextAss, type CustomTextElement } from "./bigCaptions";
import { applyMusicToClip } from "./musicApply";
import type { TranscriptSegment } from "./transcribe";

/**
 * Reconstruye un clip de RANKING: vuelve a montar el vídeo entero (tarjeta de intro + cada puesto
 * con su clip y subtítulos + tarjeta de cierre) a partir de los rankingItems ya guardados (no hace
 * falta repetir la detección de momentos ni la clasificación por IA), respetando los ajustes
 * editados desde el editor: subtítulos activados/desactivados, portada propia de la tarjeta de
 * intro, y texto personalizado añadido a mano (quemado como pasada final sobre el vídeo entero).
 * Si el clip ya tenía música aplicada, se vuelve a mezclar sobre el resultado nuevo para no perderla.
 */
export async function regenerateRankingClip(clipId: string): Promise<void> {
  const clip = await db.clip.findUniqueOrThrow({
    where: { id: clipId },
    include: { job: true, rankingItems: { orderBy: { position: "desc" } } },
  });
  const jobId = clip.jobId;
  const srcPath = clip.job.sourceFilePath ?? sourceVideoPath(jobId);
  if (!fs.existsSync(srcPath)) {
    throw new Error(
      "El vídeo fuente ya no está disponible en el servidor (puede haberse reiniciado la sesión). No se puede regenerar este clip."
    );
  }
  if (!clip.job.transcriptSegments) {
    throw new Error(
      "Este ranking se generó antes de guardar la transcripción — no se puede regenerar (haz uno nuevo para poder editarlo)."
    );
  }
  if (clip.rankingItems.length === 0) {
    throw new Error("Este clip no tiene puestos guardados, no se puede regenerar.");
  }

  const transcriptSegments: TranscriptSegment[] = JSON.parse(clip.job.transcriptSegments);
  const sourceInfo = await probeVideo(srcPath);
  const resolution = pickVerticalResolution(sourceInfo);

  const items: RenderRankingItem[] = clip.rankingItems.map((i) => ({
    position: i.position,
    startSec: i.startSec,
    endSec: i.endSec,
    label: i.label,
    commentary: i.commentary,
  }));

  const customTexts: CustomTextElement[] = JSON.parse(clip.customTexts || "[]");
  const customTextFilePath = customTextAssPath(jobId, clip.id);

  try {
    const assembledPath = await assembleRankingVideo({
      jobId,
      clipId: clip.id,
      sourcePath: srcPath,
      category: clip.category ?? "Momentos",
      title: clip.title,
      coverImagePath: clip.coverImagePath,
      overallIntroCommentary: clip.commentaryIntro,
      overallOutroCommentary: clip.commentaryOutro,
      items,
      transcriptSegments,
      resolution,
      captionsEnabled: clip.captionsEnabled,
      templateType: (clip.introTemplate as RankingOverlayTemplate) ?? "TOPIC",
    });

    // Texto personalizado: pasada final sobre el vídeo YA montado (no tiene sentido reintegrarlo
    // dentro del montaje por tramos — así funciona igual sea cual sea la composición interna).
    const ass = customTexts.length > 0 ? buildCustomTextAss(customTexts, resolution) : null;
    if (ass) {
      fs.writeFileSync(customTextFilePath, ass, "utf-8");
      const withTextPath = `${assembledPath}.withtext.mp4`;
      await applyCustomTextOverlay(assembledPath, withTextPath, customTextFilePath);
      fs.renameSync(withTextPath, assembledPath);
    }

    // Si el clip ya tenía música aplicada, se remezcla sobre el resultado nuevo (clipAssembledPath
    // ya es la base limpia que espera musicApply.ts); si no, se copia tal cual como final.
    if (clip.musicEnabled && clip.musicSourceUrl) {
      await applyMusicToClip(clip.id, { musicSourceUrl: clip.musicSourceUrl, musicStartSec: clip.musicStartSec ?? 0 });
    } else {
      const { filePath, thumbnailPath } = await finalizeWithoutMusic(jobId, clip.id);
      await db.clip.update({ where: { id: clip.id }, data: { filePath, thumbnailPath, status: "READY", error: null } });
    }
  } finally {
    fs.rmSync(customTextFilePath, { force: true });
  }
}
