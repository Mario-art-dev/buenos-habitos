import fs from "fs";
import { db } from "@/lib/db";
import {
  sourceVideoPath,
  bottomVideoPath,
  clipVideoPath,
  clipThumbnailPath,
  bigCaptionsPath,
  customTextPath as customTextAssPath,
} from "@/lib/storagePaths";
import { cutSplitScreenClip, applyCustomTextOverlay, burnCustomTitleBar, doubleTopHalfHeight, extractThumbnail } from "./clip";
import { buildCustomTextAss, buildBigCaptionsAssFromCues, defaultSplitDoubleCaptionsStyle, type CustomTextElement, type StoredCue } from "./bigCaptions";
import { probeVideo, pickVerticalResolution } from "./probe";

/**
 * Reconstruye un clip de DOUBLE (pantalla dividida): vuelve a componer la parte a partir de los
 * DOS vídeos fuente (arriba/abajo), respetando el recorte guardado del vídeo de arriba
 * (effectiveStartSec/endSec, editable desde el editor) y el punto de arranque guardado del vídeo
 * de abajo (doubleBottomStartSec, fijado al generar por primera vez, para no romper la
 * continuidad del vídeo de fondo entre partes). Los subtítulos automáticos (captionCues, editables
 * desde el editor como en SPLIT/SINGLE/RANKING) y el título propio (customTitle) se queman como
 * pasadas aparte, igual que el texto personalizado añadido a mano.
 */
export async function regenerateDoubleClip(clipId: string): Promise<void> {
  const clip = await db.clip.findUniqueOrThrow({ where: { id: clipId }, include: { job: true } });
  const jobId = clip.jobId;
  const topPath = clip.job.sourceFilePath ?? sourceVideoPath(jobId);
  const bottomPath = clip.job.bottomVideoFilePath ?? bottomVideoPath(jobId);
  if (!fs.existsSync(topPath) || !fs.existsSync(bottomPath)) {
    throw new Error(
      "Los vídeos fuente ya no están disponibles en el servidor (puede haberse reiniciado la sesión). No se puede regenerar este clip."
    );
  }

  const topStartSec = clip.effectiveStartSec ?? clip.startSec;
  const topEndSec = clip.endSec;
  const bottomStartSec = clip.doubleBottomStartSec ?? 0;

  const sourceInfo = await probeVideo(topPath);
  const resolution = pickVerticalResolution(sourceInfo);

  const outPath = clipVideoPath(jobId, clip.id);
  const thumbPath = clipThumbnailPath(jobId, clip.id);
  const customTexts: CustomTextElement[] = JSON.parse(clip.customTexts || "[]");
  const cues: StoredCue[] = JSON.parse(clip.captionCues || "[]");
  const customTextFilePath = customTextAssPath(jobId, clip.id);
  const bigCaptionsFilePath = bigCaptionsPath(jobId, clip.id);
  const topHalfH = doubleTopHalfHeight(resolution.height);

  try {
    await cutSplitScreenClip({
      topSourcePath: topPath,
      topStartSec,
      topEndSec,
      bottomSourcePath: bottomPath,
      bottomStartSec,
      label: `Parte ${clip.rank}`,
      outPath,
      resolution,
    });

    if (clip.captionsEnabled && cues.length > 0) {
      const ass = buildBigCaptionsAssFromCues(cues, resolution, defaultSplitDoubleCaptionsStyle(resolution));
      if (ass) {
        fs.writeFileSync(bigCaptionsFilePath, ass, "utf-8");
        const withCaptionsPath = `${outPath}.withcaptions.mp4`;
        await applyCustomTextOverlay(outPath, withCaptionsPath, bigCaptionsFilePath);
        fs.renameSync(withCaptionsPath, outPath);
      }
    }

    if (clip.customTitle && clip.customTitle.trim()) {
      const withTitlePath = `${outPath}.withtitle.mp4`;
      await burnCustomTitleBar(outPath, withTitlePath, clip.customTitle.trim(), topHalfH, resolution);
      fs.renameSync(withTitlePath, outPath);
    }

    const ass = customTexts.length > 0 ? buildCustomTextAss(customTexts, resolution) : null;
    if (ass) {
      fs.writeFileSync(customTextFilePath, ass, "utf-8");
      const withTextPath = `${outPath}.withtext.mp4`;
      await applyCustomTextOverlay(outPath, withTextPath, customTextFilePath);
      fs.renameSync(withTextPath, outPath);
    }

    await extractThumbnail(outPath, thumbPath);
    await db.clip.update({
      where: { id: clip.id },
      data: { filePath: outPath, thumbnailPath: thumbPath, status: "READY", error: null },
    });
  } finally {
    fs.rmSync(customTextFilePath, { force: true });
    fs.rmSync(bigCaptionsFilePath, { force: true });
  }
}
