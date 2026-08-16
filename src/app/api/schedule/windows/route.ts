import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listScheduleWindows, createScheduleWindow } from "@/lib/schedule/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const windows = await listScheduleWindows();
  return NextResponse.json({ windows });
}

const createSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const totalStart = parsed.data.startHour * 60 + parsed.data.startMinute;
  const totalEnd = parsed.data.endHour * 60 + parsed.data.endMinute;
  if (totalEnd <= totalStart) {
    return NextResponse.json({ error: "La hora de fin debe ser posterior a la de inicio" }, { status: 400 });
  }
  const window = await createScheduleWindow(parsed.data);
  return NextResponse.json({ window }, { status: 201 });
}
