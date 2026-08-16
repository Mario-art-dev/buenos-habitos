import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { removeAccount } from "@/lib/social/accounts";

export async function GET() {
  const accounts = await db.socialAccount.findMany({
    select: { platform: true, accountName: true, accountId: true, updatedAt: true },
  });
  return NextResponse.json({ accounts });
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
