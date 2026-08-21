import { db } from "@/lib/db";
import { suggestHashtags } from "@/lib/trends/hashtags";
import { resolveContentLanguage } from "@/lib/lang";
import { uploadShortToYouTube } from "./youtube";
import { uploadShortToTikTok } from "./tiktok";
import type { Platform } from "@/lib/types";

export interface PublishResult {
  ok: boolean;
  publicationId: string;
  status: "PUBLISHED" | "DRAFT" | "FAILED";
  remoteUrl?: string;
  note?: string;
  error?: string;
}

/**
 * Publica un clip ya renderizado en la plataforma indicada: vuelve a buscar los mejores
 * hashtags del momento justo antes de subir, sube el vídeo y registra la Publication.
 * Usado tanto por la ruta manual de publicar como por el planificador automático.
 */
export async function publishClip(clipId: string, platform: Platform): Promise<PublishResult> {
  const clip = await db.clip.findUnique({ where: { id: clipId }, include: { job: true } });
  if (!clip || !clip.filePath) {
    return { ok: false, publicationId: "", status: "FAILED", error: "El clip no está listo todavía" };
  }
  const contentLanguage = resolveContentLanguage(clip.job.contentLanguage);

  const publication = await db.publication.create({
    data: { clipId: clip.id, platform, status: "UPLOADING" },
  });

  try {
    const existingHashtags = JSON.parse(clip.hashtags || "[]") as string[];
    const fresh = await suggestHashtags({
      platform,
      title: clip.title,
      description: clip.description,
      existing: existingHashtags,
      contentLanguage,
    });
    await db.clip.update({ where: { id: clip.id }, data: { hashtags: JSON.stringify(fresh.hashtags) } });

    if (platform === "YOUTUBE") {
      const result = await uploadShortToYouTube({
        filePath: clip.filePath,
        title: clip.title,
        description: clip.description,
        hashtags: fresh.hashtags,
        privacyStatus: "public",
      });
      await db.publication.update({
        where: { id: publication.id },
        data: { status: "PUBLISHED", remoteId: result.videoId, remoteUrl: result.url },
      });
      await db.clip.update({ where: { id: clip.id }, data: { autoPublishedAt: new Date() } });
      return { ok: true, publicationId: publication.id, status: "PUBLISHED", remoteUrl: result.url };
    }

    const result = await uploadShortToTikTok({
      filePath: clip.filePath,
      title: clip.title,
      description: clip.description,
      hashtags: fresh.hashtags,
    });
    await db.publication.update({
      where: { id: publication.id },
      data: { status: "DRAFT", remoteId: result.publishId },
    });
    await db.clip.update({ where: { id: clip.id }, data: { autoPublishedAt: new Date() } });
    return {
      ok: true,
      publicationId: publication.id,
      status: "DRAFT",
      note: "Subido como borrador a tu bandeja de TikTok. Ábrelo en la app de TikTok para revisarlo y publicarlo.",
    };
  } catch (err) {
    const message = (err as Error).message;
    await db.publication.update({ where: { id: publication.id }, data: { status: "FAILED", error: message } });
    return { ok: false, publicationId: publication.id, status: "FAILED", error: message };
  }
}
