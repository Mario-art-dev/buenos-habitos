import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { suggestHashtags } from "@/lib/trends/hashtags";
import { uploadShortToYouTube } from "@/lib/social/youtube";
import { uploadShortToTikTok } from "@/lib/social/tiktok";

const publishSchema = z.object({
  platform: z.enum(["YOUTUBE", "TIKTOK"]),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Plataforma inválida" }, { status: 400 });
  }
  const { platform } = parsed.data;

  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip || !clip.filePath) {
    return NextResponse.json({ error: "El clip no está listo todavía" }, { status: 400 });
  }

  const publication = await db.publication.create({
    data: { clipId: clip.id, platform, status: "UPLOADING" },
  });

  try {
    // Búsqueda de hashtags en tendencia justo antes de publicar, para no subir con datos desactualizados.
    const existingHashtags = JSON.parse(clip.hashtags || "[]") as string[];
    const fresh = await suggestHashtags({
      platform,
      title: clip.title,
      description: clip.description,
      existing: existingHashtags,
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
      return NextResponse.json({ publication: { ...publication, status: "PUBLISHED", remoteUrl: result.url } });
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
    return NextResponse.json({
      publication: { ...publication, status: "DRAFT" },
      note: "Subido como borrador a tu bandeja de TikTok. Ábrelo en la app de TikTok para revisarlo y publicarlo.",
    });
  } catch (err) {
    await db.publication.update({
      where: { id: publication.id },
      data: { status: "FAILED", error: (err as Error).message },
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
