import { NextResponse } from "next/server";
import { getStorageQuotaStatus } from "@/lib/storageQuota";

export const dynamic = "force-dynamic";

/** Consultado por el banner de aviso de almacenamiento (ver StorageQuotaBanner.tsx), en todas las páginas. */
export async function GET() {
  const status = await getStorageQuotaStatus();
  return NextResponse.json(status);
}
