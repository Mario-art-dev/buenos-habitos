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
    await db.job.update({ where: { id: jobId }, data: { transcript: transcript.text } });

    await setStatus(jobId, "ANALYZING", "Detectando momentos y clasificándolos por categoría…");
    const spans = await detectContentSegments(srcPath, durationSec);
    const candidates = await buildCandidateMoments(jobId, srcPath, spans, transcript.segments);
    const classified = await classifyCandidates(candidates);
    const groups = groupIntoRankings(classified);

    if (groups.length === 0) {
      throw new Error(
        "No se encontraron suficientes momentos de una misma categoría (mínimo configurado) para montar un ranking."
      );
    }

    await setStatus(jobId, "CLIPPING", `Montando ${groups.length} vídeos de ranking…`);
    const sourceInfo = await probeVideo(srcPath);
    const resolution = pickVerticalResolution(sourceInfo);

    let rank = 1;
    for (const group of groups) {
      let clipId: string | null = null;
      try {
        const composition = await composeRanking(group, title);
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
            musicQuery: composition.musicQuery,
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
      } catch (err) {
        if (clipId) {
          await db.clip.update({
            where: { id: clipId },
            data: { status: "FAILED", error: (err as Error).message },
          });
        }
      }
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
