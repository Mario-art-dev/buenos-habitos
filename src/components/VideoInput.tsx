"use client";

import { useState } from "react";

const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB por trozo, con margen de sobra bajo el límite del túnel

async function fetchWithRetry(input: string, init: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, init);
      if (!res.ok && res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

export interface VideoInputValue {
  url: string;
  uploadId: string | null;
}

/**
 * Campo de vídeo reutilizable con dos formas de indicarlo: pegar un enlace, o subir un archivo
 * desde el dispositivo (galería/archivos/cámara — el selector nativo del móvil ya ofrece las tres
 * opciones con un simple <input type="file" accept="video/*">, sin nada especial que añadir).
 * La subida va en trozos (mismo mecanismo que UrlForm.tsx) para no toparse con el límite de
 * tamaño por petición del túnel gratuito; el resultado es un uploadId que el formulario que use
 * este componente manda junto al resto de campos al crear el job (no crea el job por sí solo,
 * a diferencia de UrlForm, porque aquí puede haber más de un vídeo por formulario).
 */
export default function VideoInput({
  label,
  value,
  onChange,
  helpText,
}: {
  label: string;
  value: VideoInputValue;
  onChange: (v: VideoInputValue) => void;
  helpText?: string;
}) {
  const [tab, setTab] = useState<"url" | "upload">(value.uploadId ? "upload" : "url");
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    setProgress(0);
    setFileName(file.name);
    try {
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * CHUNK_SIZE, i * CHUNK_SIZE + CHUNK_SIZE);
        const res = await fetchWithRetry(`/api/jobs/upload/chunk?uploadId=${uploadId}&index=${i}`, {
          method: "POST",
          body: chunk,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Fallo subiendo el vídeo (trozo ${i + 1}/${totalChunks})`);
        }
        setProgress(Math.round(((i + 1) / totalChunks) * 100));
      }
      onChange({ url: "", uploadId });
    } catch (err) {
      setError((err as Error).message);
      onChange({ url: "", uploadId: null });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mb-4">
      <label className="mb-2 block text-sm font-medium text-slate-300">{label}</label>
      <div className="mb-2 flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => {
            setTab("url");
            setFileName(null);
            onChange({ url: value.url, uploadId: null });
          }}
          className={`rounded-lg px-2.5 py-1 font-medium ${
            tab === "url" ? "bg-brand-600 text-white" : "bg-ink-700 text-slate-400"
          }`}
        >
          Pegar enlace
        </button>
        <button
          type="button"
          onClick={() => setTab("upload")}
          className={`rounded-lg px-2.5 py-1 font-medium ${
            tab === "upload" ? "bg-brand-600 text-white" : "bg-ink-700 text-slate-400"
          }`}
        >
          Subir vídeo
        </button>
      </div>

      {tab === "url" ? (
        <input
          type="url"
          required={!value.uploadId}
          value={value.url}
          onChange={(e) => onChange({ url: e.target.value, uploadId: null })}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
        />
      ) : (
        <>
          <input
            type="file"
            required={!value.uploadId}
            accept="video/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm text-slate-300 outline-none focus:border-brand-500"
          />
          {uploading && (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">Subiendo {fileName}… {progress}%</p>
            </div>
          )}
          {!uploading && value.uploadId && fileName && (
            <p className="mt-1 text-xs text-emerald-400">✓ {fileName} subido</p>
          )}
        </>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {helpText && <p className="mt-1 text-xs text-slate-500">{helpText}</p>}
    </div>
  );
}
