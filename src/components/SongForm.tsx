"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import VideoInput, { type VideoInputValue } from "./VideoInput";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

export default function SongForm() {
  const [source, setSource] = useState<VideoInputValue>({ url: "", uploadId: null });
  const [song, setSong] = useState<VideoInputValue>({ url: "", uploadId: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithRetry("/api/jobs/song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: source.url || undefined,
          sourceUploadId: source.uploadId || undefined,
          songUrl: song.url || undefined,
          songUploadId: song.uploadId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el trabajo");
      router.push(`/jobs/${data.job.id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-ink-700 bg-ink-800 p-6">
      <VideoInput label="Vídeo de recopilación a remontar" value={source} onChange={setSource} />
      <VideoInput
        label="Canción (Recomendado)"
        value={song}
        onChange={setSong}
        helpText="Si pegas un enlace de YouTube, solo se descarga el audio."
      />

      <button
        type="submit"
        disabled={loading}
        className="mt-5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Enviando…" : "Montar al ritmo de la canción"}
      </button>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">
        La IA detecta los golpes (beats) de la canción, elige los mejores momentos del vídeo y corta cada cambio de
        plano justo al ritmo, sustituyendo el audio original por la canción elegida.
      </p>
      <p className="mt-2 text-xs text-slate-600">
        Aviso: usar una canción con derechos de autor puede generar un aviso de copyright en la plataforma.
      </p>
    </form>
  );
}
