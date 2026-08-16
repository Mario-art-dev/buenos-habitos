import { db } from "@/lib/db";

export async function setStatus(jobId: string, status: string, statusMessage?: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: { status, statusMessage },
  });
}
