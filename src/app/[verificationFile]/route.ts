import { NextResponse } from "next/server";

// La URL pública cambia cada vez que se reinicia el "Servidor temporal" (túnel de Cloudflare), así
// que cada vez que hay que (re)verificar el dominio en TikTok for Developers piden un código de
// verificación NUEVO y hay que servirlo en /tiktok{codigo}.txt — en vez de ir subiendo un archivo
// estático distinto cada vez (y teniendo que reiniciar el servidor solo para eso), esta ruta
// genera la respuesta al vuelo para cualquier código que pidan, sin volver a tocar el código.
const TIKTOK_VERIFICATION_FILE = /^tiktok([A-Za-z0-9]+)\.txt$/;

export async function GET(_req: Request, { params }: { params: { verificationFile: string } }) {
  const match = TIKTOK_VERIFICATION_FILE.exec(params.verificationFile);
  if (!match) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const code = match[1];
  return new NextResponse(`tiktok-developers-site-verification=${code}`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
