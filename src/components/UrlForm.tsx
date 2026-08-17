"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UrlFormProps {
  mode?: "SINGLE" | "RANKING";
  label?: string;
  buttonLabel?: string;
  helpText?: string;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let res: Response;
      if (tab === "url") {
        res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, mode }),
        });
      } else {
        if (!file) throw new Error("Elige un archivo de vídeo");
        const form = new FormData();
        form.set("mode", mode);
        form.set("file", file);
        res = await fetch("/api/jobs/upload", { method: "POST", body: form });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el trabajo");
      setUrl("");
      setFile(null);
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
              {loading ? "Subiendo…" : buttonLabel}
            </button>
          </div>
          <p className="mt-2 text-xs text-amber-400">
            Máximo ~95MB por el límite del túnel gratuito. Si el vídeo pesa más, baja la calidad o recórtalo antes de
            subirlo.
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
