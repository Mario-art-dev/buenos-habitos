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

  useEffect(() => {
    fetch("/api/clips")
      .then((res) => res.json())
      .then((data) => setClips(data.clips));
  }, []);

  async function publishAll() {
    setPublishingAll(true);
    setPublishAllMessage(null);
    setPublishAllError(null);
    try {
      const res = await fetch("/api/schedule/publish-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo programar la publicación");
      const result = data.result as { scheduledClips: number; firstAt: string | null; lastAt: string | null };
      if (result.scheduledClips === 0) {
        setPublishAllMessage("No había ningún short pendiente de publicar (o ya estaban todos programados).");
      } else {
        setPublishAllMessage(
          `Programados ${result.scheduledClips} shorts, repartidos 2 por hora desde ${formatHour(
            result.firstAt!
          )} hasta ${formatHour(result.lastAt!)}. Se publicarán solos según llegue su hora.`
        );
      }
    } catch (err) {
      setPublishAllError((err as Error).message);
    } finally {
      setPublishingAll(false);
    }
  }

  if (!clips) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-700 bg-ink-800 p-4">
        <button
          onClick={publishAll}
          disabled={publishingAll || clips.length === 0}
          className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {publishingAll ? "Programando…" : "Publicar todos"}
        </button>
        <p className="mt-2 text-xs text-slate-500">
          Programa todos los shorts listos de la galería, repartidos automáticamente 2 por hora a lo largo del día
          (00:00, 01:00, 02:00…) en las plataformas que tengas conectadas.
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
