"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UrlForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el trabajo");
      setUrl("");
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
      <label className="mb-2 block text-sm font-medium text-slate-300">
        Pega el enlace del vídeo (YouTube o cualquier vídeo compatible)
      </label>
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
          {loading ? "Enviando…" : "Generar shorts virales"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">
        La IA transcribirá el vídeo, elegirá los mejores momentos, les pondrá título, descripción, hashtags y
        probabilidad de viralidad, y generará los shorts verticales listos para publicar.
      </p>
    </form>
  );
}
