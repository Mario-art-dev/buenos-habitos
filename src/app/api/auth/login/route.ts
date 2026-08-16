import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionToken, sessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!checkPassword(password ?? "")) {
    return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie.name, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionCookie.maxAgeSeconds,
    path: "/",
  });
  return res;
}
