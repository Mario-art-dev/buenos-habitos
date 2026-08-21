import fs from "fs";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import {
  sourceVideoPath,
  clipVideoPath,
  clipThumbnailPath,
  clipBodyPath,
  clipCommentedPath,
  coverCardPath,
  bigCaptionsPath,
  customTextPath as customTextAssPath,
  narrationAudioPath,
} from "@/lib/storagePaths";
import { cutVerticalClip, concatClips, extractThumbnail } from "./clip";
import { buildBigCaptionsAssFromCues, buildCustomTextAss, type StoredCue, type CustomTextElement } from "./bigCaptions";
import { hookVerifiedFrameSec } from "./hookFrame";
import { probeVideo, pickVerticalResolution } from "./probe";
import { renderCoverCard } from "./coverCard";
import { renderCommentaryCard } from "./commentaryCards";

/**
 * Reconstruye el vídeo final de un clip ya generado a partir del vídeo fuente, con los subtítulos
 * y textos personalizados tal y como estén guardados en ese momento en la base de datos (tras
 * editar/borrar cues o añadir texto desde el editor de la página `/clips/[id]/edit`). No repite el
 * análisis de IA ni la comprobación de gancho (hookFrame.ts) — reutiliza `effectiveStartSec`, ya
 * calculado la primera vez que se generó el clip, para no gastar otra llamada de IA de visión.
 *
 * Solo actualiza la base de datos si el render termina bien: si algo falla, el vídeo/estado
 * anteriores se quedan tal cual (igual que el resto de acciones del editor, ver /api/clips/[id]/music).
 */
export async function regenerateClip(clipId: string): Promise<void> {
  const clip = await db.clip.findUniqueOrThrow({ where: { id: clipId }, include: { job: true } });
  const jobId = clip.jobId;
  const srcPath = clip.job.sourceFilePath ?? sourceVideoPath(jobId);
  if (!fs.existsSync(srcPath)) {
    throw new Error(
      "El vídeo fuente ya no está disponible en el servidor (puede haberse reiniciado la sesión). No se puede regenerar este clip."
    );
  }

  const startSec = clip.effectiveStartSec ?? clip.startSec;
  const endSec = clip.endSec;

  const sourceInfo = await probeVideo(srcPath);
  const resolution = pickVerticalResolution(sourceInfo);

  const cues: StoredCue[] = JSON.parse(clip.captionCues || "[]");
  const customTexts: CustomTextElement[] = JSON.parse(clip.customTexts || "[]");

  const bodyPath = clipBodyPath(jobId, clip.id);
  const commentedPath = clipCommentedPath(jobId, clip.id);
  const coverPath = coverCardPath(jobId, clip.id);
  const bigCaptionsFilePath = bigCaptionsPath(jobId, clip.id);
  const customTextFilePath = customTextAssPath(jobId, clip.id);
  const introNarrationPath = narrationAudioPath(jobId, clip.id, "intro");
  const outroNarrationPath = narrationAudioPath(jobId, clip.id, "outro");
  const outPath = clipVideoPath(jobId, clip.id);
  const thumbPath = clipThumbnailPath(jobId, clip.id);

  try {
    let bigCaptionsFile: string | undefined;
    if (config.bigCaptions.enabled && clip.captionsEnabled && cues.length > 0) {
      const ass = buildBigCaptionsAssFromCues(cues, resolution);
      if (ass) {
        fs.writeFileSync(bigCaptionsFilePath, ass, "utf-8");
        bigCaptionsFile = bigCaptionsFilePath;
      }
    }

    let customTextFile: string | undefined;
    if (customTexts.length > 0) {
      const ass = buildCustomTextAss(customTexts, resolution);
      if (ass) {
        fs.writeFileSync(customTextFilePath, ass, "utf-8");
        customTextFile = customTextFilePath;
      }
    }

    // Modo SINGLE/SPLIT ("vídeos virales" y "cortes"): sin zoom dinámico, por la misma petición
    // explícita que ya aplica en la generación inicial (ver runPipeline.ts/splitPipeline.ts) — se
    // mantiene igual al regenerar.
    const noZoomModes = clip.job.mode === "SINGLE" || clip.job.mode === "SPLIT";
    const dynamicZoom = noZoomModes ? false : config.dynamicZoom.enabled;

    await cutVerticalClip({
      sourcePath: srcPath,
      outPath: bodyPath,
      startSec,
      endSec,
      resolution,
      bigCaptionsPath: bigCaptionsFile,
      customTextPath: customTextFile,
      dynamicZoom,
    });

    let core = bodyPath;

    // Si el clip original llevaba comentario narrado, se conserva igual al regenerar (mismo texto
    // ya guardado) — no se vuelve a generar el guion, solo se sintetiza la voz otra vez porque el
    // audio original no se conserva entre renders.
    if (clip.commentaryIntro && clip.commentaryOutro) {
      const introCard = await renderCommentaryCard({
        jobId,
        clipId: clip.id,
        key: "intro",
        text: clip.commentaryIntro,
        resolution,
      });
      const outroCard = await renderCommentaryCard({
        jobId,
        clipId: clip.id,
        key: "outro",
        text: clip.commentaryOutro,
        resolution,
      });
      await concatClips([introCard, bodyPath, outroCard], commentedPath);
      core = commentedPath;
      fs.rmSync(introCard, { force: true });
      fs.rmSync(outroCard, { force: true });
    }

    // La portada (coverCard.ts) solo la usan los modos SINGLE/SPLIT — RANKING tiene su propia
    // tarjeta de ranking (rankingIntroCard.ts) y PRODUCT/SONG nunca la usaron; envolverla aquí
    // para esos modos añadiría una portada que el clip original nunca tuvo.
    if (config.coverCard.enabled && noZoomModes) {
      await renderCoverCard({
        sourcePath: srcPath,
        frameAtSec: clip.coverFrameSec ?? hookVerifiedFrameSec(startSec, endSec),
        title: clip.coverTitle ?? clip.title,
        outPath: coverPath,
        resolution,
        customImagePath: clip.coverImagePath,
      });
      await concatClips([core, coverPath], outPath);
    } else if (core !== outPath) {
      fs.copyFileSync(core, outPath);
    }

    await extractThumbnail(outPath, thumbPath);

    await db.clip.update({
      where: { id: clip.id },
      data: { filePath: outPath, thumbnailPath: thumbPath, status: "READY", error: null },
    });
  } finally {
    for (const tmp of [
      bodyPath,
      commentedPath,
      coverPath,
      bigCaptionsFilePath,
      customTextFilePath,
      introNarrationPath,
      outroNarrationPath,
    ]) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // ignorar
      }
    }
  }
}
