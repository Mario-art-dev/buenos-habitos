"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface CueWord {
  start: number;
  end: number;
  text: string;
}

interface StoredCue {
  id: string;
  start: number;
  end: number;
  words: CueWord[];
  editedText?: string | null;
  deleted?: boolean;
}

interface CustomTextElement {
  id: string;
  text: string;
  start: number;
  end: number;
  xPct: number;
  yPct: number;
  fontName: string;
  fontSize: number;
  colorHex: string;
  uppercase?: boolean;
}

interface ClipData {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  status: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  captionCues: StoredCue[];
  customTexts: CustomTextElement[];
}

// Fuentes libres instaladas en el servidor de render (ver Dockerfile/workflows) — los nombres
// tienen que coincidir EXACTAMENTE con el nombre de familia que resuelve fontconfig, o el vídeo
// final no usará la fuente elegida aquí en la vista previa.
const FONT_OPTIONS = [
  "Comic Neue",
  "Bebas Neue",
  "Anton",
  "Montserrat",
  "Poppins",
  "Oswald",
  "Permanent Marker",
  "Bangers",
  "Lobster",
  "Archivo Black",
  "Caveat",
  "Liberation Sans",
];

const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Anton&family=Montserrat:wght@700&family=Poppins:wght@700&family=Oswald:wght@700&family=Permanent+Marker&family=Bangers&family=Lobster&family=Archivo+Black&family=Caveat:wght@700&display=swap";

function cueText(cue: StoredCue): string {
  if (cue.editedText != null) return cue.editedText;
  return cue.words.map((w) => w.text).join(" ");
}

function newCustomText(durationSec: number): CustomTextElement {
  return {
    id: crypto.randomUUID(),
    text: "Nuevo texto",
    start: 0,
    end: Math.max(1, durationSec),
    xPct: 50,
    yPct: 30,
    fontName: "Bangers",
    fontSize: 90,
    colorHex: "FFFFFF",
    uppercase: false,
  };
}

export default function EditClipClient({ clipId }: { clipId: string }) {
  const router = useRouter();
  const [clip, setClip] = useState<ClipData | null>(null);
  const [cues, setCues] = useState<StoredCue[]>([]);
  const [texts, setTexts] = useState<CustomTextElement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoVersion, setVideoVersion] = useState(0);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const draggingId = useRef<string | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/clips/${clipId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar el clip");
        setLoading(false);
        return;
      }
      setClip(data.clip);
      setCues(data.clip.captionCues);
      setTexts(data.clip.customTexts);
      setLoading(false);
    }
    load();
  }, [clipId]);

  const duration = clip ? clip.endSec - clip.startSec : 0;

  function updateCueText(id: string, text: string) {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, editedText: text } : c)));
  }

  function toggleCueDeleted(id: string) {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, deleted: !c.deleted } : c)));
  }

  function addText() {
    const el = newCustomText(duration);
    setTexts((prev) => [...prev, el]);
    setSelectedTextId(el.id);
  }

  function updateText(id: string, patch: Partial<CustomTextElement>) {
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function removeText(id: string) {
    setTexts((prev) => prev.filter((t) => t.id !== id));
    if (selectedTextId === id) setSelectedTextId(null);
  }

  // Arrastre con puntero (funciona con ratón Y con el dedo en pantallas táctiles, Pointer Events
  // es un único API para los dos casos, no hace falta código aparte para touch).
  function onPointerDownText(e: React.PointerEvent, id: string) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingId.current = id;
    setSelectedTextId(id);
  }

  function onPointerMoveOverlay(e: React.PointerEvent) {
    const id = draggingId.current;
    if (!id || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    updateText(id, { xPct, yPct });
  }

  function onPointerUpOverlay() {
    draggingId.current = null;
  }

  async function saveAndRegenerate() {
    setSaving(true);
    setError(null);
    try {
      const putRes = await fetch(`/api/clips/${clipId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captionCues: cues, customTexts: texts }),
      });
      const putData = await putRes.json();
      if (!putRes.ok) throw new Error(putData.error ?? "No se pudieron guardar los cambios");

      const regenRes = await fetch(`/api/clips/${clipId}/regenerate`, { method: "POST" });
      const regenData = await regenRes.json();
      if (!regenRes.ok) throw new Error(regenData.error ?? "No se pudo regenerar el vídeo");

      setClip((prev) => (prev ? { ...prev, videoUrl: regenData.videoUrl, thumbnailUrl: regenData.thumbnailUrl } : prev));
      setVideoVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (!clip) return <p className="text-sm text-red-400">{error ?? "Clip no encontrado"}</p>;

  const videoSrc = clip.videoUrl ? `${clip.videoUrl}?v=${videoVersion}` : null;

  return (
    <div>
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-50">Editar: {clip.title}</h1>
        <button onClick={() => router.back()} className="text-sm text-slate-400 underline">
          ← Volver
        </button>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Vista previa con los textos arrastrables encima */}
        <div className="w-full shrink-0 md:w-72">
          <div
            ref={overlayRef}
            className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-black"
            onPointerMove={onPointerMoveOverlay}
            onPointerUp={onPointerUpOverlay}
          >
            {videoSrc && (
              <video src={videoSrc} poster={clip.thumbnailUrl ?? undefined} controls className="h-full w-full object-cover" />
            )}
            {texts.map((t) => (
              <div
                key={t.id}
                onPointerDown={(e) => onPointerDownText(e, t.id)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-move select-none whitespace-nowrap px-1 text-center leading-none ${
                  selectedTextId === t.id ? "outline outline-2 outline-brand-500" : ""
                }`}
                style={{
                  left: `${t.xPct}%`,
                  top: `${t.yPct}%`,
                  fontFamily: `"${t.fontName}", sans-serif`,
                  color: `#${t.colorHex}`,
                  fontSize: `${Math.round(t.fontSize / 6)}px`,
                  WebkitTextStroke: "1px black",
                  textTransform: t.uppercase ? "uppercase" : "none",
                }}
              >
                {t.text || "(vacío)"}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Arrastra un texto para moverlo — el tamaño real en el vídeo es mayor que en esta vista previa.
          </p>
        </div>

        <div className="flex-1 space-y-6">
          {/* Subtítulos automáticos */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-300">Subtítulos generados automáticamente</h2>
            <div className="space-y-2">
              {cues.length === 0 && <p className="text-xs text-slate-500">Este clip no tiene subtítulos guardados.</p>}
              {cues.map((cue) => (
                <div
                  key={cue.id}
                  className={`flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-900/50 p-2 ${
                    cue.deleted ? "opacity-40" : ""
                  }`}
                >
                  <input
                    type="text"
                    value={cueText(cue)}
                    disabled={cue.deleted}
                    onChange={(e) => updateCueText(cue.id, e.target.value)}
                    className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-brand-500 disabled:opacity-50"
                  />
                  <button
                    onClick={() => toggleCueDeleted(cue.id)}
                    className="rounded-lg border border-ink-600 px-2 py-1 text-xs text-slate-300 hover:border-red-500 hover:text-red-400"
                  >
                    {cue.deleted ? "Restaurar" : "🗑 Borrar"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Textos personalizados */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">Textos añadidos</h2>
              <button onClick={addText} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
                + Añadir texto
              </button>
            </div>
            <div className="space-y-3">
              {texts.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTextId(t.id)}
                  className={`cursor-pointer rounded-xl border p-3 ${
                    selectedTextId === t.id ? "border-brand-500 bg-ink-900/70" : "border-ink-600 bg-ink-900/40"
                  }`}
                >
                  <input
                    type="text"
                    value={t.text}
                    onChange={(e) => updateText(t.id, { text: e.target.value })}
                    className="mb-2 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-brand-500"
                    placeholder="Texto"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={t.fontName}
                      onChange={(e) => updateText(t.id, { fontName: e.target.value })}
                      className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-slate-200"
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                    <input
                      type="color"
                      value={`#${t.colorHex}`}
                      onChange={(e) => updateText(t.id, { colorHex: e.target.value.replace("#", "") })}
                      className="h-7 w-9 rounded border border-ink-600 bg-ink-900"
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-400">
                      Tamaño
                      <input
                        type="number"
                        min={20}
                        max={300}
                        value={t.fontSize}
                        onChange={(e) => updateText(t.id, { fontSize: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-slate-200"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={!!t.uppercase}
                        onChange={(e) => updateText(t.id, { uppercase: e.target.checked })}
                      />
                      MAYÚSCULAS
                    </label>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <label className="flex items-center gap-1">
                      Desde (s)
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={t.start}
                        onChange={(e) => updateText(t.id, { start: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-slate-200"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      Hasta (s)
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={t.end}
                        onChange={(e) => updateText(t.id, { end: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-slate-200"
                      />
                    </label>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeText(t.id);
                      }}
                      className="ml-auto text-red-400 hover:underline"
                    >
                      🗑 Quitar
                    </button>
                  </div>
                </div>
              ))}
              {texts.length === 0 && <p className="text-xs text-slate-500">Todavía no has añadido ningún texto.</p>}
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={saveAndRegenerate}
            disabled={saving}
            className="w-full rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Regenerando el vídeo…" : "Guardar y regenerar vídeo"}
          </button>
        </div>
      </div>
    </div>
  );
}
