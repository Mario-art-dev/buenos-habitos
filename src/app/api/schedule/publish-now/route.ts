import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publishImmediately } from "@/lib/schedule/scheduler";

export const dynamic = "force-dynamic";

const publishNowSchema = z.object({
  count: z.number().int().min(1).max(500),
});

/**
 * Sección "Publicar de inmediato" de la Galería: sube AHORA MISMO (sin esperar a ninguna hora
 * programada) los N shorts más antiguos de la galería a las plataformas conectadas — ver
 * publishImmediately en scheduler.ts.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = publishNowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Cantidad inválida" }, { status: 400 });
  }

  try {
    const result = await publishImmediately(parsed.data.count);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
