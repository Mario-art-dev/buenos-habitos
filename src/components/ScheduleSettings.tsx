"use client";

import { useEffect, useState } from "react";

interface Settings {
  enabled: boolean;
  mode: "OFF" | "INTERVAL" | "WINDOW";
  intervalHours: number;
  platforms: ("YOUTUBE" | "TIKTOK")[];
  spreadWithinWindow: boolean;
}

interface Window {
  id: string;
  dayOfWeek: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function ScheduleSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [windows, setWindows] = useState<Window[]>([]);
  const [saving, setSaving] = useState(false);
  const [newWindow, setNewWindow] = useState({ dayOfWeek: 1, startHour: 12, startMinute: 0, endHour: 14, endMinute: 0 });

  async function load() {
    const [sRes, wRes] = await Promise.all([fetch("/api/schedule"), fetch("/api/schedule/windows")]);
    setSettings((await sRes.json()).settings);
    setWindows((await wRes.json()).windows);
  }

  useEffect(() => {
    load();
  }, []);

  async function update(patch: Partial<Settings>) {
    setSaving(true);
    const res = await fetch("/api/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    setSettings(data.settings);
    setSaving(false);
  }

  function togglePlatform(platform: "YOUTUBE" | "TIKTOK") {
    if (!settings) return;
    const has = settings.platforms.includes(platform);
    const platforms = has ? settings.platforms.filter((p) => p !== platform) : [...settings.platforms, platform];
    update({ platforms });
  }

  async function addWindow() {
    const res = await fetch("/api/schedule/windows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newWindow),
    });
    if (res.ok) load();
  }

  async function removeWindow(id: string) {
    await fetch(`/api/schedule/windows/${id}`, { method: "DELETE" });
    load();
  }

  if (!settings) return null;

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-800 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Programación automática</h2>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="h-4 w-4"
          />
          Activada
        </label>
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Publica automáticamente tus shorts pendientes (los mejor puntuados primero) en las plataformas conectadas.
      </p>

      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.platforms.includes("YOUTUBE")} onChange={() => togglePlatform("YOUTUBE")} />
          YouTube
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.platforms.includes("TIKTOK")} onChange={() => togglePlatform("TIKTOK")} />
          TikTok
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => update({ mode: "INTERVAL" })}
          className={`rounded-lg px-3 py-2 text-xs font-semibold ${settings.mode === "INTERVAL" ? "bg-brand-600 text-white" : "border border-ink-600 text-slate-300"}`}
        >
          Intervalo fijo
        </button>
        <button
          onClick={() => update({ mode: "WINDOW" })}
          className={`rounded-lg px-3 py-2 text-xs font-semibold ${settings.mode === "WINDOW" ? "bg-brand-600 text-white" : "border border-ink-600 text-slate-300"}`}
        >
          Franjas horarias
        </button>
      </div>

      {settings.mode === "INTERVAL" && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-slate-400">Subir un short a las plataformas seleccionadas cada</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={settings.intervalHours}
            onChange={(e) => update({ intervalHours: Number(e.target.value) })}
            className="w-20 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1"
          />
          <span className="text-slate-400">horas</span>
        </div>
      )}

      {settings.mode === "WINDOW" && (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={settings.spreadWithinWindow}
              onChange={(e) => update({ spreadWithinWindow: e.target.checked })}
            />
            Repartir las subidas dentro de la franja (recomendado) en vez de subirlas todas de golpe
          </label>

          <div className="space-y-2">
            {windows.length === 0 && <p className="text-xs text-slate-500">Todavía no has añadido ninguna franja.</p>}
            {windows.map((w) => (
              <div key={w.id} className="flex items-center justify-between rounded-lg border border-ink-600 px-3 py-2 text-xs">
                <span>
                  {DAYS[w.dayOfWeek]} {pad(w.startHour)}:{pad(w.startMinute)} – {pad(w.endHour)}:{pad(w.endMinute)}
                </span>
                <button onClick={() => removeWindow(w.id)} className="text-red-400 hover:underline">
                  Eliminar
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-600 p-3 text-xs">
            <select
              value={newWindow.dayOfWeek}
              onChange={(e) => setNewWindow({ ...newWindow, dayOfWeek: Number(e.target.value) })}
              className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-1"
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={`${pad(newWindow.startHour)}:${pad(newWindow.startMinute)}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                setNewWindow({ ...newWindow, startHour: h, startMinute: m });
              }}
              className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-1"
            />
            <span className="text-slate-500">a</span>
            <input
              type="time"
              value={`${pad(newWindow.endHour)}:${pad(newWindow.endMinute)}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                setNewWindow({ ...newWindow, endHour: h, endMinute: m });
              }}
              className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-1"
            />
            <button onClick={addWindow} className="rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white">
              Añadir franja
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Las horas son las del servidor donde corre la app (zona horaria configurada con la variable TZ).
          </p>
        </div>
      )}

      {saving && <p className="mt-2 text-xs text-slate-500">Guardando…</p>}
    </div>
  );
}
