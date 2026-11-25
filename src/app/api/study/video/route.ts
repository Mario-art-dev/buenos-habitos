import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeVideo, VIDEOS_PER_DOCUMENT } from "@/lib/study/generate";
import type { AIImage } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Crea UN vídeo (una de las 5 partes del temario). La web los lanza en paralelo.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      subject?: string;
      topic?: string;
      partIndex: number;
      text?: string;
      images?: AIImage[];
    };
    const subject = body.subject?.trim();
    if (!subject) return NextResponse.json({ error: "Falta la asignatura." }, { status: 400 });
    if (!body.text?.trim() && !body.images?.length) {
      return NextResponse.json({ error: "Esta parte no tiene material." }, { status: 400 });
    }
    const topic = body.topic?.trim() || subject;
    const script = await writeVideo({
      subject,
      topic,
      partIndex: body.partIndex,
      total: VIDEOS_PER_DOCUMENT,
      text: (body.text ?? "").slice(0, 30_000),
      images: (body.images ?? []).slice(0, 4),
    });
    const title = `${body.partIndex + 1}/${VIDEOS_PER_DOCUMENT} · ${String(script.title || "Lesson").slice(0, 100)}`;
    const video = await db.studyVideo.create({
      data: { subject, topic, title, order: body.partIndex, script: JSON.stringify(script) },
    });
    return NextResponse.json(video);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
