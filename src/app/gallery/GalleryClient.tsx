"use client";

import { useEffect, useState } from "react";
import ClipCard, { ClipData } from "@/components/ClipCard";

function formatHour(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export default function GalleryClient() {
  const [clips, setClips] = useState<ClipData[] | null>(null);
  const [publishingAll, setPublishingAll] = useState(false);
  const [publishAllMessage, setPublishAllMessage] = useState<string | null>(null);
  const [publishAllError, setPublishAllError] = useState<string | null>(null);

  const [nowCount, setNowCount] = useState(5);
  const [publishingNow, setPublishingNow] = useState(false);
  const [publishNowMessage, setPublishNowMessage] = useState<string | null>(null);
  const [publishNowError, setPublishNowError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clips")
      .then((res) => res.json())
      .then((data) => setClips(data.clips));
  }, []);

  async function configurarHorarios() {
    setPublishingAll(true);
    setPublishAllMessage(null);
    setPublishAllError(null);
    try {
      const res = await fetch("/api/schedule/publish-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo programar la publicación");
      const result = data.result as {
        scheduledClips: number;
        firstAt: string | null;
        lastAt: string | null;
        perHour: number;
      };
      if (result.scheduledClips === 0) {
        setPublishAllMessage("No había ningún short pendiente de publicar (o ya estaban todos programados).");
      } else {
        setPublishAllMessage(
          `Programados ${result.scheduledClips} shorts, repartidos equitativamente (~${result.perHour} por hora) a` +
            ` lo largo del día, desde ${formatHour(result.firstAt!)} hasta ${formatHour(result.lastAt!)}.` +
            ` Se publicarán solos según llegue su hora.`
        );
      }
    } catch (err) {
      setPublishAllError((err as Error).message);
    } finally {
      setPublishingAll(false);
    }
  }

  async function publicarDeInmediato() {
    setPublishingNow(true);
    setPublishNowMessage(null);
    setPublishNowError(null);
    try {
      const res = await fetch("/api/schedule/publish-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: nowCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo publicar");
      const result = data.result as { publishedClips: number; failedClips: number };
      setPublishNowMessage(
        result.failedClips > 0
          ? `Publicados ${result.publishedClips} shorts. ${result.failedClips} fallaron (revisa la conexión de las plataformas).`
          : `Publicados ${result.publishedClips} shorts de inmediato.`
      );
      fetch("/api/clips")
        .then((res) => res.json())
        .then((d) => setClips(d.clips));
    } catch (err) {
      setPublishNowError((err as Error).message);
    } finally {
      setPublishingNow(false);
    }
  }

  if (!clips) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-700 bg-ink-800 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Publicar de inmediato</h3>
        <p className="mt-1 text-xs text-slate-500">
          Sube ahora mismo los shorts más antiguos de la galería (los primeros que entraron) a las plataformas
          conectadas, sin esperar a ninguna hora programada.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={clips.length || 1}
            value={nowCount}
            onChange={(e) => setNowCount(Math.max(1, Number(e.target.value) || 1))}
            className="w-20 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-100"
          />
          <button
            onClick={publicarDeInmediato}
            disabled={publishingNow || clips.length === 0}
            className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {publishingNow ? "Publicando…" : "Publicar ahora"}
          </button>
        </div>
        {publishNowMessage && <p className="mt-2 text-xs text-emerald-400">{publishNowMessage}</p>}
        {publishNowError && <p className="mt-2 text-xs text-red-400">{publishNowError}</p>}
      </div>

      <div className="rounded-2xl border border-ink-700 bg-ink-800 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Configurar horarios</h3>
        <button
          onClick={configurarHorarios}
          disabled={publishingAll || clips.length === 0}
          className="mt-3 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {publishingAll ? "Programando…" : "Configurar horarios"}
        </button>
        <p className="mt-2 text-xs text-slate-500">
          Programa todos los shorts listos de la galería, repartidos equitativamente entre las 24 horas del día
          según cuántos haya ahora mismo (p.ej. 48 shorts = 2 por hora, 72 = 3 por hora) en las plataformas que
          tengas conectadas.
        </p>
        {publishAllMessage && <p className="mt-2 text-xs text-emerald-400">{publishAllMessage}</p>}
        {publishAllError && <p className="mt-2 text-xs text-red-400">{publishAllError}</p>}
      </div>

      {clips.length === 0 ? (
        <p className="mt-10 text-center text-sm text-slate-500">Todavía no tienes ningún short listo.</p>
      ) : (
        clips.map((clip) => <ClipCard key={clip.id} clip={clip} />)
      )}
    </div>
  );
}
