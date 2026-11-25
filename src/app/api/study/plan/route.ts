import { NextRequest, NextResponse } from "next/server";
import { planClips } from "@/lib/study/generate";
import type { AIImage } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Analiza una sección del documento y devuelve los clips que hacen falta para explicarla entera.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      subject?: string;
      topic?: string;
      sectionText?: string;
      sectionIndex: number;
      totalSections: number;
      images?: AIImage[];
    };
    const subject = body.subject?.trim();
    if (!subject) return NextResponse.json({ error: "Falta la asignatura." }, { status: 400 });
    const clips = await planClips({
      subject,
      topic: body.topic?.trim() || "",
      sectionText: (body.sectionText ?? "").slice(0, 14_000),
      sectionIndex: body.sectionIndex,
      totalSections: body.totalSections,
      images: (body.images ?? []).slice(0, 4),
    });
    return NextResponse.json({ clips });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
