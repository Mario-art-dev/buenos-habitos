import { NextRequest, NextResponse } from "next/server";
import { isValidSessionToken, sessionCookie } from "@/lib/auth";
import { config } from "@/lib/config";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function middleware(req: NextRequest) {
  if (!config.appPassword) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith("/_next");
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
