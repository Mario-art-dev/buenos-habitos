import { db } from "@/lib/db";
import { getAutoPublishSettings, listScheduleWindows } from "./settings";
import { publishClip } from "@/lib/social/publish";
import type { Platform } from "@/lib/types";

const MIN_SPACING_SECONDS = 5 * 60; // no repartir a menos de 5 min entre subidas dentro de una franja

async function connectedPlatforms(candidates: Platform[]): Promise<Platform[]> {
  const accounts = await db.socialAccount.findMany({ where: { platform: { in: candidates } } });
  const connected = new Set(accounts.map((a) => a.platform));
  return candidates.filter((p) => connected.has(p));
}

async function nextEligibleClips(limit: number) {
  // job.deletedAt: null — un clip cuyo trabajo se borró con la X (ver JobList.tsx) no debe
  // programarse para publicar: su archivo de vídeo ya no existe en disco.
  return db.clip.findMany({
    where: { status: "READY", autoPublishedAt: null, job: { deletedAt: null } },
    orderBy: { viralityScore: "desc" },
    take: limit,
  });
}

const HOURS_PER_DAY = 24;

export interface PublishAllResult {
  scheduledClips: number;
  firstAt: Date | null;
  lastAt: Date | null;
  platforms: Platform[];
  perHour: number;
}

/**
 * Botón "Configurar horarios" de la Galería: programa TODOS los shorts listos que aún no se han
 * publicado ni tienen ya una tarea pendiente, repartidos EQUITATIVAMENTE entre las 24 horas del
 * día — no un número fijo por hora, sino el total actual de la galería dividido entre 24 (p.ej.
 * 48 shorts = 2/hora, 72 = 3/hora, 120 = 5/hora); si no es divisible exacto, las horas iniciales
 * absorben 1 extra cada una hasta agotar el resto, para que la suma cuadre siempre con el total
 * real — pedido explícito, en vez de un ritmo fijo (antes 2/hora) que no se adaptaba a cuántos
 * shorts hay realmente esperando. Reutiliza el mismo mecanismo de AutoPublishTask que ya procesa
 * processDueTasks() cada minuto, así que funciona sea cual sea el estado de enabled/mode de la
 * programación automática normal (INTERVAL/WINDOW) — son dos vías independientes hacia la misma
 * cola de tareas.
 */
export async function scheduleAllReadyClips(): Promise<PublishAllResult> {
  const settings = await getAutoPublishSettings();
  const platforms = await connectedPlatforms(settings.platforms);
  if (platforms.length === 0) {
    throw new Error("No tienes ninguna plataforma conectada (YouTube/TikTok) en Ajustes.");
  }

  const alreadyPending = await db.autoPublishTask.findMany({
    where: { status: "PENDING" },
    select: { clipId: true },
  });
  const pendingClipIds = new Set(alreadyPending.map((t) => t.clipId));

  const eligible = (await nextEligibleClips(2000)).filter((c) => !pendingClipIds.has(c.id));
  if (eligible.length === 0) {
    return { scheduledClips: 0, firstAt: null, lastAt: null, platforms, perHour: 0 };
  }

  const perHourBase = Math.floor(eligible.length / HOURS_PER_DAY);
  const extraHours = eligible.length % HOURS_PER_DAY; // las primeras `extraHours` horas llevan 1 short de más

  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1); // próxima hora en punto

  let clipIndex = 0;
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;

  for (let hour = 0; hour < HOURS_PER_DAY && clipIndex < eligible.length; hour++) {
    const slot = new Date(start.getTime() + hour * 3600_000);
    const countInSlot = perHourBase + (hour < extraHours ? 1 : 0);
    for (let i = 0; i < countInSlot && clipIndex < eligible.length; i++, clipIndex++) {
      const clip = eligible[clipIndex];
      if (!firstAt) firstAt = slot;
      lastAt = slot;
      for (const platform of platforms) {
        await db.autoPublishTask.create({
          data: { clipId: clip.id, platform, scheduledAt: slot, status: "PENDING" },
        });
      }
    }
  }

  return { scheduledClips: eligible.length, firstAt, lastAt, platforms, perHour: perHourBase + (extraHours > 0 ? 1 : 0) };
}

export interface PublishNowResult {
  scheduledTasks: number;
  clipsAffected: number;
  platforms: Platform[];
}

/**
 * Sección "Publicar de inmediato" de la Galería: el usuario elige una cantidad N y se suben AHORA
 * MISMO (sin esperar a ninguna hora programada) los N shorts más antiguos de la galería — los
 * primeros que entraron, orden FIFO por createdAt — a todas las plataformas conectadas. Si un clip
 * ya se había publicado a mano en alguna plataforma antes, no se vuelve a subir ahí (evita
 * duplicados); solo se sube a las plataformas que todavía le faltan.
 *
 * IMPORTANTE: esto NO publica de verdad dentro de la petición — llamar a publishClip() en serie
 * para cada clip/plataforma (subida real a YouTube/TikTok, puede tardar bastante por vídeo) casi
 * seguro que supera lo que aguanta abierta una sola petición el túnel gratuito en cuanto N pasa de
 * 1 o 2, dando el mismo "Load failed" ya arreglado en publish/regenerate/música — con el
 * agravante de que aquí serían N subidas reales en cola, no solo una. En vez de eso se crean
 * tareas AutoPublishTask con scheduledAt = ahora mismo, y el mismo procesador que ya usa
 * "Configurar horarios" (processDueTasks, llamado cada minuto desde el worker) las recoge y
 * publica solas en segundo plano — la ruta responde al instante con cuántas se encolaron.
 */
export async function publishImmediately(count: number): Promise<PublishNowResult> {
  const settings = await getAutoPublishSettings();
  const platforms = await connectedPlatforms(settings.platforms);
  if (platforms.length === 0) {
    throw new Error("No tienes ninguna plataforma conectada (YouTube/TikTok) en Ajustes.");
  }

  const clips = await db.clip.findMany({
    where: { status: "READY", job: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    take: count,
    include: { publications: { where: { status: { in: ["PUBLISHED", "DRAFT"] } } } },
  });

  const alreadyPending = await db.autoPublishTask.findMany({
    where: { status: "PENDING", clipId: { in: clips.map((c) => c.id) } },
    select: { clipId: true, platform: true },
  });
  const pendingKey = (clipId: string, platform: string) => `${clipId}:${platform}`;
  const pendingSet = new Set(alreadyPending.map((t) => pendingKey(t.clipId, t.platform)));

  const now = new Date();
  let scheduledTasks = 0;
  let clipsAffected = 0;
  for (const clip of clips) {
    const alreadyDone = new Set(clip.publications.map((p) => p.platform));
    const toSchedule = platforms.filter((p) => !alreadyDone.has(p) && !pendingSet.has(pendingKey(clip.id, p)));
    if (toSchedule.length === 0) continue;
    clipsAffected++;
    for (const platform of toSchedule) {
      await db.autoPublishTask.create({ data: { clipId: clip.id, platform, scheduledAt: now, status: "PENDING" } });
      scheduledTasks++;
    }
  }

  return { scheduledTasks, clipsAffected, platforms };
}

async function runIntervalMode(intervalHours: number, platforms: Platform[], nextRunAt: Date | null) {
  const now = new Date();
  if (nextRunAt && now < nextRunAt) return;

  const [clip] = await nextEligibleClips(1);
  if (clip) {
    for (const platform of platforms) {
      await publishClip(clip.id, platform);
    }
  }

  await db.autoPublishSettings.update({
    where: { id: 1 },
    data: { nextRunAt: new Date(now.getTime() + intervalHours * 3600_000) },
  });
}

function findActiveWindow(windows: Awaited<ReturnType<typeof listScheduleWindows>>, now: Date) {
  const day = now.getDay();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return windows.find((w) => {
    if (w.dayOfWeek !== day) return false;
    const start = w.startHour * 60 + w.startMinute;
    const end = w.endHour * 60 + w.endMinute;
    return minutesNow >= start && minutesNow < end;
  });
}

async function runWindowMode(platforms: Platform[], spread: boolean, lastWindowKey: string | null) {
  const now = new Date();
  const windows = await listScheduleWindows();
  const active = findActiveWindow(windows, now);
  if (!active) return;

  const todayKey = now.toISOString().slice(0, 10);
  const windowKey = `${active.id}:${todayKey}`;
  if (windowKey === lastWindowKey) return; // esta franja de hoy ya se procesó

  const eligible = await nextEligibleClips(50);
  if (eligible.length === 0) {
    await db.autoPublishSettings.update({ where: { id: 1 }, data: { lastWindowKey: windowKey } });
    return;
  }

  const windowEnd = new Date(now);
  windowEnd.setHours(active.endHour, active.endMinute, 0, 0);
  const remainingSeconds = Math.max(0, (windowEnd.getTime() - now.getTime()) / 1000);
  const spacing = spread ? Math.max(MIN_SPACING_SECONDS, remainingSeconds / eligible.length) : 0;

  let offset = 0;
  for (const clip of eligible) {
    const scheduledAt = new Date(now.getTime() + Math.min(offset, remainingSeconds) * 1000);
    for (const platform of platforms) {
      await db.autoPublishTask.create({
        data: { clipId: clip.id, platform, scheduledAt, status: "PENDING" },
      });
    }
    offset += spacing;
  }

  await db.autoPublishSettings.update({ where: { id: 1 }, data: { lastWindowKey: windowKey } });
}

async function processDueTasks() {
  const due = await db.autoPublishTask.findMany({
    where: { status: "PENDING", scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    take: 5,
  });

  for (const task of due) {
    const result = await publishClip(task.clipId, task.platform as Platform);
    await db.autoPublishTask.update({
      where: { id: task.id },
      data: { status: result.ok ? "DONE" : "FAILED", error: result.error },
    });
  }
}

export async function schedulerTick(): Promise<void> {
  const settings = await getAutoPublishSettings();
  await processDueTasks();

  if (!settings.enabled) return;
  const platforms = await connectedPlatforms(settings.platforms);
  if (platforms.length === 0) return;

  if (settings.mode === "INTERVAL") {
    await runIntervalMode(settings.intervalHours, platforms, settings.nextRunAt);
  } else if (settings.mode === "WINDOW") {
    const raw = await db.autoPublishSettings.findUnique({ where: { id: 1 } });
    await runWindowMode(platforms, settings.spreadWithinWindow, raw?.lastWindowKey ?? null);
  }
}
