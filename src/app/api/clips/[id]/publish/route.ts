import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publishClip } from "@/lib/social/publish";

export const dynamic = "force-dynamic";

const publishSchema = z.object({
  platform: z.enum(["YOUTUBE", "TIKTOK"]),
});

/**
 * Subir el vídeo a TikTok/YouTube (varias llamadas a su API + subir el archivo) puede tardar más
 * de lo que aguanta abierta una sola petición el túnel gratuito de Cloudflare — si el navegador
 * se queda esperando aquí mismo a que termine, a mitad de camino llega un 502 y el móvil lo ve
 * como un error nativo sin sentido ("The string did not match the expected pattern.", visto en
 * real: era Safari sin poder leer la página de error de Cloudflare como JSON). Por eso esta ruta
 * responde AL INSTANTE en cuanto arranca la publicación, y la subida de verdad sigue en segundo
 * plano en el servidor; el cliente (ClipCard) pregunta el resultado con GET /api/clips/[id] en vez
 * de depender de mantener esta única petición abierta todo el rato.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Plataforma inválida" }, { status: 400 });
  }

  publishClip(params.id, parsed.data.platform).catch((err) => {
    console.error(`[publish] fallo en segundo plano publicando en ${parsed.data.platform} el clip ${params.id}:`, err);
  });

  return NextResponse.json({ started: true });
}
