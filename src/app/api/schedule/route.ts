import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAutoPublishSettings, updateAutoPublishSettings } from "@/lib/schedule/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getAutoPublishSettings();
  return NextResponse.json({ settings });
}

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["OFF", "INTERVAL", "WINDOW"]).optional(),
  intervalHours: z.number().min(0.5).max(168).optional(),
  platforms: z.array(z.enum(["YOUTUBE", "TIKTOK"])).optional(),
  spreadWithinWindow: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const settings = await updateAutoPublishSettings(parsed.data);
  return NextResponse.json({ settings });
}
