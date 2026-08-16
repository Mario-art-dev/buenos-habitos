import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const createJobSchema = z.object({
  url: z.string().url("Introduce una URL de vídeo válida"),
  mode: z.enum(["SINGLE", "RANKING"]).optional(),
});

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode");
  const jobs = await db.job.findMany({
    where: mode ? { mode } : undefined,
    orderBy: { createdAt: "desc" },
    include: { clips: { select: { id: true, viralityScore: true, status: true } } },
  });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "URL inválida" }, { status: 400 });
  }

  const job = await db.job.create({
    data: { sourceUrl: parsed.data.url, mode: parsed.data.mode ?? "SINGLE", status: "PENDING" },
  });

  return NextResponse.json({ job }, { status: 201 });
}
