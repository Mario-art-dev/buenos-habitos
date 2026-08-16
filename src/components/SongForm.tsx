"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SongForm() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [songUrl, setSongUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl, songUrl }),
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
      <label className="mb-2 block text-sm font-medium text-slate-300">Vídeo de recopilación a remontar</label>
      <input
        type="url"
        required
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
      />

      <label className="mb-2 mt-4 block text-sm font-medium text-slate-300">
        Enlace de YouTube de la canción (Recomendado)
      </label>
      <input
        type="url"
        required
        value={songUrl}
        onChange={(e) => setSongUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
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
