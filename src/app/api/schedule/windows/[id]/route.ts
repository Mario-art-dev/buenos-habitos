import { NextResponse } from "next/server";
import { deleteScheduleWindow } from "@/lib/schedule/settings";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await deleteScheduleWindow(params.id);
  return NextResponse.json({ ok: true });
}
