import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { toMediaUrl } from "@/lib/storagePaths";

export const dynamic = "force-dynamic";

function serialize(clip: {
  hashtags: string;
  captionCues: string;
  customTexts: string;
  filePath: string | null;
  thumbnailPath: string | null;
  job?: { sourceFilePath: string | null };
  [key: string]: unknown;
}) {
  const { job, ...rest } = clip;
  return {
    ...rest,
    hashtags: JSON.parse(clip.hashtags || "[]"),
    captionCues: JSON.parse(clip.captionCues || "[]"),
    customTexts: JSON.parse(clip.customTexts || "[]"),
    videoUrl: toMediaUrl(clip.filePath),
    thumbnailUrl: toMediaUrl(clip.thumbnailPath),
    // Vídeo fuente original (sin recortar/verticalizar) — lo usa el editor para la vista previa en
    // vivo con Remotion, recortando en el navegador el mismo tramo [effectiveStartSec, endSec] que
    // ya se usa para renderizar de verdad, sin gastar otro render de servidor solo para previsualizar.
    sourceVideoUrl: job ? toMediaUrl(job.sourceFilePath) : null,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const clip = await db.clip.findUnique({ where: { id: params.id }, include: { job: true } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ clip: serialize(clip) });
}

const cueWordSchema = z.object({ start: z.number(), end: z.number(), text: z.string() });
const cueSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  words: z.array(cueWordSchema),
  editedText: z.string().nullable().optional(),
  deleted: z.boolean().optional(),
});
const customTextSchema = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  fontName: z.string(),
  fontSize: z.number().positive(),
  colorHex: z.string().regex(/^[0-9a-fA-F]{6}$/, "Color inválido, usa formato RRGGBB"),
  uppercase: z.boolean().optional(),
});

const editSchema = z.object({
  captionCues: z.array(cueSchema).optional(),
  customTexts: z.array(customTextSchema).optional(),
  // Recorte (trim) del editor: nuevos límites absolutos sobre el vídeo fuente. El cliente ya
  // manda captionCues/customTexts con los tiempos re-desplazados para seguir alineados con el
  // nuevo inicio — este endpoint solo persiste los valores, no hace ningún cálculo de recorte.
  effectiveStartSec: z.number().min(0).optional(),
  endSec: z.number().min(0).optional(),
});

/** Guarda los subtítulos editados/borrados y los textos personalizados del editor (sin regenerar el vídeo todavía). */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const clip = await db.clip.findUnique({ where: { id: params.id } });
  if (!clip) {
    return NextResponse.json({ error: "Clip no encontrado" }, { status: 404 });
  }

  const newStart = parsed.data.effectiveStartSec ?? clip.effectiveStartSec ?? clip.startSec;
  const newEnd = parsed.data.endSec ?? clip.endSec;
  if (newEnd - newStart < 0.5) {
    return NextResponse.json({ error: "El recorte es demasiado corto (mínimo medio segundo)" }, { status: 400 });
  }

  const updated = await db.clip.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.captionCues !== undefined && { captionCues: JSON.stringify(parsed.data.captionCues) }),
      ...(parsed.data.customTexts !== undefined && { customTexts: JSON.stringify(parsed.data.customTexts) }),
      ...(parsed.data.effectiveStartSec !== undefined && { effectiveStartSec: parsed.data.effectiveStartSec }),
      ...(parsed.data.endSec !== undefined && { endSec: parsed.data.endSec }),
    },
  });

  return NextResponse.json({ clip: serialize(updated) });
}
