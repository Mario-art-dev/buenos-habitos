"use client";

import { useState } from "react";
import ViralityBadge from "./ViralityBadge";

export interface RankingItemData {
  id: string;
  position: number;
  label: string;
  description: string;
}

export interface ClipData {
  id: string;
  rank: number;
  startSec: number;
  endSec: number;
  title: string;
  description: string;
  hook: string | null;
  viralityScore: number;
  viralityReason: string;
  hashtags: string[];
  status: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  category?: string | null;
  musicQuery?: string | null;
  musicSourceUrl?: string | null;
  musicStartSec?: number | null;
  commentaryIntro?: string | null;
  commentaryOutro?: string | null;
  affiliateLink?: string | null;
  rankingItems?: RankingItemData[];
  publications: { id: string; platform: string; status: string; remoteUrl: string | null; error: string | null }[];
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function MusicPanel({ clip, onApplied }: { clip: ClipData; onApplied: () => void }) {
  const [url, setUrl] = useState(clip.musicSourceUrl ?? "");
  const [startSec, setStartSec] = useState(clip.musicStartSec ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function apply() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clips/${clip.id}/music`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicSourceUrl: url, musicStartSec: startSec }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo añadir la música");
      onApplied();
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-ink-600 bg-ink-900/60 p-3">
      <p className="text-xs text-slate-400">
        🎵 Música sugerida por la IA: <span className="text-slate-200">{clip.musicQuery || "(sin sugerencia)"}</span>
      </p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="mt-2 text-xs text-brand-400 underline">
          {clip.musicSourceUrl ? "Cambiar música" : "Pegar link de YouTube con esta canción"}
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-brand-500"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Empezar en (segundos):</label>
            <input
              type="number"
              min={0}
              value={startSec}
              onChange={(e) => setStartSec(Number(e.target.value))}
              className="w-20 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs outline-none focus:border-brand-500"
            />
            <button
              disabled={loading || !url}
              onClick={apply}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {loading ? "Aplicando…" : "Usar esta música"}
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Aviso: usar una canción con derechos de autor puede generar un aviso de copyright en la plataforma.
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function ClipCard({ clip }: { clip: ClipData }) {
  const [publications, setPublications] = useState(clip.publications);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [videoVersion, setVideoVersion] = useState(0);

  const statusFor = (platform: string) =>
    publications.find((p) => p.platform === platform && p.status !== "FAILED");

  async function publish(platform: "YOUTUBE" | "TIKTOK") {
    setPublishing(platform);
    setNote(null);
    try {
      const res = await fetch(`/api/clips/${clip.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fallo al publicar");
      setPublications((prev) => [...prev.filter((p) => p.platform !== platform), data.publication]);
      if (data.note) setNote(data.note);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setPublishing(null);
    }
  }

  const yt = statusFor("YOUTUBE");
  const tt = statusFor("TIKTOK");
  const isRanking = !!clip.category;
  const isProduct = !!clip.affiliateLink;
  const videoSrc = clip.videoUrl ? `${clip.videoUrl}?v=${videoVersion}` : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-800">
      <div className="flex flex-col sm:flex-row">
        <div className="flex aspect-[9/16] w-full items-center justify-center bg-black sm:w-48 shrink-0">
          {clip.status === "READY" && videoSrc ? (
            <video src={videoSrc} poster={clip.thumbnailUrl ?? undefined} controls className="h-full w-full object-cover" />
          ) : clip.status === "FAILED" ? (
            <p className="p-3 text-center text-xs text-red-400">Error generando el clip</p>
          ) : (
            <p className="p-3 text-center text-xs text-slate-500">Generando…</p>
          )}
        </div>

        <div className="flex-1 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ViralityBadge score={clip.viralityScore} />
            {isRanking ? (
              <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-xs text-brand-400">
                Ranking · {clip.category}
              </span>
            ) : isProduct ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
                Publicidad de producto
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                {formatTime(clip.startSec)} – {formatTime(clip.endSec)}
              </span>
            )}
          </div>

          <h3 className="mt-2 text-base font-semibold text-slate-50">{clip.title}</h3>
          <p className="mt-1 text-sm text-slate-400">{clip.description}</p>
          <p className="mt-1 text-xs italic text-slate-500">Por qué puede ser viral: {clip.viralityReason}</p>

          {isRanking && clip.rankingItems && clip.rankingItems.length > 0 && (
            <ol className="mt-3 space-y-1 rounded-xl border border-ink-600 bg-ink-900/40 p-3 text-xs text-slate-300">
              {[...clip.rankingItems]
                .sort((a, b) => b.position - a.position)
                .map((item) => (
                  <li key={item.id}>
                    <span className="font-semibold text-brand-400">#{item.position}</span> {item.label}
                  </li>
                ))}
            </ol>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {clip.hashtags.map((tag) => (
              <span key={tag} className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-slate-300">
                #{tag}
              </span>
            ))}
          </div>

          {clip.affiliateLink && (
            <div className="mt-3 rounded-xl border border-amber-600/40 bg-amber-500/10 p-3 text-xs text-amber-300">
              <p className="font-semibold">🔗 Enlace de afiliado (recuerda añadirlo en la descripción/bio):</p>
              <p className="mt-1 break-all text-amber-200">{clip.affiliateLink}</p>
            </div>
          )}

          {(clip.commentaryIntro || clip.commentaryOutro) && (
            <div className="mt-3 rounded-xl border border-ink-600 bg-ink-900/40 p-3 text-xs text-slate-300">
              <p className="mb-1 font-semibold text-slate-400">🎙️ Comentario narrado con IA (voz añadida al vídeo)</p>
              {clip.commentaryIntro && <p>「 {clip.commentaryIntro} 」 — intro</p>}
              {clip.commentaryOutro && <p className="mt-1">「 {clip.commentaryOutro} 」 — cierre</p>}
            </div>
          )}

          {isRanking && clip.status === "READY" && (
            <MusicPanel clip={clip} onApplied={() => setVideoVersion((v) => v + 1)} />
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              disabled={clip.status !== "READY" || publishing === "YOUTUBE"}
              onClick={() => publish("YOUTUBE")}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {yt?.status === "PUBLISHED" ? "✓ Publicado en YouTube" : publishing === "YOUTUBE" ? "Subiendo…" : "Publicar en YouTube"}
            </button>
            <button
              disabled={clip.status !== "READY" || publishing === "TIKTOK"}
              onClick={() => publish("TIKTOK")}
              className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40"
            >
              {tt?.status === "DRAFT" ? "✓ Borrador en TikTok" : publishing === "TIKTOK" ? "Subiendo…" : "Enviar a TikTok"}
            </button>
            {clip.status === "READY" && (
              <a
                href={`/api/clips/${clip.id}/download`}
                className="rounded-lg border border-ink-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-brand-500"
              >
                ⬇ Descargar
              </a>
            )}
            {yt?.remoteUrl && (
              <a href={yt.remoteUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-400 underline">
                Ver en YouTube
              </a>
            )}
          </div>
          {note && <p className="mt-2 text-xs text-slate-400">{note}</p>}
        </div>
      </div>
    </div>
  );
}
