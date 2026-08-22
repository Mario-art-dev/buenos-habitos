"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DoubleForm() {
  const [topUrl, setTopUrl] = useState("");
  const [bottomUrl, setBottomUrl] = useState("");
  const [partsCount, setPartsCount] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/double", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topUrl, bottomUrl, partsCount }),
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
      <label className="mb-2 block text-sm font-medium text-slate-300">
        Vídeo de ARRIBA (el que se corta en partes)
      </label>
      <input
        type="url"
        required
        value={topUrl}
        onChange={(e) => setTopUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
      />

      <label className="mb-2 mt-4 block text-sm font-medium text-slate-300">
        Vídeo de ABAJO (fijo, p.ej. gameplay de coche — se repite a lo largo de todas las partes)
      </label>
      <input
        type="url"
        required
        value={bottomUrl}
        onChange={(e) => setBottomUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
      />

      <label className="mb-2 mt-4 block text-sm font-medium text-slate-300">Número de partes</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={2}
          max={20}
          step={1}
          value={partsCount}
          onChange={(e) => setPartsCount(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-16 shrink-0 rounded-lg bg-ink-900 px-3 py-1.5 text-center text-sm text-slate-200">
          {partsCount}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        El vídeo de arriba se divide en {partsCount} partes iguales, cada una con &quot;Parte 1&quot;, &quot;Parte
        2&quot;... fijo arriba de la pantalla durante todo el vídeo.
      </p>

      <button
        type="submit"
        disabled={loading}
        className="mt-5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Enviando…" : "Generar en pantalla dividida"}
      </button>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">
        Se genera un short por cada parte, siempre con el vídeo de arriba encima y el de abajo debajo (mitad y
        mitad), con el número de parte fijo arriba para saber el orden aunque se vean sueltas.
      </p>
    </form>
  );
}
