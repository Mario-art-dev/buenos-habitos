"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import JobStatusBadge from "@/components/JobStatusBadge";
import ClipCard, { ClipData } from "@/components/ClipCard";

interface JobData {
  id: string;
  mode: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  productName: string | null;
  productLink: string | null;
  referenceAdUrl: string | null;
  songUrl: string | null;
  bottomVideoUrl: string | null;
  customTitle: string | null;
  splitDurationSec: number | null;
  doublePartsCount: number | null;
  status: string;
  statusMessage: string | null;
  error: string | null;
  clips: ClipData[];
}

// Qué campos editables tiene sentido mostrar según el modo del trabajo — no todos los modos usan
// todos los campos (p.ej. PRODUCT no tiene sourceUrl, sube fotos/vídeos aparte que este editor no
// toca).
const EDITABLE_FIELDS: Record<string, { key: keyof JobData; label: string; type: "url" | "text" | "number" }[]> = {
  SINGLE: [{ key: "sourceUrl", label: "Enlace del vídeo", type: "url" }],
  RANKING: [{ key: "sourceUrl", label: "Enlace del vídeo", type: "url" }],
  SPLIT: [
    { key: "sourceUrl", label: "Enlace del vídeo", type: "url" },
    { key: "customTitle", label: "Título propio (quemado en pantalla)", type: "text" },
    { key: "splitDurationSec", label: "Duración de cada trozo (segundos)", type: "number" },
  ],
  DOUBLE: [
    { key: "sourceUrl", label: "Enlace del vídeo de arriba", type: "url" },
    { key: "bottomVideoUrl", label: "Enlace del vídeo de abajo", type: "url" },
    { key: "customTitle", label: "Título propio (quemado en pantalla)", type: "text" },
    { key: "doublePartsCount", label: "Número de partes", type: "number" },
  ],
  SONG: [
    { key: "sourceUrl", label: "Enlace de la recopilación", type: "url" },
    { key: "songUrl", label: "Enlace de la canción", type: "url" },
  ],
  PRODUCT: [
    { key: "productName", label: "Nombre del producto", type: "text" },
    { key: "productLink", label: "Enlace de afiliado", type: "url" },
    { key: "referenceAdUrl", label: "Vídeo de referencia", type: "url" },
  ],
};

export default function JobDetailClient({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobData | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function retryJob() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo reintentar");
      setJob((j) => (j ? { ...j, status: "PENDING", error: null, statusMessage: "Reintentando…" } : j));
    } catch (err) {
      setRetryError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  function openEdit() {
    if (!job) return;
    const fields = EDITABLE_FIELDS[job.mode] ?? [];
    const values: Record<string, string> = {};
    for (const f of fields) {
      const v = job[f.key];
      values[f.key] = v == null ? "" : String(v);
    }
    setEditValues(values);
    setEditError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!job) return;
    setSaving(true);
    setEditError(null);
    try {
      const fields = EDITABLE_FIELDS[job.mode] ?? [];
      const body: Record<string, string | number> = {};
      for (const f of fields) {
        const raw = editValues[f.key] ?? "";
        if (!raw) continue;
        body[f.key] = f.type === "number" ? Number(raw) : raw;
      }
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      setJob((j) => (j ? { ...j, ...data.job } : j));
      setEditing(false);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteJob() {
    if (!confirm("¿Eliminar este vídeo de la cola? No se puede deshacer.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      router.push("/");
    } catch (err) {
      setDeleting(false);
      alert((err as Error).message);
    }
  }

  useEffect(() => {
    let stop = false;
    async function load() {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok || stop) return;
      const data = await res.json();
      setJob(data.job);
    }
    load();
    const interval = setInterval(() => {
      if (job?.status === "DONE" || job?.status === "FAILED") return;
      load();
    }, 4000);
    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, [jobId, job?.status]);

  if (!job) return <p className="text-sm text-slate-500">Cargando…</p>;

  const editableFields = EDITABLE_FIELDS[job.mode] ?? [];
  const isQueued = job.status !== "DONE";

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{job.sourceTitle ?? job.productName ?? "Procesando vídeo…"}</h1>
          <JobStatusBadge status={job.status} />
        </div>
        {job.sourceUrl && <p className="mt-1 text-sm text-slate-500">{job.sourceUrl}</p>}
        {job.statusMessage && job.status !== "DONE" && (
          <p className="mt-2 text-sm text-brand-400">{job.statusMessage}</p>
        )}
        {job.error && <p className="mt-2 text-sm text-red-400">Error: {job.error}</p>}

        {job.status === "FAILED" && (
          <button
            disabled={retrying}
            onClick={retryJob}
            className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {retrying ? "Reintentando…" : "🔁 Reintentar"}
          </button>
        )}
        {retryError && <p className="mt-1 text-xs text-red-400">{retryError}</p>}

        {isQueued && editableFields.length > 0 && !editing && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={openEdit}
              className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-brand-500"
            >
              ✏️ Editar
            </button>
            <button
              disabled={deleting}
              onClick={deleteJob}
              className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-semibold text-red-400 hover:border-red-500 disabled:opacity-40"
            >
              {deleting ? "Eliminando…" : "🗑️ Eliminar"}
            </button>
          </div>
        )}
        {isQueued && editableFields.length === 0 && (
          <div className="mt-3">
            <button
              disabled={deleting}
              onClick={deleteJob}
              className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-semibold text-red-400 hover:border-red-500 disabled:opacity-40"
            >
              {deleting ? "Eliminando…" : "🗑️ Eliminar"}
            </button>
          </div>
        )}

        {editing && (
          <div className="mt-3 space-y-2 rounded-xl border border-ink-600 bg-ink-900/60 p-3">
            {editableFields.map((f) => (
              <div key={f.key}>
                <label className="text-xs text-slate-500">{f.label}</label>
                <input
                  type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}
                  value={editValues[f.key] ?? ""}
                  onChange={(e) => setEditValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-brand-500"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button
                disabled={saving}
                onClick={saveEdit}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
              <button
                disabled={saving}
                onClick={() => setEditing(false)}
                className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
              >
                Cancelar
              </button>
            </div>
            {editError && <p className="text-xs text-red-400">{editError}</p>}
          </div>
        )}
      </div>

      {job.clips.length > 0 && (
        <div className="space-y-4">
          {job.clips
            .slice()
            .sort((a, b) => b.viralityScore - a.viralityScore)
            .map((clip) => (
              <ClipCard key={clip.id} clip={clip} />
            ))}
        </div>
      )}
    </div>
  );
}
