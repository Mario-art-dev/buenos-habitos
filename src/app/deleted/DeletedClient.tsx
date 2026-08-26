"use client";

import { useEffect, useState } from "react";

interface DeletedJob {
  id: string;
  mode: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  productName: string | null;
  createdAt: string;
  deletedAt: string | null;
}

const MODE_LABELS: Record<string, string> = {
  SINGLE: "Vídeos virales",
  RANKING: "Ranking",
  SPLIT: "Cortar en shorts",
  DOUBLE: "Modo doble",
  SONG: "Canción",
  PRODUCT: "Producto",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

/** Lista de solo lectura de todo lo borrado con la X (ver JobList.tsx) — sin vídeo ni miniatura
 *  porque sus archivos ya no existen en disco, solo queda el registro de qué era y cuándo se borró. */
export default function DeletedClient() {
  const [jobs, setJobs] = useState<DeletedJob[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      const res = await fetch("/api/jobs?deleted=1");
      if (!res.ok || stop) return;
      const data = await res.json();
      setJobs(data.jobs);
      setLoaded(true);
    }
    load();
    return () => {
      stop = true;
    };
  }, []);

  if (loaded && jobs.length === 0) {
    return <p className="mt-10 text-center text-sm text-slate-500">Todavía no has eliminado ningún vídeo.</p>;
  }

  return (
    <div className="mt-8 space-y-3">
      {jobs.map((job) => (
        <div key={job.id} className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-800/60 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-300">
              {job.sourceTitle ?? job.productName ?? job.sourceUrl ?? "Sin título"}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {MODE_LABELS[job.mode] ?? job.mode} · creado {formatDate(job.createdAt)}
            </p>
          </div>
          <span className="ml-4 shrink-0 rounded-full bg-ink-700 px-2.5 py-1 text-xs text-slate-400">
            Eliminado {formatDate(job.deletedAt)}
          </span>
        </div>
      ))}
    </div>
  );
}
