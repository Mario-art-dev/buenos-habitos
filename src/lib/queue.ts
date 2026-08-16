import { db } from "@/lib/db";

/** Cola muy simple respaldada por la tabla Job: el worker hace polling de trabajos PENDING. */
export async function claimNextPendingJob(): Promise<{ id: string } | null> {
  const job = await db.job.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  return job;
}
