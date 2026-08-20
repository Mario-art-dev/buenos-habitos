import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { removeAccount } from "@/lib/social/accounts";
import { config } from "@/lib/config";
import { getRequestOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accounts = await db.socialAccount.findMany({
    select: { platform: true, accountName: true, accountId: true, updatedAt: true },
  });
  // La pantalla de Ajustes necesita saber, sin que el usuario tenga que ir al README: si ya hay
  // credenciales puestas en el .env, y la URL exacta de redirección que hay que dar de alta en
  // Google/TikTok AHORA MISMO (cambia cada reinicio del "Servidor temporal", ver requestOrigin.ts).
  const origin = getRequestOrigin(req);
  return NextResponse.json({
    accounts,
    oauth: {
      youtubeConfigured: !!(config.google.clientId && config.google.clientSecret),
      tiktokConfigured: !!(config.tiktok.clientKey && config.tiktok.clientSecret),
      youtubeCallbackUrl: `${origin}/api/auth/youtube/callback`,
      tiktokCallbackUrl: `${origin}/api/auth/tiktok/callback`,
    },
  });
}

const disconnectSchema = z.object({ platform: z.enum(["YOUTUBE", "TIKTOK"]) });

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = disconnectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Plataforma inválida" }, { status: 400 });
  }
  await removeAccount(parsed.data.platform);
  return NextResponse.json({ ok: true });
}
