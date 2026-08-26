import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertStorageNotBlocked } from "@/lib/storageQuota";

export const dynamic = "force-dynamic";

// Solo modo RANKING: secciones que el usuario pide expresamente antes de generar (ver
// Job.manualCategories / rankingAnalyze.ts groupIntoRankings).
const manualCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(["TOPIC", "YOUTUBER"]),
});

const createJobSchema = z.object({
  url: z.string().url("Introduce una URL de vídeo válida"),
  mode: z.enum(["SINGLE", "RANKING", "SPLIT"]).optional(),
  // Solo modo SPLIT: duración en segundos de cada trozo.
  splitDurationSec: z.number().min(15).max(600).optional(),
  // Solo modo RANKING, opcional.
  manualCategories: z.array(manualCategorySchema).max(20).optional(),
  // Solo modo SPLIT, opcional: título propio escrito a mano, quemado en pantalla en todos los
  // shorts que salgan de este vídeo (ver Job.customTitle).
  customTitle: z.string().trim().min(1).max(120).optional(),
});

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode");
  // ?deleted=1 pide la papelera (/deleted) en vez de las listas normales — por defecto los
  // trabajos borrados (ver DELETE en /api/jobs/[id]) se excluyen de todas partes.
  const deleted = req.nextUrl.searchParams.get("deleted") === "1";
  const jobs = await db.job.findMany({
    where: {
      ...(mode && { mode }),
      deletedAt: deleted ? { not: null } : null,
    },
    orderBy: deleted ? { deletedAt: "desc" } : { createdAt: "desc" },
    include: { clips: { select: { id: true, viralityScore: true, status: true } } },
  });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "URL inválida" }, { status: 400 });
  }

  try {
    await assertStorageNotBlocked();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 507 });
  }

  const job = await db.job.create({
    data: {
      sourceUrl: parsed.data.url,
      mode: parsed.data.mode ?? "SINGLE",
      status: "PENDING",
      ...(parsed.data.mode === "SPLIT" && {
        splitDurationSec: parsed.data.splitDurationSec ?? 60,
        ...(parsed.data.customTitle && { customTitle: parsed.data.customTitle }),
      }),
      ...(parsed.data.mode === "RANKING" &&
        parsed.data.manualCategories &&
        parsed.data.manualCategories.length > 0 && {
          manualCategories: JSON.stringify(parsed.data.manualCategories),
        }),
    },
  });

  return NextResponse.json({ job }, { status: 201 });
}
