import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Historial de qué se ha publicado dónde — pedido explícito: en cuanto un clip termina de
 * publicarse en todas las plataformas conectadas, sale de la Galería y se borran sus archivos
 * (para no gastar espacio con vídeos ya publicados, ver finalizeIfFullyPublished en publish.ts),
 * así que sin esta lista no quedaba ningún sitio en la web para ver qué se subió y cuándo.
 */
export async function GET() {
  const clips = await db.clip.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { autoPublishedAt: "desc" },
    include: {
      publications: { where: { status: { in: ["PUBLISHED", "DRAFT"] } } },
      job: { select: { sourceTitle: true, mode: true } },
    },
  });

  return NextResponse.json({
    clips: clips.map((clip) => ({
      id: clip.id,
      title: clip.title,
      jobMode: clip.job.mode,
      sourceTitle: clip.job.sourceTitle,
      publishedAt: clip.autoPublishedAt,
      publications: clip.publications.map((p) => ({
        platform: p.platform,
        remoteUrl: p.remoteUrl,
        updatedAt: p.updatedAt,
      })),
    })),
  });
}
