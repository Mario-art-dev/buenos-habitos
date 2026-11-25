import { NextRequest, NextResponse } from "next/server";
import { speechWav, voiceAvailable } from "@/lib/study/tts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "Falta el texto." }, { status: 400 });
  if (!voiceAvailable()) return NextResponse.json({ error: "voice_unavailable" }, { status: 503 });
  try {
    const wav = await speechWav(text);
    return new NextResponse(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
