import { NextRequest, NextResponse } from "next/server";
import { planLessons } from "@/lib/study/generate";
import type { AIImage } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      subject?: string;
      topic?: string;
      text?: string;
      images?: AIImage[];
      chunkInfo?: string;
    };
    const subject = body.subject?.trim();
    if (!subject) return NextResponse.json({ error: "Falta la asignatura." }, { status: 400 });
    if (!body.text?.trim() && !body.images?.length) {
      return NextResponse.json({ error: "No hay material para estudiar." }, { status: 400 });
    }
    const plan = await planLessons({
      subject,
      topicHint: body.topic?.trim(),
      text: (body.text ?? "").slice(0, 40_000),
      images: (body.images ?? []).slice(0, 6),
      chunkInfo: body.chunkInfo,
    });
    return NextResponse.json(plan);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
