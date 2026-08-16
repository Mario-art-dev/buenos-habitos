import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { claimNextPendingJob } from "@/lib/queue";
import { processJob } from "@/lib/pipeline/runPipeline";

let running = false;

async function tick() {
  if (running) return;
  const job = await claimNextPendingJob();
  if (!job) return;

  running = true;
  console.log(`[worker] procesando job ${job.id}`);
  try {
    await processJob(job.id);
    console.log(`[worker] job ${job.id} completado`);
  } catch (err) {
    console.error(`[worker] job ${job.id} falló:`, (err as Error).message);
  } finally {
    running = false;
  }
}

async function main() {
  console.log("[worker] Escenas Virales Studio — worker iniciado");
  // recupera jobs que quedaron a medias si el worker se reinició
  await db.job.updateMany({
    where: { status: { in: ["DOWNLOADING", "TRANSCRIBING", "ANALYZING", "CLIPPING"] } },
    data: { status: "PENDING", statusMessage: "Reintentando tras reinicio del worker…" },
  });

  setInterval(tick, config.pipeline.workerPollIntervalMs);
  tick();
}

main().catch((err) => {
  console.error("[worker] error fatal:", err);
  process.exit(1);
});
