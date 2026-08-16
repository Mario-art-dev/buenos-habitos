import { db } from "@/lib/db";
import type { AutoPublishMode, Platform } from "@/lib/types";

const SETTINGS_ID = 1;

export interface AutoPublishSettingsView {
  enabled: boolean;
  mode: AutoPublishMode;
  intervalHours: number;
  platforms: Platform[];
  spreadWithinWindow: boolean;
  nextRunAt: Date | null;
}

export async function getAutoPublishSettings(): Promise<AutoPublishSettingsView> {
  const row = await db.autoPublishSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
  return {
    enabled: row.enabled,
    mode: row.mode as AutoPublishMode,
    intervalHours: row.intervalHours,
    platforms: JSON.parse(row.platforms) as Platform[],
    spreadWithinWindow: row.spreadWithinWindow,
    nextRunAt: row.nextRunAt,
  };
}

export async function updateAutoPublishSettings(input: {
  enabled?: boolean;
  mode?: AutoPublishMode;
  intervalHours?: number;
  platforms?: Platform[];
  spreadWithinWindow?: boolean;
}): Promise<AutoPublishSettingsView> {
  const current = await getAutoPublishSettings();

  const data: Record<string, unknown> = {};
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.mode !== undefined) data.mode = input.mode;
  if (input.intervalHours !== undefined) data.intervalHours = input.intervalHours;
  if (input.platforms !== undefined) data.platforms = JSON.stringify(input.platforms);
  if (input.spreadWithinWindow !== undefined) data.spreadWithinWindow = input.spreadWithinWindow;

  // Al activar el modo intervalo (o cambiar las horas), reprograma el próximo disparo desde ahora.
  const turningOn = input.enabled === true && !current.enabled;
  const intervalChanged = input.intervalHours !== undefined && input.intervalHours !== current.intervalHours;
  if ((turningOn || intervalChanged) && (input.mode ?? current.mode) === "INTERVAL") {
    const hours = input.intervalHours ?? current.intervalHours;
    data.nextRunAt = new Date(Date.now() + hours * 3600_000);
  }

  await db.autoPublishSettings.update({ where: { id: SETTINGS_ID }, data });
  return getAutoPublishSettings();
}

export function listScheduleWindows() {
  return db.scheduleWindow.findMany({ orderBy: [{ dayOfWeek: "asc" }, { startHour: "asc" }] });
}

export function createScheduleWindow(input: {
  dayOfWeek: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}) {
  return db.scheduleWindow.create({ data: input });
}

export function deleteScheduleWindow(id: string) {
  return db.scheduleWindow.delete({ where: { id } });
}
