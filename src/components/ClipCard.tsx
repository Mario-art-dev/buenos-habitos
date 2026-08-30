"use client";

import { useState } from "react";
import Link from "next/link";
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
  error?: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  category?: string | null;
  musicRecommended?: boolean;
  musicQuery?: string | null;
  musicSuggestedSection?: string | null;
  musicEnabled?: boolean;
  musicSourceUrl?: string | null;
  musicStartSec?: number | null;
  commentaryIntro?: string | null;
  commentaryOutro?: string | null;
  affiliateLink?: string | null;
  rankingItems?: RankingItemData[];
  publications: {
    id: string;
    platform: string;
    status: string;
    remoteUrl: string | null;
    error: string | null;
    note?: string | null;
  }[];
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Convierte "1:15" o "1:15-2:00" (se coge solo el primer número) a segundos, para rellenar el
// campo "empezar en" con la sección que la IA sugirió y ahorrarle el cálculo al usuario.
function parseSuggestedStartSec(section: string | null | undefined): number {
  if (!section) return 0;
  const match = section.match(/(\d+):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Espera a que termine un render en segundo plano ya arrancado (POST que solo confirma que
 * empezó — ver /api/clips/[id]/regenerate y /api/clips/[id]/music) preguntando el estado del clip
 * cada 3s hasta que renderPending se ponga a false. Compartido por "Reintentar" y por añadir/
 * quitar música, que por dentro también disparan un regenerado completo.
 */
async function waitForRenderDone(
  clipId: string
): Promise<Partial<ClipData> & { error: string | null }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const res = await fetch(`/api/clips/${clipId}`);
      if (!res.ok) continue;
      const data: { clip?: ClipData & { renderPending?: boolean } } = await res.json();
      if (!data.clip || data.clip.renderPending) continue;
      return { ...data.clip, error: data.clip.error ?? null };
    } catch {
      // fallo puntual preguntando el estado, se reintenta en la siguiente vuelta
    }
  }
  throw new Error("Sigue procesándose en el servidor (está tardando más de lo normal). Recarga la página en un rato.");
}

function MusicPanel({ clip, onApplied }: { clip: ClipData; onApplied: (updated: Partial<ClipData>) => void }) {
  const [url, setUrl] = useState(clip.musicSourceUrl ?? "");
  const [startSec, setStartSec] = useState(clip.musicStartSec ?? parseSuggestedStartSec(clip.musicSuggestedSection));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Añadir/quitar música vuelve a mezclar el vídeo entero (para SINGLE/SPLIT eso es un
  // regenerado completo por dentro) — igual que "Guardar y regenerar" y "Reintentar", puede tardar
  // más de lo que aguanta abierta una sola petición el túnel gratuito. La ruta solo confirma que
  // ha empezado; aquí se pregunta el resultado con GET hasta que renderPending se ponga a false.
  async function runAndWait(startFetch: () => Promise<Response>, failMessage: string) {
    setLoading(true);
    setError(null);
    try {
      const startRes = await startFetch();
      if (!startRes.ok) {
        const startData = await startRes.json().catch(() => null);
        throw new Error(startData?.error ?? failMessage);
      }
      const result = await waitForRenderDone(clip.id);
      if (result.error) throw new Error(result.error);
      onApplied(result);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    return runAndWait(
      () =>
        fetch(`/api/clips/${clip.id}/music`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ musicSourceUrl: url, musicStartSec: startSec }),
        }),
      "No se pudo añadir la música"
    );
  }

  function remove() {
    return runAndWait(() => fetch(`/api/clips/${clip.id}/music`, { method: "DELETE" }), "No se pudo quitar la música");
  }

  return (
    <div className="mt-3 rounded-xl border border-ink-600 bg-ink-900/60 p-3">
      {clip.musicRecommended && !clip.musicEnabled && (
        <p className="text-xs text-slate-500">
          🎵 La IA recomendó música ({clip.musicQuery || "sin sugerencia concreta"}
          {clip.musicSuggestedSection && ` · sección ${clip.musicSuggestedSection}`}) pero no se pudo aplicar
          sola al generar el short. Puedes añadirla a mano abajo.
        </p>
      )}
      {clip.musicEnabled && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-xs text-emerald-400">
            ✓ Música activada{clip.musicQuery ? `: ${clip.musicQuery}` : ""}
            {clip.musicStartSec != null ? ` · desde ${formatTime(clip.musicStartSec)}` : ""}
          </p>
          <button
            disabled={loading}
            onClick={remove}
            className="rounded-lg border border-red-900 px-2 py-0.5 text-xs font-medium text-red-400 hover:border-red-500 disabled:opacity-40"
          >
            {loading ? "Quitando…" : "🗑️ Quitar canción"}
          </button>
        </div>
      )}
      {!open ? (
        <div className="mt-2 flex flex-wrap gap-3">
          <button onClick={() => setOpen(true)} className="text-xs text-brand-400 underline">
            {clip.musicEnabled ? "Cambiar música" : "Añadir música (pegar link de YouTube)"}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-brand-500"
          />
          <div className="flex flex-wrap items-center gap-2">
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
              {loading ? "Aplicando…" : clip.musicEnabled ? "Actualizar vídeo" : "Añadir canción"}
            </button>
            <button
              disabled={loading}
              onClick={() => setOpen(false)}
              className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
            >
              Cancelar
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

  const [clipStatus, setClipStatus] = useState(clip.status);
  const [clipError, setClipError] = useState(clip.error ?? null);
  const [retrying, setRetrying] = useState(false);
  const [musicState, setMusicState] = useState({
    musicEnabled: clip.musicEnabled ?? false,
    musicSourceUrl: clip.musicSourceUrl ?? null,
    musicStartSec: clip.musicStartSec ?? null,
  });

  async function retryClip() {
    setRetrying(true);
    try {
      const startRes = await fetch(`/api/clips/${clip.id}/regenerate`, { method: "POST" });
      if (!startRes.ok) {
        const startData = await startRes.json().catch(() => null);
        throw new Error(startData?.error ?? "No se pudo reintentar");
      }
      const result = await waitForRenderDone(clip.id);
      if (result.error) throw new Error(result.error);
      setClipStatus("READY");
      setClipError(null);
      setVideoVersion((v) => v + 1);
    } catch (err) {
      setClipError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  const [editingMeta, setEditingMeta] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [title, setTitle] = useState(clip.title);
  const [description, setDescription] = useState(clip.description);
  const [hashtagsText, setHashtagsText] = useState(clip.hashtags.join(", "));
  const [hashtags, setHashtags] = useState(clip.hashtags);

  async function saveMeta() {
    setSavingMeta(true);
    setMetaError(null);
    try {
      const nextHashtags = hashtagsText
        .split(",")
        .map((h) => h.trim().replace(/^#/, ""))
        .filter(Boolean)
        .slice(0, 5);
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, hashtags: nextHashtags }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      setHashtags(nextHashtags);
      setEditingMeta(false);
    } catch (err) {
      setMetaError((err as Error).message);
    } finally {
      setSavingMeta(false);
    }
  }

  function cancelMeta() {
    setTitle(clip.title);
    setDescription(clip.description);
    setHashtagsText(hashtags.join(", "));
    setMetaError(null);
    setEditingMeta(false);
  }

  // Antes solo se buscaba la publicación NO fallida, así que un intento fallido (p.ej. del
  // programador automático, que publica en segundo plano sin que el usuario vea nada) quedaba
  // completamente invisible: el botón volvía a su estado normal como si nunca se hubiera
  // intentado, sin ningún indicio de por qué TikTok/YouTube no recibió el vídeo. Se coge la
  // publicación MÁS RECIENTE de esa plataforma tenga el estado que tenga, para poder mostrar el
  // error real cuando lo haya.
  const statusFor = (platform: string) =>
    [...publications].reverse().find((p) => p.platform === platform);

  async function publish(platform: "YOUTUBE" | "TIKTOK") {
    setPublishing(platform);
    setNote(null);
    // Solo se espera aquí a que el servidor CONFIRME que ha empezado — la subida de verdad (varias
    // llamadas a TikTok/YouTube + el archivo del vídeo) sigue después en el servidor sin depender
    // de esta petición, porque mantenerla abierta todo el rato se cortaba con un 502 en el túnel
    // gratuito antes de terminar (visto en real como "The string did not match the expected
    // pattern." al no poder leer esa página de error como JSON). Aquí solo se arranca y luego se
    // pregunta el resultado con GET, sin depender de que la conexión aguante abierta.
    try {
      const startRes = await fetch(`/api/clips/${clip.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({}) as { error?: string });
        setNote(errData.error ?? `Fallo al iniciar la publicación (código ${startRes.status})`);
        setPublishing(null);
        return;
      }
    } catch (err) {
      setNote(`Fallo de conexión al iniciar la publicación: ${(err as Error).message}`);
      setPublishing(null);
      return;
    }

    // Hasta 2 minutos preguntando cada 3s, tiempo de sobra para que termine la subida real.
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const pollRes = await fetch(`/api/clips/${clip.id}`);
        if (!pollRes.ok) continue;
        const pollData: { clip?: { publications?: ClipData["publications"] } } = await pollRes.json();
        const matches = (pollData.clip?.publications ?? []).filter((p) => p.platform === platform);
        const latest = matches[matches.length - 1];
        if (latest && latest.status !== "UPLOADING") {
          setPublications((prev) => [...prev.filter((p) => p.platform !== platform), latest]);
          if (latest.note) setNote(latest.note);
          setPublishing(null);
          return;
        }
      } catch {
        // fallo puntual preguntando el estado, se reintenta en la siguiente vuelta
      }
    }
    setNote("Sigue publicándose en el servidor (está tardando más de lo normal). Recarga la página en un rato para ver el resultado.");
    setPublishing(null);
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
          {clipStatus === "READY" && videoSrc ? (
            <video src={videoSrc} poster={clip.thumbnailUrl ?? undefined} controls className="h-full w-full object-cover" />
          ) : clipStatus === "FAILED" ? (
            <div className="p-3 text-center">
              <p className="text-xs text-red-400">Error generando el clip{clipError ? `: ${clipError}` : ""}</p>
              <button
                disabled={retrying}
                onClick={retryClip}
                className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {retrying ? "Reintentando…" : "🔁 Reintentar"}
              </button>
            </div>
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

          {editingMeta ? (
            <div className="mt-2 space-y-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título"
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm font-semibold text-slate-100 outline-none focus:border-brand-500"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descripción"
                rows={2}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm text-slate-300 outline-none focus:border-brand-500"
              />
              <input
                type="text"
                value={hashtagsText}
                onChange={(e) => setHashtagsText(e.target.value)}
                placeholder="hashtags separados por comas (solo TikTok, máx. 5)"
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-brand-500"
              />
              {metaError && <p className="text-xs text-red-400">{metaError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={saveMeta}
                  disabled={savingMeta || !title.trim()}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {savingMeta ? "Guardando…" : "Guardar"}
                </button>
                <button
                  onClick={cancelMeta}
                  disabled={savingMeta}
                  className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-2 flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-50">{title}</h3>
                <button
                  onClick={() => setEditingMeta(true)}
                  className="shrink-0 text-xs text-slate-400 underline hover:text-slate-300"
                >
                  ✏️ Editar
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-400">{description}</p>
            </>
          )}
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

          {!editingMeta && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {hashtags.map((tag) => (
                <span key={tag} className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-slate-300">
                  #{tag}
                </span>
              ))}
            </div>
          )}

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

          {clipStatus === "READY" && (
            <MusicPanel
              clip={{ ...clip, ...musicState }}
              onApplied={(updated) => {
                setMusicState({
                  musicEnabled: updated.musicEnabled ?? false,
                  musicSourceUrl: updated.musicSourceUrl ?? null,
                  musicStartSec: updated.musicStartSec ?? null,
                });
                setVideoVersion((v) => v + 1);
              }}
            />
          )}

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                yt?.status === "PUBLISHED"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : yt?.status === "FAILED"
                    ? "bg-red-500/15 text-red-400"
                    : yt?.status === "UPLOADING"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-ink-700 text-slate-400"
              }`}
            >
              {yt?.status === "PUBLISHED"
                ? "✅ Publicado en YouTube"
                : yt?.status === "FAILED"
                  ? "⚠️ Falló en YouTube"
                  : yt?.status === "UPLOADING"
                    ? "⏳ Subiendo a YouTube"
                    : "◻️ No publicado en YouTube"}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                tt?.status === "PUBLISHED" || tt?.status === "DRAFT"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : tt?.status === "FAILED"
                    ? "bg-red-500/15 text-red-400"
                    : tt?.status === "UPLOADING"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-ink-700 text-slate-400"
              }`}
            >
              {tt?.status === "PUBLISHED" || tt?.status === "DRAFT"
                ? "✅ Publicado en TikTok"
                : tt?.status === "FAILED"
                  ? "⚠️ Falló en TikTok"
                  : tt?.status === "UPLOADING"
                    ? "⏳ Subiendo a TikTok"
                    : "◻️ No publicado en TikTok"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              disabled={clipStatus !== "READY" || publishing === "YOUTUBE"}
              onClick={() => publish("YOUTUBE")}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {yt?.status === "PUBLISHED"
                ? "✓ Publicado en YouTube"
                : publishing === "YOUTUBE"
                  ? "Subiendo…"
                  : yt?.status === "FAILED"
                    ? "⚠️ Falló — reintentar en YouTube"
                    : "Publicar en YouTube"}
            </button>
            <button
              disabled={clipStatus !== "READY" || publishing === "TIKTOK"}
              onClick={() => publish("TIKTOK")}
              className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40"
            >
              {tt?.status === "PUBLISHED" || tt?.status === "DRAFT"
                ? "✓ Publicado en TikTok"
                : publishing === "TIKTOK"
                  ? "Subiendo…"
                  : tt?.status === "FAILED"
                    ? "⚠️ Falló — reintentar en TikTok"
                    : "Publicar en TikTok"}
            </button>
            {clipStatus === "READY" && (
              <a
                href={`/api/clips/${clip.id}/download`}
                className="rounded-lg border border-ink-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-brand-500"
              >
                ⬇ Descargar
              </a>
            )}
            {clipStatus === "READY" && (
              <Link
                href={`/clips/${clip.id}/edit`}
                className="rounded-lg border border-ink-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-brand-500"
              >
                ✏️ Editar
              </Link>
            )}
            {yt?.remoteUrl && (
              <a href={yt.remoteUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-400 underline">
                Ver en YouTube
              </a>
            )}
          </div>
          {yt?.status === "FAILED" && yt.error && (
            <p className="mt-2 text-xs text-red-400">YouTube: {yt.error}</p>
          )}
          {tt?.status === "FAILED" && tt.error && (
            <p className="mt-2 text-xs text-red-400">TikTok: {tt.error}</p>
          )}
          {note && <p className="mt-2 text-xs text-slate-400">{note}</p>}
        </div>
      </div>
    </div>
  );
}
