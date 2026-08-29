"use client";

import { useEffect, useState } from "react";

interface Publication {
  platform: string;
  remoteUrl: string | null;
  updatedAt: string;
}

interface PublishedClip {
  id: string;
  title: string;
  jobMode: string;
  sourceTitle: string | null;
  publishedAt: string | null;
  publications: Publication[];
}

const PLATFORM_LABELS: Record<string, string> = {
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

/** Historial de solo lectura de todo lo ya publicado (ver /api/clips/published) — sin vídeo ni
 *  miniatura porque sus archivos ya se borraron al publicarse en todas las plataformas conectadas. */
export default function PublicadosClient() {
  const [clips, setClips] = useState<PublishedClip[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      const res = await fetch("/api/clips/published");
      if (!res.ok || stop) return;
      const data = await res.json();
      setClips(data.clips);
      setLoaded(true);
    }
    load();
    return () => {
      stop = true;
    };
  }, []);

  if (loaded && clips.length === 0) {
    return <p className="mt-10 text-center text-sm text-slate-500">Todavía no se ha publicado ningún short.</p>;
  }

  return (
    <div className="mt-8 space-y-3">
      {clips.map((clip) => (
        <div key={clip.id} className="rounded-xl border border-ink-700 bg-ink-800/60 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-200">{clip.title}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {clip.sourceTitle ?? "Sin origen"} · publicado {formatDate(clip.publishedAt)}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {clip.publications.map((pub) => (
              <a
                key={pub.platform}
                href={pub.remoteUrl ?? undefined}
                target={pub.remoteUrl ? "_blank" : undefined}
                rel={pub.remoteUrl ? "noreferrer" : undefined}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  pub.remoteUrl ? "bg-brand-700/40 text-brand-200 hover:bg-brand-700/60" : "bg-ink-700 text-slate-400"
                }`}
              >
                {PLATFORM_LABELS[pub.platform] ?? pub.platform}
                {pub.remoteUrl ? " ↗" : ` · ${formatDate(pub.updatedAt)}`}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
