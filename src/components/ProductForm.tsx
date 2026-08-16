"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProductForm() {
  const [productName, setProductName] = useState("");
  const [productLink, setProductLink] = useState("");
  const [referenceAdUrl, setReferenceAdUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("productName", productName);
      form.set("productLink", productLink);
      form.set("referenceAdUrl", referenceAdUrl);
      files.forEach((f) => form.append("files", f));

      const res = await fetch("/api/jobs/product", { method: "POST", body: form });
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
      <label className="mb-2 block text-sm font-medium text-slate-300">Nombre del producto</label>
      <input
        type="text"
        required
        value={productName}
        onChange={(e) => setProductName(e.target.value)}
        placeholder="Ej. Auriculares XYZ Pro"
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
      />

      <label className="mb-2 mt-4 block text-sm font-medium text-slate-300">
        Enlace del producto (afiliado o tienda) — opcional si subes fotos
      </label>
      <input
        type="url"
        value={productLink}
        onChange={(e) => setProductLink(e.target.value)}
        placeholder="https://..."
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
      />
      <p className="mt-1 text-xs text-slate-500">
        Se añadirá a la descripción del vídeo. Si no subes fotos propias, la IA intentará sacar fotos del producto de
        esta página.
      </p>

      <label className="mb-2 mt-4 block text-sm font-medium text-slate-300">
        Anuncio existente de referencia — opcional
      </label>
      <input
        type="url"
        value={referenceAdUrl}
        onChange={(e) => setReferenceAdUrl(e.target.value)}
        placeholder="Enlace a un vídeo de anuncio ya publicado, solo como inspiración de estructura"
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
      />
      <p className="mt-1 text-xs text-slate-500">
        La IA se inspira en el ritmo/estructura, pero escribe un guion propio — no copia el anuncio.
      </p>

      <label className="mb-2 mt-4 block text-sm font-medium text-slate-300">Fotos/vídeos del producto</label>
      <input
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm text-slate-300 outline-none focus:border-brand-500"
      />
      {files.length > 0 && <p className="mt-1 text-xs text-slate-500">{files.length} archivo(s) seleccionado(s).</p>}

      <button
        type="submit"
        disabled={loading}
        className="mt-5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Enviando…" : "Generar vídeo publicitario"}
      </button>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">
        La IA escribe un guion propio (gancho, presentación de cada foto/clip y llamada a la acción), lo narra con
        voz de IA y monta un short vertical con tus fotos/vídeos del producto en efecto Ken Burns.
      </p>
    </form>
  );
}
