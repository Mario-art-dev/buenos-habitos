import fs from "fs";
import { db } from "@/lib/db";
import {
  sourceVideoPath,
  audioPath,
  clipVideoPath,
  clipThumbnailPath,
  clipBodyPath,
  narrationAudioPath,
  candidateCardPath,
  hookFramePath,
  clipCommentedPath,
  coverCardPath,
  tmpDir,
} from "@/lib/storagePaths";
import { resolveSourceVideo } from "./download";
import { extractAudio, transcribeAudio, type TranscriptSegment } from "./transcribe";
import { analyzeTranscriptForClips } from "./analyze";
import { cutVerticalClip, concatClips, extractThumbnail } from "./clip";
import type { StoredCue } from "./bigCaptions";
import { pickHookStartSec, hookVerifiedFrameSec } from "./hookFrame";
import { probeVideo, pickVerticalResolution } from "./probe";
import { processRankingJob } from "./rankingPipeline";
import { processProductJob } from "./productPipeline";
import { processSongJob } from "./songPipeline";
import { setStatus } from "./status";
import { generateSingleCommentary } from "./commentary";
import { renderCommentaryCard } from "./commentaryCards";
import { renderCoverCard } from "./coverCard";
import { config } from "@/lib/config";

function transcriptExcerptFor(segments: TranscriptSegment[], startSec: number, endSec: number): string {
  return segments
    .filter((s) => s.end > startSec && s.start < endSec)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

export async function processJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.mode === "RANKING") {
    return processRankingJob(jobId);
  }
  if (job.mode === "PRODUCT") {
    return processProductJob(jobId);
  }
  if (job.mode === "SONG") {
    return processSongJob(jobId);
  }
  return processSingleJob(jobId);
}

async function processSingleJob(jobId: string): Promise<void> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!job.sourceUrl && !job.sourceFilePath) {
    throw new Error("Este trabajo no tiene ni URL ni archivo de vídeo fuente.");
  }
  try {
    // 1. Descargar el vídeo fuente (o reutilizar el archivo ya subido)
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

    // 2. Transcribir
    await setStatus(jobId, "TRANSCRIBING", "Transcribiendo el audio…");
    const audioOut = audioPath(jobId);
    await extractAudio(srcPath, audioOut);
    const transcript = await transcribeAudio(audioOut);
    await db.job.update({ where: { id: jobId }, data: { transcript: transcript.text } });

    // 3. Analizar con IA: elegir mejores momentos + títulos + descripciones + score + hashtags
    await setStatus(jobId, "ANALYZING", "La IA está buscando los mejores momentos…");
    const candidates = await analyzeTranscriptForClips(
      transcript.segments,
      title,
      durationSec,
      async (partIndex, partCount) => {
        if (partCount > 1) {
          await setStatus(
            jobId,
            "ANALYZING",
            `La IA está buscando los mejores momentos… (parte ${partIndex + 1} de ${partCount})`
          );
        }
      }
    );

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

    // 4. Cortar cada clip en formato vertical, a la mayor resolución que dé el vídeo fuente
    await setStatus(jobId, "CLIPPING", `Generando ${clips.length} shorts…`);
    const sourceInfo = await probeVideo(srcPath);
    const resolution = pickVerticalResolution(sourceInfo);
    for (const clip of clips) {
      const bodyPath = clipBodyPath(jobId, clip.id);
      const introNarrationPath = narrationAudioPath(jobId, clip.id, "intro");
      const outroNarrationPath = narrationAudioPath(jobId, clip.id, "outro");
      const introCardPath = candidateCardPath(jobId, clip.id, "intro");
      const outroCardPath = candidateCardPath(jobId, clip.id, "outro");
      const commentedPath = clipCommentedPath(jobId, clip.id);
      const coverPath = coverCardPath(jobId, clip.id);
      try {
        await db.clip.update({ where: { id: clip.id }, data: { status: "RENDERING" } });
        const outPath = clipVideoPath(jobId, clip.id);
        const thumbPath = clipThumbnailPath(jobId, clip.id);

        // El gancho engancha mucho más con una persona en pantalla desde el segundo 0 que con un
        // plano vacío o de transición — si el fotograma inicial no muestra a nadie, se adelanta
        // un poco el inicio (ver hookFrame.ts; nunca bloquea ni hace fallar el clip).
        const hookStartSec = await pickHookStartSec({
          sourcePath: srcPath,
          startSec: clip.startSec,
          endSec: clip.endSec,
          framePath: hookFramePath(jobId, clip.id),
        });

        // Petición explícita: en esta sección (SINGLE, "vídeos virales") el short se queda siempre
        // en el recorte vertical fijo, sin caption grande automático quemado — el usuario prefiere
        // controlar el texto a mano desde el editor (recortar, añadir textos propios) en vez de que
        // se le queme algo automático encima. No se calculan cues ni se activa el zoom dinámico
        // aquí; el modo Ranking (rankingRender.ts) no cambia, sigue con ambos activados.
        const captionCues: StoredCue[] = [];

        let commentaryIntro: string | null = null;
        let commentaryOutro: string | null = null;

        // El cuerpo se corta siempre primero a bodyPath (con o sin comentario), para poder
        // envolverlo después con la portada de marca sin tener que cortar dos veces.
        await cutVerticalClip({
          sourcePath: srcPath,
          outPath: bodyPath,
          startSec: hookStartSec,
          endSec: clip.endSec,
          resolution,
          dynamicZoom: false,
        });

        let core = bodyPath;

        if (config.commentary.enabled) {
          const excerpt = transcriptExcerptFor(transcript.segments, hookStartSec, clip.endSec);
          const commentary = await generateSingleCommentary({
            title: clip.title,
            description: clip.description,
            transcriptExcerpt: excerpt,
            hook: clip.hook,
          });
          commentaryIntro = commentary.introText;
          commentaryOutro = commentary.outroText;

          const introCard = await renderCommentaryCard({
            jobId,
            clipId: clip.id,
            key: "intro",
            text: commentary.introText,
            resolution,
          });
          const outroCard = await renderCommentaryCard({
            jobId,
            clipId: clip.id,
            key: "outro",
            text: commentary.outroText,
            resolution,
          });
          await concatClips([introCard, bodyPath, outroCard], commentedPath);
          core = commentedPath;
        }

        // Portada de marca (fotograma del propio short + título + sonido de marca) al principio
        // Y al final, la misma en los dos sitios — pedido explícito: "la pantalla en pausa con
        // la portada mientras suena el sonido, y directo al vídeo después".
        if (config.coverCard.enabled) {
          // La portada reutiliza el trabajo del gancho, pero tiene que extraer el fotograma del
          // instante que la IA REALMENTE verificó (hookStartSec + el margen de hookFrame.ts), no
          // hookStartSec a secas — ese punto exacto puede caer justo en un corte (negro/borroso),
          // que es justo lo que esa comprobación evita para el gancho.
          await renderCoverCard({
            sourcePath: srcPath,
            frameAtSec: hookVerifiedFrameSec(hookStartSec, clip.endSec),
            title: clip.title,
            outPath: coverPath,
            resolution,
          });
          await concatClips([coverPath, core, coverPath], outPath);
        } else if (core !== outPath) {
          fs.copyFileSync(core, outPath);
        }

        await extractThumbnail(outPath, thumbPath);
        await db.clip.update({
          where: { id: clip.id },
          data: {
            status: "READY",
            filePath: outPath,
            thumbnailPath: thumbPath,
            commentaryIntro,
            commentaryOutro,
            effectiveStartSec: hookStartSec,
            captionCues: JSON.stringify(captionCues),
          },
        });
      } catch (err) {
        await db.clip.update({
          where: { id: clip.id },
          data: { status: "FAILED", error: (err as Error).message },
        });
      } finally {
        // Los archivos intermedios (corte sin envolver, narración, tarjetas, subtítulos) ya no
        // hacen falta una vez terminado este clip (listo o fallido): si no se borran aquí, se
        // van acumulando durante todo el trabajo y pueden agotar el disco antes de terminar.
        for (const tmp of [
          bodyPath,
          commentedPath,
          coverPath,
          introNarrationPath,
          outroNarrationPath,
          introCardPath,
          outroCardPath,
        ]) {
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
    // liberar espacio: el audio intermedio y cualquier resto de tmp/ ya no hacen falta
    // (el bucle de arriba ya limpia por clip, esto es red de seguridad para lo que quede)
    try {
      fs.rmSync(audioPath(jobId), { force: true });
      fs.rmSync(tmpDir(jobId), { recursive: true, force: true });
    } catch {
      // ignorar
    }
  }
}
