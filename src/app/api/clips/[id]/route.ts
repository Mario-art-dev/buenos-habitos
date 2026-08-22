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
  job?: { sourceFilePath: string | null; mode: string };
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
    coverImageUrl: toMediaUrl(clip.coverImagePath as string | null),
    // Vídeo fuente original (sin recortar/verticalizar) — lo usa el editor para la vista previa en
    // vivo con Remotion, recortando en el navegador el mismo tramo [effectiveStartSec, endSec] que
    // ya se usa para renderizar de verdad, sin gastar otro render de servidor solo para previsualizar.
    sourceVideoUrl: job ? toMediaUrl(job.sourceFilePath) : null,
    // La portada (coverCard.ts) solo existe en SINGLE/SPLIT — el editor la muestra solo entonces.
    jobMode: job?.mode ?? null,
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
const cueStyleSchema = z.object({
  fontName: z.string().optional(),
  fontSize: z.number().positive().optional(),
  colorHex: z.string().regex(/^[0-9a-fA-F]{6}$/, "Color inválido, usa formato RRGGBB").optional(),
  xPct: z.number().min(0).max(100).optional(),
  yPct: z.number().min(0).max(100).optional(),
});
const cueSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  words: z.array(cueWordSchema),
  editedText: z.string().nullable().optional(),
  deleted: z.boolean().optional(),
  style: cueStyleSchema.nullable().optional(),
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
  // Portada (solo SINGLE/SPLIT): fotograma elegido a mano (absoluto sobre el vídeo fuente, debe
  // caer dentro del propio clip) y/o título propio a quemar encima. null explícito = volver al
  // valor por defecto (ver coverCard.ts / regenerateClip.ts).
  coverFrameSec: z.number().min(0).nullable().optional(),
  coverTitle: z.string().max(200).nullable().optional(),
  // Subtítulos grandes: se puede desactivar sin perder las cues guardadas (por si se reactivan).
  captionsEnabled: z.boolean().optional(),
  // Metadatos de publicación: no están quemados en el vídeo (salvo coverTitle, que es aparte),
  // así que se guardan sin necesidad de regenerar nada.
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  hashtags: z.array(z.string().min(1).max(50)).max(30).optional(),
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

  if (
    parsed.data.coverFrameSec != null &&
    (parsed.data.coverFrameSec < newStart || parsed.data.coverFrameSec > newEnd)
  ) {
    return NextResponse.json({ error: "El fotograma de portada tiene que estar dentro del clip" }, { status: 400 });
  }

  const updated = await db.clip.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.captionCues !== undefined && { captionCues: JSON.stringify(parsed.data.captionCues) }),
      ...(parsed.data.customTexts !== undefined && { customTexts: JSON.stringify(parsed.data.customTexts) }),
      ...(parsed.data.effectiveStartSec !== undefined && { effectiveStartSec: parsed.data.effectiveStartSec }),
      ...(parsed.data.endSec !== undefined && { endSec: parsed.data.endSec }),
      ...(parsed.data.coverFrameSec !== undefined && { coverFrameSec: parsed.data.coverFrameSec }),
      ...(parsed.data.coverTitle !== undefined && { coverTitle: parsed.data.coverTitle }),
      ...(parsed.data.captionsEnabled !== undefined && { captionsEnabled: parsed.data.captionsEnabled }),
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.hashtags !== undefined && { hashtags: JSON.stringify(parsed.data.hashtags) }),
    },
  });

  return NextResponse.json({ clip: serialize(updated) });
}
