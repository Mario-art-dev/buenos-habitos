import fs from "fs";
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

function safeDelete(path: string | null): void {
  if (!path) return;
  try {
    if (fs.existsSync(path)) fs.unlinkSync(path);
  } catch {
    // no crítico: si no se puede borrar, como mucho se queda ocupando espacio
  }
}

/**
 * Una vez que un clip ya se subió con éxito a TODAS las plataformas que el usuario tiene
 * conectadas ahora mismo, el vídeo ya cumplió su propósito: se borran sus archivos (vídeo,
 * miniatura, portada propia si la había) para liberar espacio — pedido explícito, para no volver
 * a acercarse al límite de almacenamiento gratuito con vídeos que ya están publicados — y el clip
 * sale de la Galería (status pasa de READY a PUBLISHED, y /api/clips solo lista status=READY).
 * El registro en la base de datos (título, hashtags, Publication con el enlace...) se conserva.
 */
async function finalizeIfFullyPublished(clipId: string): Promise<void> {
  const [connectedPlatforms, clip] = await Promise.all([
    db.socialAccount.findMany({ select: { platform: true } }),
    db.clip.findUnique({
      where: { id: clipId },
      include: { publications: { where: { status: { in: ["PUBLISHED", "DRAFT"] } } } },
    }),
  ]);
  if (!clip || clip.status !== "READY") return;

  const connected = new Set(connectedPlatforms.map((a) => a.platform));
  const succeeded = new Set(clip.publications.map((p) => p.platform));
  const fullyPublished = connected.size > 0 && [...connected].every((p) => succeeded.has(p));
  if (!fullyPublished) return;

  safeDelete(clip.filePath);
  safeDelete(clip.thumbnailPath);
  safeDelete(clip.coverImagePath);
  await db.clip.update({
    where: { id: clipId },
    data: { status: "PUBLISHED", filePath: null, thumbnailPath: null, coverImagePath: null },
  });
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
      await finalizeIfFullyPublished(clip.id);
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
      data: { status: "PUBLISHED", remoteId: result.publishId },
    });
    await db.clip.update({ where: { id: clip.id }, data: { autoPublishedAt: new Date() } });
    await finalizeIfFullyPublished(clip.id);
    return {
      ok: true,
      publicationId: publication.id,
      status: "PUBLISHED",
      note:
        result.privacyLevel === "SELF_ONLY"
          ? "Publicado en TikTok en modo privado (solo lo ves tú): tu app de TikTok todavía no está auditada por TikTok para publicar en público. Pídeles la auditoría del 'Content Posting API' en tu panel de desarrollador para que se publique público automáticamente."
          : undefined,
    };
  } catch (err) {
    const message = (err as Error).message;
    await db.publication.update({ where: { id: publication.id }, data: { status: "FAILED", error: message } });
    return { ok: false, publicationId: publication.id, status: "FAILED", error: message };
  }
}
