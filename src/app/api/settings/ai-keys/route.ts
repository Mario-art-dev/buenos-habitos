import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiKeyStatuses, saveAiKey, removeAiKey } from "@/lib/ai/credentials";

export const dynamic = "force-dynamic";

/** Para Ajustes: qué proveedores de IA tienen clave y de dónde viene (nunca el valor, por seguridad). */
export async function GET() {
  const statuses = await aiKeyStatuses();
  return NextResponse.json({ statuses });
}

const providerEnum = z.enum(["gemini", "groq", "cerebras", "mistral", "anthropic", "openai"]);

const saveSchema = z.object({
  provider: providerEnum,
  apiKey: z.string().trim().min(1, "Pega la clave antes de guardar"),
});

/** Guarda (o sustituye) la clave de un proveedor pegada desde Ajustes — alternativa a poner un secreto en GitHub. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  await saveAiKey(parsed.data.provider, parsed.data.apiKey);
  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ provider: providerEnum });

/** Quita la clave guardada desde Ajustes para ese proveedor (si además hay variable de entorno, se vuelve a usar esa). */
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Proveedor inválido" }, { status: 400 });
  }
  await removeAiKey(parsed.data.provider);
  return NextResponse.json({ ok: true });
}
