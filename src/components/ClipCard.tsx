"use client";

import { useState } from "react";
import ViralityBadge from "./ViralityBadge";

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
  publications: { id: string; platform: string; status: string; remoteUrl: string | null; error: string | null }[];
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ClipCard({ clip }: { clip: ClipData }) {
  const [publications, setPublications] = useState(clip.publications);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-800">
      <div className="flex flex-col sm:flex-row">
        <div className="flex aspect-[9/16] w-full items-center justify-center bg-black sm:w-48 shrink-0">
          {clip.status === "READY" && clip.videoUrl ? (
            <video src={clip.videoUrl} poster={clip.thumbnailUrl ?? undefined} controls className="h-full w-full object-cover" />
          ) : clip.status === "FAILED" ? (
            <p className="p-3 text-center text-xs text-red-400">Error generando el clip</p>
          ) : (
            <p className="p-3 text-center text-xs text-slate-500">Generando…</p>
          )}
        </div>

        <div className="flex-1 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ViralityBadge score={clip.viralityScore} />
            <span className="text-xs text-slate-500">
              {formatTime(clip.startSec)} – {formatTime(clip.endSec)}
            </span>
          </div>

          <h3 className="mt-2 text-base font-semibold text-slate-50">{clip.title}</h3>
          <p className="mt-1 text-sm text-slate-400">{clip.description}</p>
          <p className="mt-1 text-xs italic text-slate-500">Por qué puede ser viral: {clip.viralityReason}</p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {clip.hashtags.map((tag) => (
              <span key={tag} className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-slate-300">
                #{tag}
              </span>
            ))}
          </div>

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
