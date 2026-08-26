"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import JobStatusBadge from "@/components/JobStatusBadge";
import ClipCard, { ClipData } from "@/components/ClipCard";
import VideoInput, { type VideoInputValue } from "@/components/VideoInput";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { toUploadableJpeg } from "@/lib/toUploadableJpeg";

interface JobData {
  id: string;
  mode: string;
  sourceUrl: string | null;
  sourceFilePath: string | null;
  sourceTitle: string | null;
  productName: string | null;
  productLink: string | null;
  referenceAdUrl: string | null;
  songUrl: string | null;
  bottomVideoUrl: string | null;
  bottomVideoFilePath: string | null;
  customTitle: string | null;
  splitDurationSec: number | null;
  doublePartsCount: number | null;
  coverImagePath: string | null;
  coverImageUrl: string | null;
  manualCategories: string | null;
  status: string;
  statusMessage: string | null;
  error: string | null;
  clips: ClipData[];
}

interface ManualCategoryRow {
  id: string;
  name: string;
  type: "TOPIC" | "YOUTUBER";
}

// Modos con edición "rica" (vídeo por enlace O archivo, portada, secciones...) — pedido explícito.
// Los demás modos (SPLIT/SONG/PRODUCT) se quedan con el editor genérico de campos de abajo.
const RICH_EDIT_MODES = new Set(["SINGLE", "RANKING", "DOUBLE"]);

// Qué campos editables tiene sentido mostrar según el modo del trabajo — no todos los modos usan
// todos los campos (p.ej. PRODUCT no tiene sourceUrl, sube fotos/vídeos aparte que este editor no
// toca).
const EDITABLE_FIELDS: Record<string, { key: keyof JobData; label: string; type: "url" | "text" | "number" }[]> = {
  SPLIT: [
    { key: "sourceUrl", label: "Enlace del vídeo", type: "url" },
    { key: "customTitle", label: "Título propio (quemado en pantalla)", type: "text" },
    { key: "splitDurationSec", label: "Duración de cada trozo (segundos)", type: "number" },
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

  // Estado del editor "rico" (SINGLE/RANKING/DOUBLE) — ver RICH_EDIT_MODES.
  const [editSourceVideo, setEditSourceVideo] = useState<VideoInputValue>({ url: "", uploadId: null });
  const [editBottomVideo, setEditBottomVideo] = useState<VideoInputValue>({ url: "", uploadId: null });
  const [editCustomTitle, setEditCustomTitle] = useState("");
  const [editPartsCount, setEditPartsCount] = useState(4);
  const [editCoverFile, setEditCoverFile] = useState<File | null>(null);
  const [editRemoveCover, setEditRemoveCover] = useState(false);
  const [editManualCategories, setEditManualCategories] = useState<ManualCategoryRow[]>([]);

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
    if (RICH_EDIT_MODES.has(job.mode)) {
      // Prellenar con lo que ya hay puesto — pedido explícito. Un vídeo por enlace se rellena tal
      // cual en el campo; uno subido como archivo no se puede "prellenar" en un <input type="file">
      // (VideoInput lo indica con existingLabel en vez de dejarlo vacío sin explicación).
      setEditSourceVideo({ url: job.sourceUrl ?? "", uploadId: null });
      setEditBottomVideo({ url: job.bottomVideoUrl ?? "", uploadId: null });
      setEditCustomTitle(job.customTitle ?? "");
      setEditPartsCount(job.doublePartsCount ?? 4);
      setEditCoverFile(null);
      setEditRemoveCover(false);
      let categories: ManualCategoryRow[] = [];
      if (job.manualCategories) {
        try {
          const parsed = JSON.parse(job.manualCategories) as { name: string; type: "TOPIC" | "YOUTUBER" }[];
          categories = parsed.map((c) => ({ id: crypto.randomUUID(), ...c }));
        } catch {
          categories = [];
        }
      }
      setEditManualCategories(categories);
    } else {
      const fields = EDITABLE_FIELDS[job.mode] ?? [];
      const values: Record<string, string> = {};
      for (const f of fields) {
        const v = job[f.key];
        values[f.key] = v == null ? "" : String(v);
      }
      setEditValues(values);
    }
    setEditError(null);
    setEditing(true);
  }

  function addManualCategory() {
    setEditManualCategories((prev) => [...prev, { id: crypto.randomUUID(), name: "", type: "TOPIC" }]);
  }
  function updateManualCategory(id: string, patch: Partial<ManualCategoryRow>) {
    setEditManualCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removeManualCategory(id: string) {
    setEditManualCategories((prev) => prev.filter((c) => c.id !== id));
  }

  async function saveRichEdit() {
    if (!job) return;
    // Portada primero (subida aparte, multipart) — igual que al crear el trabajo (ver UrlForm.tsx),
    // no bloquea el resto si falla: se avisa aparte.
    if (editRemoveCover) {
      await fetchWithRetry(`/api/jobs/${jobId}/cover-image`, { method: "DELETE" }).catch(() => {});
    } else if (editCoverFile) {
      const uploadFile = await toUploadableJpeg(editCoverFile).catch(() => editCoverFile);
      const form = new FormData();
      form.append("file", uploadFile);
      await fetchWithRetry(`/api/jobs/${jobId}/cover-image`, { method: "POST", body: form }).catch(() => {});
    }

    const body: Record<string, unknown> = {};
    if (editSourceVideo.uploadId) body.sourceUploadId = editSourceVideo.uploadId;
    else if (editSourceVideo.url.trim()) body.sourceUrl = editSourceVideo.url.trim();

    if (job.mode === "DOUBLE") {
      if (editBottomVideo.uploadId) body.bottomVideoUploadId = editBottomVideo.uploadId;
      else if (editBottomVideo.url.trim()) body.bottomVideoUrl = editBottomVideo.url.trim();
      body.customTitle = editCustomTitle.trim();
      body.doublePartsCount = editPartsCount;
    }

    if (job.mode === "RANKING") {
      body.manualCategories = editManualCategories
        .map((c) => ({ name: c.name.trim(), type: c.type }))
        .filter((c) => c.name.length > 0);
    }

    const res = await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
    // La portada se sube/borra aparte (arriba); se recarga el job entero para reflejarla también.
    const refreshed = await fetch(`/api/jobs/${jobId}`);
    const refreshedData = await refreshed.json().catch(() => null);
    setJob(refreshedData?.job ?? data.job);
  }

  async function saveEdit() {
    if (!job) return;
    setSaving(true);
    setEditError(null);
    try {
      if (RICH_EDIT_MODES.has(job.mode)) {
        await saveRichEdit();
      } else {
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
      }
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
  const isRichEdit = RICH_EDIT_MODES.has(job.mode);
  const canEdit = isRichEdit || editableFields.length > 0;
  const supportsCoverPhoto = job.mode === "SINGLE" || job.mode === "RANKING";
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

        {isQueued && canEdit && !editing && (
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
        {isQueued && !canEdit && (
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

        {editing && isRichEdit && (
          <div className="mt-3 space-y-4 rounded-xl border border-ink-600 bg-ink-900/60 p-3">
            <VideoInput
              label={job.mode === "DOUBLE" ? "Vídeo de ARRIBA (el que se corta en partes)" : "Vídeo"}
              value={editSourceVideo}
              onChange={setEditSourceVideo}
              defaultTab={job.sourceFilePath ? "upload" : "url"}
              existingLabel={job.sourceFilePath ? `Ya tienes un vídeo subido${job.sourceTitle ? ` (${job.sourceTitle})` : ""}` : undefined}
            />

            {job.mode === "DOUBLE" && (
              <VideoInput
                label="Vídeo de ABAJO (fijo, p.ej. gameplay — se repite en todas las partes)"
                value={editBottomVideo}
                onChange={setEditBottomVideo}
                defaultTab={job.bottomVideoFilePath ? "upload" : "url"}
                existingLabel={job.bottomVideoFilePath ? "Ya tienes un vídeo subido" : undefined}
              />
            )}

            {job.mode === "DOUBLE" && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Título (quemado en pantalla)</label>
                  <input
                    type="text"
                    value={editCustomTitle}
                    onChange={(e) => setEditCustomTitle(e.target.value)}
                    maxLength={120}
                    className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Número de partes</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={2}
                      max={20}
                      step={1}
                      value={editPartsCount}
                      onChange={(e) => setEditPartsCount(Number(e.target.value))}
                      className="flex-1"
                    />
                    <span className="w-12 shrink-0 rounded-lg bg-ink-900 px-2 py-1 text-center text-xs text-slate-200">
                      {editPartsCount}
                    </span>
                  </div>
                </div>
              </>
            )}

            {job.mode === "RANKING" && (
              <div>
                <label className="mb-1 block text-xs text-slate-500">Secciones de ranking (opcional)</label>
                <div className="flex flex-col gap-2">
                  {editManualCategories.map((cat) => (
                    <div key={cat.id} className="flex gap-2">
                      <input
                        type="text"
                        value={cat.name}
                        onChange={(e) => updateManualCategory(cat.id, { name: e.target.value })}
                        placeholder="Nombre del YouTuber o tema"
                        className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-brand-500"
                      />
                      <select
                        value={cat.type}
                        onChange={(e) => updateManualCategory(cat.id, { type: e.target.value as "TOPIC" | "YOUTUBER" })}
                        className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-xs text-slate-300 outline-none focus:border-brand-500"
                      >
                        <option value="TOPIC">Temática</option>
                        <option value="YOUTUBER">YouTuber</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeManualCategory(cat.id)}
                        className="rounded-lg bg-ink-700 px-2 py-2 text-xs text-slate-300 hover:bg-ink-600"
                        aria-label="Quitar sección"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addManualCategory}
                  className="mt-2 rounded-lg bg-ink-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-ink-600"
                >
                  + Añadir sección
                </button>
              </div>
            )}

            {supportsCoverPhoto && (
              <div>
                <label className="mb-1 block text-xs text-slate-500">Foto de portada (opcional)</label>
                {job.coverImageUrl && !editRemoveCover && (
                  <div className="mb-2 flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={job.coverImageUrl} alt="Portada actual" className="h-16 w-16 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => setEditRemoveCover(true)}
                      className="rounded-lg border border-red-900 px-2 py-1 text-xs text-red-400 hover:border-red-500"
                    >
                      Quitar portada
                    </button>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    setEditCoverFile(e.target.files?.[0] ?? null);
                    setEditRemoveCover(false);
                  }}
                  className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-xs text-slate-300 outline-none focus:border-brand-500"
                />
                {editCoverFile && <p className="mt-1 text-xs text-emerald-400">✓ {editCoverFile.name} — se guardará al pulsar Guardar.</p>}
              </div>
            )}

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

        {editing && !isRichEdit && (
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
