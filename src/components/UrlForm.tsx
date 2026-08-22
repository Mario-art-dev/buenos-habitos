"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { toUploadableJpeg } from "@/lib/toUploadableJpeg";

interface UrlFormProps {
  mode?: "SINGLE" | "RANKING" | "SPLIT";
  label?: string;
  buttonLabel?: string;
  helpText?: string;
}

const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB por trozo, con margen de sobra bajo el límite del túnel

async function uploadInChunks(
  file: File,
  mode: string,
  onProgress: (pct: number) => void,
  splitDurationSec?: number
): Promise<{ id: string }> {
  const uploadId = crypto.randomUUID();
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);
    const res = await fetchWithRetry(`/api/jobs/upload/chunk?uploadId=${uploadId}&index=${i}`, {
      method: "POST",
      body: chunk,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Fallo subiendo el vídeo (trozo ${i + 1}/${totalChunks})`);
    }
    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  const finalizeRes = await fetchWithRetry("/api/jobs/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, mode, filename: file.name, splitDurationSec }),
  });
  const data = await finalizeRes.json();
  if (!finalizeRes.ok) throw new Error(data.error ?? "No se pudo crear el trabajo");
  return data.job;
}

/** Sube la foto de portada elegida al crear el trabajo — igual que en el editor, se convierte a
 *  JPEG en el navegador (funciona con HEIC del iPhone y pesa menos) antes de subirla. Si falla, no
 *  se corta la creación del trabajo por esto: se avisa aparte y el trabajo sigue con la portada
 *  normal (fotograma del vídeo). */
async function uploadJobCoverImage(jobId: string, file: File): Promise<void> {
  const uploadFile = await toUploadableJpeg(file).catch(() => file);
  const form = new FormData();
  form.append("file", uploadFile);
  const res = await fetchWithRetry(`/api/jobs/${jobId}/cover-image`, { method: "POST", body: form });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "No se pudo subir la foto de portada");
  }
}

export default function UrlForm({
  mode = "SINGLE",
  label = "Pega el enlace del vídeo (YouTube o cualquier vídeo compatible)",
  buttonLabel = "Generar shorts virales",
  helpText = "La IA transcribirá el vídeo, elegirá los mejores momentos, les pondrá título, descripción, hashtags y probabilidad de viralidad, y generará los shorts verticales listos para publicar.",
}: UrlFormProps) {
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [splitMinutes, setSplitMinutes] = useState(1);
  const router = useRouter();
  const splitDurationSec = mode === "SPLIT" ? Math.round(splitMinutes * 60) : undefined;
  // La portada de marca solo existe en estos tres modos (ver coverCard.ts) — en los demás no tiene
  // sentido ofrecer la foto porque nunca se llegaría a usar.
  const supportsCoverPhoto = mode === "SINGLE" || mode === "RANKING" || mode === "SPLIT";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      let job: { id: string };
      if (tab === "url") {
        const res = await fetchWithRetry("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, mode, splitDurationSec }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "No se pudo crear el trabajo");
        job = data.job;
      } else {
        if (!file) throw new Error("Elige un archivo de vídeo");
        job = await uploadInChunks(file, mode, setProgress, splitDurationSec);
      }
      if (coverImage) {
        // No bloquea la creación del trabajo si falla: la portada por defecto (fotograma del
        // vídeo) sigue funcionando igual, así que merece la pena seguir en vez de perder todo el
        // trabajo de descarga/subida ya hecho por un fallo solo de la foto.
        await uploadJobCoverImage(job.id, coverImage).catch(() => {});
      }
      setUrl("");
      setFile(null);
      setCoverImage(null);
      router.push(`/jobs/${job.id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-ink-700 bg-ink-800 p-6">
      <div className="mb-4 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setTab("url")}
          className={`rounded-lg px-3 py-1.5 font-medium ${
            tab === "url" ? "bg-brand-600 text-white" : "bg-ink-700 text-slate-400"
          }`}
        >
          Pegar enlace
        </button>
        <button
          type="button"
          onClick={() => setTab("upload")}
          className={`rounded-lg px-3 py-1.5 font-medium ${
            tab === "upload" ? "bg-brand-600 text-white" : "bg-ink-700 text-slate-400"
          }`}
        >
          Subir vídeo
        </button>
      </div>

      {mode === "SPLIT" && (
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-slate-300">Duración de cada trozo</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={splitMinutes}
              onChange={(e) => setSplitMinutes(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-20 shrink-0 rounded-lg bg-ink-900 px-3 py-1.5 text-center text-sm text-slate-200">
              {splitMinutes} min
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            El vídeo se corta entero, de principio a fin, en shorts consecutivos de esta duración.
          </p>
        </div>
      )}

      {supportsCoverPhoto && (
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-slate-300">
            Foto para la portada (opcional)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setCoverImage(e.target.files?.[0] ?? null)}
            className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm text-slate-300 outline-none focus:border-brand-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            {coverImage
              ? `${coverImage.name} — se usará como portada (con el sonido de marca) al final de TODOS los shorts que salgan de este vídeo, en vez de un fotograma. Vale en horizontal (se ve entera con el fondo desenfocado) o en vertical.`
              : "Si no subes ninguna, cada short usa un fotograma del propio vídeo como portada (se puede cambiar luego por clip desde el editor)."}
          </p>
        </div>
      )}

      {tab === "url" ? (
        <>
          <label className="mb-2 block text-sm font-medium text-slate-300">{label}</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="flex-1 rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Enviando…" : buttonLabel}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="mb-2 block text-sm font-medium text-slate-300">
            Sube el archivo de vídeo desde tu dispositivo
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="file"
              required
              accept="video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="flex-1 rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm text-slate-300 outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? `Subiendo… ${progress}%` : buttonLabel}
            </button>
          </div>
          {loading && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Se sube en trozos, así que no hay límite práctico de tamaño — vale para vídeos largos (una recopilación
            de una hora, por ejemplo). Con datos móviles puede tardar unos minutos; mejor con wifi si el archivo es
            grande.
          </p>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">
        {tab === "url"
          ? helpText
          : "Usa esta opción si el enlace de YouTube falla por bloqueo del servidor: descarga el vídeo con alguna app y súbelo aquí directamente. El resto del proceso (IA, cortes, comentario) es igual."}
      </p>
    </form>
  );
}
