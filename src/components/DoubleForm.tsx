"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import VideoInput, { type VideoInputValue } from "./VideoInput";

export default function DoubleForm() {
  const [top, setTop] = useState<VideoInputValue>({ url: "", uploadId: null });
  const [bottom, setBottom] = useState<VideoInputValue>({ url: "", uploadId: null });
  const [partsCount, setPartsCount] = useState(4);
  const [customTitle, setCustomTitle] = useState("");
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
        body: JSON.stringify({
          topUrl: top.url || undefined,
          topUploadId: top.uploadId || undefined,
          bottomUrl: bottom.url || undefined,
          bottomUploadId: bottom.uploadId || undefined,
          partsCount,
          customTitle: customTitle.trim() || undefined,
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
      <VideoInput label="Vídeo de ARRIBA (el que se corta en partes)" value={top} onChange={setTop} />
      <VideoInput
        label="Vídeo de ABAJO (fijo, p.ej. gameplay de coche — se repite a lo largo de todas las partes)"
        value={bottom}
        onChange={setBottom}
      />

      <label className="mb-2 mt-4 block text-sm font-medium text-slate-300">Título (opcional)</label>
      <input
        type="text"
        value={customTitle}
        onChange={(e) => setCustomTitle(e.target.value)}
        maxLength={120}
        placeholder='BROMA TELEFÓNICA A AURONPLAY "EL FIFAS"'
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-2.5 text-sm outline-none focus:border-brand-500"
      />
      <p className="mt-1 text-xs text-slate-500">
        Se queda fijo en pantalla, en mayúsculas sobre una barra negra, arriba del clip de ABAJO en todas las
        partes. Si lo dejas en blanco, no se pone ningún título.
      </p>

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
