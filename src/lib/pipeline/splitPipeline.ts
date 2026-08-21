import fs from "fs";
import { db } from "@/lib/db";
import {
  sourceVideoPath,
  audioPath,
  clipVideoPath,
  clipThumbnailPath,
  clipBodyPath,
  hookFramePath,
  coverCardPath,
  tmpDir,
} from "@/lib/storagePaths";
import { resolveSourceVideo } from "./download";
import { extractAudio, transcribeAudio } from "./transcribe";
import { buildFixedSegments, describeFixedSegments } from "./splitAnalyze";
import { cutVerticalClip, extractThumbnail, concatClips } from "./clip";
import { pickHookStartSec, hookVerifiedFrameSec } from "./hookFrame";
import { probeVideo, pickVerticalResolution } from "./probe";
import { renderCoverCard } from "./coverCard";
import { setStatus } from "./status";
import { config } from "@/lib/config";

const DEFAULT_SPLIT_DURATION_SEC = 60;

/**
 * Modo "Cortar cada X minutos": trocea el vídeo entero en shorts consecutivos de duración fija,
 * sin que la IA elija momentos — es el modo mecánico, contrapuesto al modo "Clip viral" (RANKING)
 * donde la IA sí selecciona y agrupa los mejores momentos. Mismo tratamiento visual que SINGLE
 * (sin zoom dinámico, sin caption grande automático, con portada de marca) para que el resultado
 * sea consistente con el resto de la app — ver runPipeline.ts.
 */
export async function processSplitJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!job.sourceUrl && !job.sourceFilePath) {
    throw new Error("Este trabajo no tiene ni URL ni archivo de vídeo fuente.");
  }
  try {
    await setStatus(
      jobId,
      "DOWNLOADING",
      job.sourceFilePath ? "Preparando el vídeo subido…" : "Descargando el vídeo original…"
    );
    const srcPath = sourceVideoPath(jobId);
    const { title, durationSec } = await resolveSourceVideo(job, srcPath);
    await db.job.update({
      where: { id: jobId },
      data: { sourceTitle: title, sourceDurationSec: durationSec, sourceFilePath: srcPath },
    });

    await setStatus(jobId, "TRANSCRIBING", "Transcribiendo el audio…");
    const audioOut = audioPath(jobId);
    await extractAudio(srcPath, audioOut);
    const transcript = await transcribeAudio(audioOut);
    await db.job.update({ where: { id: jobId }, data: { transcript: transcript.text } });

    await setStatus(jobId, "ANALYZING", "Cortando el vídeo en tramos y describiéndolos…");
    const splitDurationSec = job.splitDurationSec ?? DEFAULT_SPLIT_DURATION_SEC;
    const fixedSegments = buildFixedSegments(durationSec, splitDurationSec);
    if (fixedSegments.length === 0) {
      throw new Error("El vídeo es demasiado corto para cortarlo en tramos.");
    }
    const descriptions = await describeFixedSegments(fixedSegments, transcript.segments, title);

    const clips = await Promise.all(
      fixedSegments.map((seg) => {
        const desc = descriptions.get(seg.index)!;
        return db.clip.create({
          data: {
            jobId,
            rank: seg.index + 1,
            startSec: seg.startSec,
            endSec: seg.endSec,
            title: desc.title,
            description: desc.description,
            viralityScore: desc.viralityScore,
            viralityReason: "",
            hashtags: JSON.stringify(desc.hashtags),
            status: "PENDING",
          },
        });
      })
    );

    await setStatus(jobId, "CLIPPING", `Generando ${clips.length} shorts…`);
    const sourceInfo = await probeVideo(srcPath);
    const resolution = pickVerticalResolution(sourceInfo);
    for (const clip of clips) {
      const bodyPath = clipBodyPath(jobId, clip.id);
      const coverPath = coverCardPath(jobId, clip.id);
      try {
        await db.clip.update({ where: { id: clip.id }, data: { status: "RENDERING" } });
        const outPath = clipVideoPath(jobId, clip.id);
        const thumbPath = clipThumbnailPath(jobId, clip.id);

        // Mismo ajuste de gancho que SINGLE: si el fotograma inicial del tramo no muestra a nadie,
        // se adelanta un poco el inicio (nunca bloquea ni hace fallar el clip).
        const hookStartSec = await pickHookStartSec({
          sourcePath: srcPath,
          startSec: clip.startSec,
          endSec: clip.endSec,
          framePath: hookFramePath(jobId, clip.id),
        });

        await cutVerticalClip({
          sourcePath: srcPath,
          outPath: bodyPath,
          startSec: hookStartSec,
          endSec: clip.endSec,
          resolution,
          dynamicZoom: false,
        });

        if (config.coverCard.enabled) {
          await renderCoverCard({
            sourcePath: srcPath,
            frameAtSec: hookVerifiedFrameSec(hookStartSec, clip.endSec),
            title: clip.title,
            outPath: coverPath,
            resolution,
          });
          await concatClips([bodyPath, coverPath], outPath);
        } else {
          fs.copyFileSync(bodyPath, outPath);
        }

        await extractThumbnail(outPath, thumbPath);
        await db.clip.update({
          where: { id: clip.id },
          data: {
            status: "READY",
            filePath: outPath,
            thumbnailPath: thumbPath,
            effectiveStartSec: hookStartSec,
            captionCues: "[]",
          },
        });
      } catch (err) {
        await db.clip.update({
          where: { id: clip.id },
          data: { status: "FAILED", error: (err as Error).message },
        });
      } finally {
        for (const tmp of [bodyPath, coverPath]) {
          try {
            fs.rmSync(tmp, { force: true });
          } catch {
            // ignorar
          }
        }
      }
    }

    await setStatus(jobId, "DONE", "¡Listo! Revisa tus shorts.");
  } catch (err) {
    const message = (err as Error).message;
    await db.job.update({ where: { id: jobId }, data: { status: "FAILED", error: message } });
    throw err;
  } finally {
    try {
      fs.rmSync(audioPath(jobId), { force: true });
      fs.rmSync(tmpDir(jobId), { recursive: true, force: true });
    } catch {
      // ignorar
    }
  }
}
