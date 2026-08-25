import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { claimNextPendingJob } from "@/lib/queue";
import { processJob } from "@/lib/pipeline/runPipeline";
import { schedulerTick } from "@/lib/schedule/scheduler";

let processingJob = false;
let runningScheduler = false;

async function jobTick() {
  if (processingJob) return;
  const job = await claimNextPendingJob();
  if (!job) return;

  processingJob = true;
  console.log(`[worker] procesando job ${job.id}`);
  try {
    await processJob(job.id);
    console.log(`[worker] job ${job.id} completado`);
  } catch (err) {
    console.error(`[worker] job ${job.id} falló:`, (err as Error).message);
  } finally {
    processingJob = false;
  }
}

async function schedulerTickSafe() {
  if (runningScheduler) return;
  runningScheduler = true;
  try {
    await schedulerTick();
  } catch (err) {
    console.error("[worker] error en el planificador automático:", (err as Error).message);
  } finally {
    runningScheduler = false;
  }
}

async function main() {
  console.log("[worker] Escenas Virales Studio — worker iniciado");
  // Recupera jobs que quedaron a medias si el worker se reinició, y también reintenta
  // automáticamente los que se quedaron en FAILED — pedido explícito: al arrancar una nueva
  // sesión de 6h no hay que esperar a que el usuario pulse "Reintentar" a mano. claimNextPendingJob()
  // los recoge de uno en uno por orden de creación, así que tras reintentar este ya sigue solo con
  // el resto de la cola sin ningún cambio adicional.
  await db.job.updateMany({
    where: { status: { in: ["DOWNLOADING", "TRANSCRIBING", "ANALYZING", "CLIPPING", "FAILED"] } },
    data: { status: "PENDING", error: null, statusMessage: "Reintentando automáticamente tras reinicio de la sesión…" },
  });

  setInterval(jobTick, config.pipeline.workerPollIntervalMs);
  setInterval(schedulerTickSafe, config.scheduler.pollIntervalMs);
  jobTick();
  schedulerTickSafe();
}

main().catch((err) => {
  console.error("[worker] error fatal:", err);
  process.exit(1);
});
