import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeVideo, type ClipBrief } from "@/lib/study/generate";
import type { AIImage } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Crea UN clip explicado. La web los lanza varios a la vez.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      subject?: string;
      topic?: string;
      clip: ClipBrief;
      index: number;
      total: number;
      images?: AIImage[];
    };
    const subject = body.subject?.trim();
    if (!subject || !body.clip?.keyFacts?.length) {
      return NextResponse.json({ error: "Datos incompletos." }, { status: 400 });
    }
    const topic = body.topic?.trim() || subject;
    const script = await writeVideo({
      clip: body.clip,
      index: body.index,
      total: body.total,
      subject,
      topic,
      images: (body.images ?? []).slice(0, 3),
    });
    const video = await db.studyVideo.create({
      data: {
        subject,
        topic,
        title: String(script.title || body.clip.title).slice(0, 120),
        order: body.index,
        script: JSON.stringify(script),
      },
    });
    return NextResponse.json(video);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
