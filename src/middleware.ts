import { NextRequest, NextResponse } from "next/server";
import { isValidSessionToken, sessionCookie } from "@/lib/auth";
import { config } from "@/lib/config";

// /terms y /privacy tienen que ser públicas: TikTok/Google las piden como URL de Términos y
// Política de privacidad al configurar la app, y sus sistemas (y cualquier revisor humano) las
// visitan sin conocer la contraseña de la app.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/terms", "/privacy"];

// El archivo de verificación de dominio de TikTok for Developers (en public/, nombre tipo
// "tiktokXXXX.txt") hay que volver a generarlo cada vez que cambia la URL del túnel (cada
// reinicio del "Servidor temporal") — en vez de acordarse de añadir cada nombre nuevo a mano al
// middleware, se deja pasar cualquier archivo con ese patrón de nombre automáticamente.
const TIKTOK_VERIFICATION_FILE = /^\/tiktok[A-Za-z0-9]+\.txt$/;

export async function middleware(req: NextRequest) {
  if (!config.appPassword) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p) ||
    pathname.startsWith("/_next") ||
    TIKTOK_VERIFICATION_FILE.test(pathname);
  if (isPublic) {
    return NextResponse.next();
  }

  const token = req.cookies.get(sessionCookie.name)?.value;
  if (await isValidSessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config_ = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export { config_ as config };
