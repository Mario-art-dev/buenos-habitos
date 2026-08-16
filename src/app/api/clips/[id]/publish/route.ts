import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publishClip } from "@/lib/social/publish";

export const dynamic = "force-dynamic";

const publishSchema = z.object({
  platform: z.enum(["YOUTUBE", "TIKTOK"]),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Plataforma inválida" }, { status: 400 });
  }

  const result = await publishClip(params.id, parsed.data.platform);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    publication: {
      id: result.publicationId,
      platform: parsed.data.platform,
      status: result.status,
      remoteUrl: result.remoteUrl,
    },
    note: result.note,
  });
}
