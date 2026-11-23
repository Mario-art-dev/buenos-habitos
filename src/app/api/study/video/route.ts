import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeVideo, type Lesson } from "@/lib/study/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      subject: string;
      topic: string;
      lesson: Lesson;
      index: number;
      total: number;
      order: number;
    };
    if (!body.subject || !body.lesson?.keyFacts?.length) {
      return NextResponse.json({ error: "Datos incompletos." }, { status: 400 });
    }
    const script = await writeVideo(body);
    const video = await db.studyVideo.create({
      data: {
        subject: body.subject.trim(),
        topic: body.topic,
        title: String(script.title || body.lesson.title).slice(0, 120),
        order: body.order ?? 0,
        script: JSON.stringify(script),
      },
    });
    return NextResponse.json(video);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
