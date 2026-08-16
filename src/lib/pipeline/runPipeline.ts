import fs from "fs";
import { db } from "@/lib/db";
import {
  sourceVideoPath,
  audioPath,
  clipVideoPath,
  clipThumbnailPath,
} from "@/lib/storagePaths";
import { downloadSourceVideo } from "./download";
import { extractAudio, transcribeAudio } from "./transcribe";
import { analyzeTranscriptForClips } from "./analyze";
import { cutVerticalClip, extractThumbnail } from "./clip";

async function setStatus(jobId: string, status: string, statusMessage?: string) {
  await db.job.update({
    where: { id: jobId },
    data: { status, statusMessage },
  });
}

export async function processJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });

  try {
    // 1. Descargar el vídeo fuente
    await setStatus(jobId, "DOWNLOADING", "Descargando el vídeo original…");
    const srcPath = sourceVideoPath(jobId);
    const { title, durationSec } = await downloadSourceVideo(job.sourceUrl, srcPath);
    await db.job.update({
      where: { id: jobId },
      data: { sourceTitle: title, sourceDurationSec: durationSec, sourceFilePath: srcPath },
    });

    // 2. Transcribir
    await setStatus(jobId, "TRANSCRIBING", "Transcribiendo el audio…");
    const audioOut = audioPath(jobId);
    await extractAudio(srcPath, audioOut);
    const transcript = await transcribeAudio(audioOut);
    await db.job.update({ where: { id: jobId }, data: { transcript: transcript.text } });

    // 3. Analizar con IA: elegir mejores momentos + títulos + descripciones + score + hashtags
    await setStatus(jobId, "ANALYZING", "La IA está buscando los mejores momentos…");
    const candidates = await analyzeTranscriptForClips(transcript.segments, title, durationSec);

    if (candidates.length === 0) {
      throw new Error("La IA no encontró momentos aprovechables en este vídeo.");
    }

    const clips = await Promise.all(
      candidates.map((c, index) =>
        db.clip.create({
          data: {
            jobId,
            rank: index + 1,
            startSec: c.startSec,
            endSec: c.endSec,
            title: c.title,
            description: c.description,
            hook: c.hook,
            viralityScore: Math.max(0, Math.min(100, Math.round(c.viralityScore))),
            viralityReason: c.viralityReason,
            hashtags: JSON.stringify(c.hashtags ?? []),
            status: "PENDING",
          },
        })
      )
    );

    // 4. Cortar cada clip en formato vertical
    await setStatus(jobId, "CLIPPING", `Generando ${clips.length} shorts…`);
    for (const clip of clips) {
      try {
        await db.clip.update({ where: { id: clip.id }, data: { status: "RENDERING" } });
        const outPath = clipVideoPath(jobId, clip.id);
        const thumbPath = clipThumbnailPath(jobId, clip.id);
        await cutVerticalClip({
          sourcePath: srcPath,
          outPath,
          startSec: clip.startSec,
          endSec: clip.endSec,
        });
        await extractThumbnail(outPath, thumbPath);
        await db.clip.update({
          where: { id: clip.id },
          data: { status: "READY", filePath: outPath, thumbnailPath: thumbPath },
        });
      } catch (err) {
        await db.clip.update({
          where: { id: clip.id },
          data: { status: "FAILED", error: (err as Error).message },
        });
      }
    }

    await setStatus(jobId, "DONE", "¡Listo! Revisa tus shorts.");
  } catch (err) {
    const message = (err as Error).message;
    await db.job.update({ where: { id: jobId }, data: { status: "FAILED", error: message } });
    throw err;
  } finally {
    // liberar espacio: el audio intermedio ya no hace falta
    try {
      fs.rmSync(audioPath(jobId), { force: true });
    } catch {
      // ignorar
    }
  }
}
