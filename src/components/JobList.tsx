"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import JobStatusBadge from "./JobStatusBadge";

interface JobSummary {
  id: string;
  sourceUrl: string | null;
  productName: string | null;
  sourceTitle: string | null;
  status: string;
  createdAt: string;
  clips: { id: string; viralityScore: number; status: string }[];
}

async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "No se pudo eliminar");
  }
}

export default function JobList({
  mode,
  emptyMessage = "Todavía no has generado ningún short. Pega un enlace arriba para empezar.",
}: {
  mode?: "SINGLE" | "RANKING" | "PRODUCT" | "SONG" | "SPLIT" | "DOUBLE";
  emptyMessage?: string;
}) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      const qs = mode ? `?mode=${mode}` : "";
      const res = await fetch(`/api/jobs${qs}`);
      if (!res.ok || stop) return;
      const data = await res.json();
      setJobs(data.jobs);
      setLoaded(true);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, [mode]);

  async function handleDelete(e: React.MouseEvent, id: string) {
    // El botón vive dentro del <Link> de la fila entera — sin esto, el clic también navegaría al
    // detalle del trabajo en vez de solo borrarlo.
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("¿Eliminar este vídeo? Se borra de la galería y sus archivos, pero queda registrado en Eliminados.")) return;
    setDeletingId(id);
    try {
      await deleteJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  if (loaded && jobs.length === 0) {
    return <p className="mt-10 text-center text-sm text-slate-500">{emptyMessage}</p>;
  }

  return (
    <div className="mt-8 space-y-3">
      {jobs.map((job) => (
        <Link
          key={job.id}
          href={`/jobs/${job.id}`}
          className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 transition hover:border-brand-500/50"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-100">
              {job.sourceTitle ?? job.productName ?? job.sourceUrl ?? "Sin título"}
            </p>
            {job.sourceUrl && <p className="truncate text-xs text-slate-500">{job.sourceUrl}</p>}
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-3">
            {job.clips.length > 0 && (
              <span className="text-xs text-slate-400">{job.clips.length} vídeos</span>
            )}
            <JobStatusBadge status={job.status} />
            <button
              type="button"
              disabled={deletingId === job.id}
              onClick={(e) => handleDelete(e, job.id)}
              aria-label="Eliminar"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40"
            >
              ✕
            </button>
          </div>
        </Link>
      ))}
    </div>
  );
}
