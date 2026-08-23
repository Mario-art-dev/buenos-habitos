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
  return db.clip.findMany({
    where: { status: "READY", autoPublishedAt: null },
    orderBy: { viralityScore: "desc" },
    take: limit,
  });
}

const PUBLISH_ALL_PER_HOUR = 2;

export interface PublishAllResult {
  scheduledClips: number;
  firstAt: Date | null;
  lastAt: Date | null;
  platforms: Platform[];
}

/**
 * Botón "Publicar todos" de la Galería: programa TODOS los shorts listos que aún no se han
 * publicado ni tienen ya una tarea pendiente, repartidos cada hora en punto (2 shorts por hora,
 * empezando en la próxima hora en punto) — pedido explícito, en vez de depender de que el usuario
 * configure franjas horarias a mano. Reutiliza el mismo mecanismo de AutoPublishTask que ya
 * procesa processDueTasks() cada minuto, así que funciona sea cual sea el estado de
 * enabled/mode de la programación automática normal (INTERVAL/WINDOW) — son dos vías independientes
 * hacia la misma cola de tareas.
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
    return { scheduledClips: 0, firstAt: null, lastAt: null, platforms };
  }

  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1); // próxima hora en punto

  let slot = new Date(start);
  let countInSlot = 0;
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;

  for (const clip of eligible) {
    if (countInSlot >= PUBLISH_ALL_PER_HOUR) {
      slot = new Date(slot.getTime() + 3600_000);
      countInSlot = 0;
    }
    if (!firstAt) firstAt = slot;
    lastAt = slot;
    for (const platform of platforms) {
      await db.autoPublishTask.create({
        data: { clipId: clip.id, platform, scheduledAt: slot, status: "PENDING" },
      });
    }
    countInSlot++;
  }

  return { scheduledClips: eligible.length, firstAt, lastAt, platforms };
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
