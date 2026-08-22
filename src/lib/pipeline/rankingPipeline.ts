import fs from "fs";
import { db } from "@/lib/db";
import { sourceVideoPath, audioPath, tmpDir } from "@/lib/storagePaths";
import { resolveSourceVideo } from "./download";
import { extractAudio, transcribeAudio } from "./transcribe";
import { probeVideo, pickVerticalResolution } from "./probe";
import { detectContentSegments } from "./silence";
import { buildCandidateMoments, classifyCandidates, groupIntoRankings } from "./rankingAnalyze";
import { composeRanking } from "./rankingCompose";
import { assembleRankingVideo, finalizeWithoutMusic } from "./rankingRender";
import { setStatus } from "./status";
import { config } from "@/lib/config";
import { normalizeLanguageCode, resolveContentLanguage } from "@/lib/lang";

export async function processRankingJob(jobId: string): Promise<void> {
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
    // El idioma REAL hablado en el vídeo (detectado por Whisper) manda sobre el idioma fijo del
    // canal: así categoría/etiquetas/título/comentario salen en inglés si el vídeo está en inglés,
    // o en español si está en español, sea cual sea CHANNEL_LANGUAGE.
    const languageCode = normalizeLanguageCode(transcript.language);
    const contentLanguage = resolveContentLanguage(languageCode);
    await db.job.update({
      where: { id: jobId },
      data: { transcript: transcript.text, contentLanguage: languageCode },
    });

    await setStatus(jobId, "ANALYZING", "Detectando momentos y clasificándolos por categoría…");
    const spans = await detectContentSegments(srcPath, durationSec);
    const candidates = await buildCandidateMoments(jobId, srcPath, spans, transcript.segments);
    const classifyResult = await classifyCandidates(candidates, contentLanguage);
    const classified = classifyResult.items;
    const groups = groupIntoRankings(classified, languageCode);

    if (groups.length === 0) {
      // Diagnóstico completo en el propio mensaje de error: para poder ver de un vistazo EN QUÉ
      // paso del embudo se pierde el contenido (¿pocos tramos detectados? ¿lotes de IA fallando?
      // ¿la IA marca casi todo como "no usable"? ¿la duración total no llega al mínimo?) en vez de
      // tener que adivinarlo — pedido explícito tras varios fallos con un vídeo real que sí tenía
      // contenido de sobra.
      const included = classified.filter((c) => c.include);
      const includedDurationSec = Math.round(included.reduce((sum, i) => sum + (i.endSec - i.startSec), 0));
      throw new Error(
        "No se encontraron suficientes momentos aprovechables en este vídeo para montar ni un solo ranking " +
          `(ni siquiera juntando categorías distintas). Diagnóstico: ${spans.length} tramos detectados en el ` +
          `vídeo, ${candidates.length} candidatos extraídos, ${classified.length} clasificados por la IA ` +
          `(${classifyResult.failedBatches}/${classifyResult.totalBatches} lotes fallaron${
            classifyResult.lastErrorMessage ? `, último error: ${classifyResult.lastErrorMessage}` : ""
          }), ${included.length} marcados como aprovechables por la IA, ${includedDurationSec}s de duración ` +
          `total aprovechable (mínimo requerido: ${config.ranking.minDurationSec}s, mínimo ${config.ranking.minItems} momentos por categoría).`
      );
    }

    await setStatus(jobId, "CLIPPING", `Montando ${groups.length} vídeos de ranking…`);
    const sourceInfo = await probeVideo(srcPath);
    const resolution = pickVerticalResolution(sourceInfo);

    let rank = 1;
    let succeeded = 0;
    // Si TODOS los grupos fallan antes de crear su Clip (p.ej. la IA se queda sin cupo diario a
    // mitad del trabajo: composeRanking() lanza para cada grupo restante antes de que exista
    // clipId), el bucle terminaba sin errores visibles y el job se marcaba "DONE" con CERO clips
    // — la web se quedaba en blanco sin ninguna pista de qué pasó. Se guarda el último error para
    // poder fallar el job entero con un mensaje claro si al final no se generó ni un solo clip.
    let lastGroupError: Error | null = null;
    for (const group of groups) {
      let clipId: string | null = null;
      try {
        const composition = await composeRanking(group, title, contentLanguage);
        const commentaryOn = config.commentary.enabled;
        const created = await db.clip.create({
          data: {
            jobId,
            rank: rank++,
            startSec: group.items[group.items.length - 1].startSec,
            endSec: group.items[0].endSec,
            title: composition.title,
            description: composition.description,
            viralityScore: composition.viralityScore,
            viralityReason: composition.viralityReason,
            hashtags: JSON.stringify(composition.hashtags),
            category: group.category,
            musicRecommended: composition.musicRecommended,
            musicQuery: composition.musicQuery,
            musicSuggestedSection: composition.musicSuggestedSection,
            commentaryIntro: commentaryOn ? composition.commentaryIntro : null,
            commentaryOutro: commentaryOn ? composition.commentaryOutro : null,
            status: "RENDERING",
            rankingItems: {
              create: group.items.map((item, idx) => ({
                position: idx + 1, // item[0] (mejor score) = posición 1 (se muestra la última, efecto cuenta atrás)
                startSec: item.startSec,
                endSec: item.endSec,
                label: item.label,
                description: item.description,
                commentary: commentaryOn ? composition.itemCommentary[idx] ?? null : null,
              })),
            },
          },
          include: { rankingItems: true },
        });
        clipId = created.id;

        await assembleRankingVideo({
          jobId,
          clipId: created.id,
          sourcePath: srcPath,
          category: group.category,
          overallIntroCommentary: commentaryOn ? composition.commentaryIntro : null,
          overallOutroCommentary: commentaryOn ? composition.commentaryOutro : null,
          items: created.rankingItems.map((i) => ({
            position: i.position,
            startSec: i.startSec,
            endSec: i.endSec,
            label: i.label,
            commentary: i.commentary,
          })),
          transcriptSegments: transcript.segments,
          resolution,
        });

        const { filePath, thumbnailPath } = await finalizeWithoutMusic(jobId, created.id);
        await db.clip.update({ where: { id: created.id }, data: { status: "READY", filePath, thumbnailPath } });
        succeeded++;
      } catch (err) {
        const error = err as Error;
        lastGroupError = error;
        if (clipId) {
          await db.clip.update({
            where: { id: clipId },
            data: { status: "FAILED", error: error.message },
          });
        }
      }
    }

    if (succeeded === 0) {
      throw new Error(
        lastGroupError
          ? `No se pudo generar ningún vídeo de ranking: ${lastGroupError.message}`
          : "No se pudo generar ningún vídeo de ranking."
      );
    }

    await setStatus(jobId, "DONE", "¡Listo! Revisa tus vídeos de ranking.");
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
