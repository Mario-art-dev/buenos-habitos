import { db } from "@/lib/db";

/** Cola muy simple respaldada por la tabla Job: el worker hace polling de trabajos PENDING. */
export async function claimNextPendingJob(): Promise<{ id: string } | null> {
  // deletedAt: null — un trabajo borrado con la X (ver JobList.tsx) puede seguir en PENDING si se
  // borró justo mientras esperaba turno; sin este filtro el worker lo procesaría igual, gastando
  // tiempo/IA en algo que el usuario ya descartó.
  const job = await db.job.findFirst({
    where: { status: "PENDING", deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return job;
}
