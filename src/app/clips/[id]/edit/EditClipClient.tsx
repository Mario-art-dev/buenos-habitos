"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { EditorComposition, type CompositionCustomText } from "./EditorComposition";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { toUploadableJpeg } from "@/lib/toUploadableJpeg";

interface CueWord {
  start: number;
  end: number;
  text: string;
}

interface CueStyle {
  fontName?: string;
  fontSize?: number;
  colorHex?: string;
  xPct?: number;
  yPct?: number;
}

interface StoredCue {
  id: string;
  start: number;
  end: number;
  words: CueWord[];
  editedText?: string | null;
  deleted?: boolean;
  style?: CueStyle | null;
}

// Estilo por defecto del caption grande (ver defaultBigCaptionsStyle en bigCaptions.ts) — se usa
// para que los controles de la fila de un golpe SIN estilo propio arranquen con estos valores en
// vez de vacíos.
const DEFAULT_CUE_FONT = "Comic Neue";
const DEFAULT_CUE_COLOR = "FFFFFF";
function defaultCueFontSize(resolution: { width: number } | null): number {
  return resolution ? Math.round(resolution.width / 14) : 77;
}

type CustomTextElement = CompositionCustomText;

interface RankingItemData {
  id: string;
  position: number;
  label: string;
}

interface ClipData {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  effectiveStartSec: number | null;
  status: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  sourceVideoUrl: string | null;
  captionCues: StoredCue[];
  customTexts: CustomTextElement[];
  jobMode: string | null;
  coverFrameSec: number | null;
  coverTitle: string | null;
  coverImageUrl: string | null;
  captionsEnabled: boolean;
  // Solo RANKING: rellenan la plantilla fija del título quemado en pantalla (ver
  // rankingListOverlay.ts) — "TOPIC" -> "Ranking Funniest {category} Moments", "YOUTUBER" ->
  // "Best 5 {category} Clips".
  category: string | null;
  introTemplate: string | null;
  // Solo SPLIT/DOUBLE: título propio quemado en pantalla (ver Job.customTitle).
  customTitle: string | null;
  // Solo RANKING: etiqueta en pantalla de cada puesto del listado numerado.
  rankingItems: RankingItemData[] | null;
  renderPending?: boolean;
  error?: string | null;
}

// Reloj virtual de la composición de Remotion — no tiene por qué coincidir con el fps real del
// vídeo fuente, solo define en cuántos "pasos" se divide la línea de tiempo del editor.
const FPS = 30;
const THUMBNAIL_COUNT = 14;

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

// Misma lógica que pickVerticalResolution en src/lib/pipeline/probe.ts — se replica aquí porque
// el editor necesita saberla en el navegador (para que compositionWidth/Height, y por tanto el
// tamaño real de los textos en px, coincida con lo que hará el servidor) sin pedirla a una API
// aparte: basta con medir el vídeo fuente que ya se está cargando para la vista previa.
function pickVerticalResolution(sourceW: number, sourceH: number) {
  const m = Math.max(sourceW, sourceH);
  if (m >= 3840) return { width: 2160, height: 3840 };
  if (m >= 2560) return { width: 1440, height: 2560 };
  return { width: 1080, height: 1920 };
}

function cueText(cue: StoredCue): string {
  if (cue.editedText != null) return cue.editedText;
  return cue.words.map((w) => w.text).join(" ");
}

function newCustomText(durationSec: number): CustomTextElement {
  return {
    id: crypto.randomUUID(),
    text: "Nuevo texto",
    start: 0,
    end: Math.max(1, Math.min(3, durationSec)),
    xPct: 50,
    yPct: 30,
    fontName: "Bangers",
    fontSize: 90,
    colorHex: "FFFFFF",
    uppercase: false,
  };
}

// Reproduce el mismo formateo de rankingListOverlay.ts (buildTitleLines) para que la vista previa
// del editor coincida EXACTAMENTE con lo que se va a quemar en el vídeo tras regenerar.
function previewRankingTitle(category: string, template: string): string {
  const cat = category
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  if (!cat) return "…";
  return template === "YOUTUBER" ? `Best 5 ${cat} Clips` : `Ranking Funniest ${cat} Moments`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

/** Recorte: desplaza cues/textos por `offset` segundos y recorta lo que quede fuera de [0, newDuration]. */
function shiftCues(cues: StoredCue[], offset: number, newDuration: number): StoredCue[] {
  return cues
    .map((c) => ({
      ...c,
      start: c.start - offset,
      end: c.end - offset,
      words: c.words.map((w) => ({ ...w, start: w.start - offset, end: w.end - offset })),
    }))
    .filter((c) => c.end > 0 && c.start < newDuration)
    .map((c) => ({
      ...c,
      start: Math.max(0, c.start),
      end: Math.min(newDuration, c.end),
      words: c.words
        .filter((w) => w.end > 0 && w.start < newDuration)
        .map((w) => ({ ...w, start: Math.max(0, w.start), end: Math.min(newDuration, w.end) })),
    }));
}

function shiftTexts(texts: CustomTextElement[], offset: number, newDuration: number): CustomTextElement[] {
  return texts
    .map((t) => ({ ...t, start: t.start - offset, end: t.end - offset }))
    .filter((t) => t.end > 0 && t.start < newDuration)
    .map((t) => ({ ...t, start: Math.max(0, t.start), end: Math.min(newDuration, t.end) }));
}

/** Recorte centrado tipo CSS object-fit:cover, para que las miniaturas se parezcan al recorte vertical real. */
function drawCoverThumbnail(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h: number) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const targetRatio = w / h;
  const srcRatio = vw / vh;
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;
  if (srcRatio > targetRatio) {
    sw = vh * targetRatio;
    sx = (vw - sw) / 2;
  } else {
    sh = vw / targetRatio;
    sy = (vh - sh) / 2;
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
}

function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    function onSeeked() {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    }
    video.addEventListener("seeked", onSeeked);
    video.currentTime = t;
  });
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
  const [expandedCueStyleId, setExpandedCueStyleId] = useState<string | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  // Portada (solo SINGLE/SPLIT): null = usar el fotograma/título automático de coverCard.ts.
  const [coverFrameSec, setCoverFrameSec] = useState<number | null>(null);
  const [coverTitle, setCoverTitle] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  // Solo RANKING: categoría/plantilla del título quemado y etiqueta en pantalla de cada puesto.
  const [category, setCategory] = useState("");
  const [introTemplate, setIntroTemplate] = useState<"TOPIC" | "YOUTUBER">("TOPIC");
  const [rankingItemLabels, setRankingItemLabels] = useState<RankingItemData[]>([]);
  // Solo SPLIT/DOUBLE: título propio quemado en pantalla.
  const [customTitle, setCustomTitle] = useState("");
  const coverImageInputRef = useRef<HTMLInputElement | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const draggingId = useRef<string | null>(null);
  const draggingHandle = useRef<"start" | "end" | null>(null);
  const resizingRef = useRef<{ id: string; anchorX: number; anchorY: number; baseDistance: number; baseFontSize: number } | null>(
    null
  );
  const textDragRef = useRef<{ id: string; mode: "move" | "resize-start" | "resize-end"; startX: number; origStart: number; origEnd: number } | null>(
    null
  );

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
      const dur = data.clip.endSec - (data.clip.effectiveStartSec ?? data.clip.startSec);
      setTrimStart(0);
      setTrimEnd(dur);
      setCoverFrameSec(data.clip.coverFrameSec);
      setCoverTitle(data.clip.coverTitle ?? data.clip.title);
      setCoverImageUrl(data.clip.coverImageUrl);
      setCaptionsEnabled(data.clip.captionsEnabled);
      setCategory(data.clip.category ?? "");
      setIntroTemplate(data.clip.introTemplate === "YOUTUBER" ? "YOUTUBER" : "TOPIC");
      setRankingItemLabels(data.clip.rankingItems ?? []);
      setCustomTitle(data.clip.customTitle ?? "");
      setLoading(false);
    }
    load();
  }, [clipId]);

  const clipStart = clip ? clip.effectiveStartSec ?? clip.startSec : 0;
  const duration = clip ? clip.endSec - clipStart : 0;

  // Mide la resolución nativa del vídeo fuente (para que compositionWidth/Height del Player
  // coincida con lo que usará el servidor) y genera las miniaturas de la línea de tiempo.
  useEffect(() => {
    if (!clip?.sourceVideoUrl || duration <= 0) return;
    let cancelled = false;
    const video = document.createElement("video");
    // Tiene que estar realmente en el DOM (no solo creado en memoria) para que el navegador
    // cargue los metadatos/fotogramas de forma fiable — un <video> nunca insertado en el árbol
    // no siempre dispara "loadedmetadata" ni deja decodificar fotogramas para el canvas.
    video.style.position = "fixed";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    document.body.appendChild(video);
    video.src = clip.sourceVideoUrl;
    video.load();

    video.addEventListener(
      "loadedmetadata",
      async () => {
        if (cancelled) return;
        setResolution(pickVerticalResolution(video.videoWidth, video.videoHeight));

        const thumbW = 60;
        const thumbH = 107;
        const canvas = document.createElement("canvas");
        canvas.width = thumbW;
        canvas.height = thumbH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const results: string[] = [];
        for (let i = 0; i < THUMBNAIL_COUNT; i++) {
          if (cancelled) return;
          const t = clipStart + (duration * i) / (THUMBNAIL_COUNT - 1);
          try {
            await seekVideo(video, t);
            drawCoverThumbnail(ctx, video, thumbW, thumbH);
            results.push(canvas.toDataURL("image/jpeg", 0.6));
          } catch {
            // si un fotograma concreto falla, se sigue con el resto
          }
        }
        if (!cancelled) setThumbnails(results);
      },
      { once: true }
    );
    video.addEventListener("error", () => {
      // eslint-disable-next-line no-console
      console.error("No se pudo cargar el vídeo fuente para la vista previa del editor", video.error);
    });

    return () => {
      cancelled = true;
      video.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.sourceVideoUrl]);

  // Sincroniza el cabezal de la línea de tiempo con el fotograma actual del Player.
  const [playheadSec, setPlayheadSec] = useState(0);
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const handler = (e: { detail: { frame: number } }) => setPlayheadSec(e.detail.frame / FPS);
    p.addEventListener("frameupdate", handler);
    return () => p.removeEventListener("frameupdate", handler);
  }, [resolution]);

  function updateCueText(id: string, text: string) {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, editedText: text } : c)));
  }

  function toggleCueDeleted(id: string) {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, deleted: !c.deleted } : c)));
  }

  function updateCueStyle(id: string, patch: Partial<CueStyle>) {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, style: { ...c.style, ...patch } } : c)));
  }

  function resetCueStyle(id: string) {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, style: null } : c)));
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

  function updateRankingItemLabel(id: string, label: string) {
    setRankingItemLabels((prev) => prev.map((i) => (i.id === id ? { ...i, label } : i)));
  }

  // Arrastre con puntero (funciona con ratón Y con el dedo en pantallas táctiles, Pointer Events
  // es un único API para los dos casos, no hace falta código aparte para touch).
  function onPointerDownText(e: React.PointerEvent, id: string) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingId.current = id;
    setSelectedTextId(id);
  }

  // Tirador de la esquina de un texto seleccionado: arrastrarlo hacia fuera agranda la letra,
  // hacia dentro la encoge — el tamaño escala con la distancia al punto de anclaje del texto.
  function onPointerDownResize(e: React.PointerEvent, t: CustomTextElement) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (!overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const anchorX = rect.left + (t.xPct / 100) * rect.width;
    const anchorY = rect.top + (t.yPct / 100) * rect.height;
    const baseDistance = Math.max(10, Math.hypot(e.clientX - anchorX, e.clientY - anchorY));
    resizingRef.current = { id: t.id, anchorX, anchorY, baseDistance, baseFontSize: t.fontSize };
  }

  function onPointerMoveOverlay(e: React.PointerEvent) {
    if (draggingId.current && overlayRef.current) {
      const rect = overlayRef.current.getBoundingClientRect();
      const xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
      const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
      updateText(draggingId.current, { xPct, yPct });
      return;
    }
    if (resizingRef.current) {
      const { id, anchorX, anchorY, baseDistance, baseFontSize } = resizingRef.current;
      const dist = Math.max(10, Math.hypot(e.clientX - anchorX, e.clientY - anchorY));
      const newSize = Math.round(Math.min(300, Math.max(20, baseFontSize * (dist / baseDistance))));
      updateText(id, { fontSize: newSize });
    }
  }

  function onPointerUpOverlay() {
    draggingId.current = null;
    resizingRef.current = null;
  }

  // Barra de recorte sobre las miniaturas: dos tiradores (inicio/fin), mismo patrón de Pointer
  // Events que el resto — arrastrable con el dedo.
  function onPointerDownTrimHandle(e: React.PointerEvent, which: "start" | "end") {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingHandle.current = which;
  }

  function onPointerMoveStrip(e: React.PointerEvent) {
    if (!stripRef.current || duration <= 0) return;
    const rect = stripRef.current.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const sec = pct * duration;
    const which = draggingHandle.current;
    if (which === "start") {
      setTrimStart(Math.min(sec, trimEnd - 0.5));
    } else if (which === "end") {
      setTrimEnd(Math.max(sec, trimStart + 0.5));
    }
  }

  function onPointerUpStrip() {
    draggingHandle.current = null;
  }

  function onPointerDownStripBackground(e: React.PointerEvent) {
    if (!stripRef.current || !playerRef.current || duration <= 0) return;
    const rect = stripRef.current.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    playerRef.current.seekTo(Math.round(pct * duration * FPS));
  }

  // Pista de textos: arrastrar el bloque entero mueve el texto en el tiempo (conservando su
  // duración), arrastrar el borde izquierdo/derecho cambia solo ese extremo.
  function onPointerDownTextBlock(e: React.PointerEvent, t: CustomTextElement, mode: "move" | "resize-start" | "resize-end") {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    textDragRef.current = { id: t.id, mode, startX: e.clientX, origStart: t.start, origEnd: t.end };
    setSelectedTextId(t.id);
  }

  function onPointerMoveTrack(e: React.PointerEvent) {
    const d = textDragRef.current;
    if (!d || !trackRef.current || duration <= 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const deltaSec = ((e.clientX - d.startX) / rect.width) * duration;
    if (d.mode === "move") {
      const span = d.origEnd - d.origStart;
      const newStart = Math.max(0, Math.min(duration - span, d.origStart + deltaSec));
      updateText(d.id, { start: newStart, end: newStart + span });
    } else if (d.mode === "resize-start") {
      const newStart = Math.max(0, Math.min(d.origEnd - 0.2, d.origStart + deltaSec));
      updateText(d.id, { start: newStart });
    } else {
      const newEnd = Math.min(duration, Math.max(d.origStart + 0.2, d.origEnd + deltaSec));
      updateText(d.id, { end: newEnd });
    }
  }

  function onPointerUpTrack() {
    textDragRef.current = null;
  }

  async function uploadCoverImage(file: File) {
    setUploadingCover(true);
    setError(null);
    try {
      // Las fotos de la fototeca del iPhone se guardan en HEIC/HEIF por defecto (formato que el
      // servidor no puede procesar) y a veces pesan varios MB — se convierten a JPEG y se
      // redimensionan aquí mismo, en el navegador, antes de subir: así funciona con cualquier foto
      // de la fototeca y el archivo sube más rápido (menos probable que falle la subida por una
      // conexión móvil lenta). Si el navegador no puede leer el formato (createImageBitmap falla),
      // se sube el archivo original tal cual y el servidor da un error claro si no lo admite.
      const uploadFile = await toUploadableJpeg(file).catch(() => file);
      const form = new FormData();
      form.append("file", uploadFile);
      const res = await fetchWithRetry(`/api/clips/${clipId}/cover-image`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo subir la imagen");
      setCoverImageUrl(data.coverImageUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo subir la imagen (fallo de conexión, inténtalo otra vez)";
      setError(message);
    } finally {
      setUploadingCover(false);
    }
  }

  async function removeCoverImage() {
    setUploadingCover(true);
    setError(null);
    try {
      const res = await fetchWithRetry(`/api/clips/${clipId}/cover-image`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo quitar la imagen");
      setCoverImageUrl(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingCover(false);
    }
  }

  async function saveAndRegenerate() {
    if (!clip) return;
    setSaving(true);
    setError(null);
    try {
      const trimmed = trimStart > 0 || trimEnd < duration;
      const newDuration = trimEnd - trimStart;
      // Si se ha recortado, los tiempos guardados de cues/textos se desplazan para seguir
      // alineados con el nuevo inicio del clip (t=0 pasa a ser el instante trimStart de antes).
      const nextCues = trimmed ? shiftCues(cues, trimStart, newDuration) : cues;
      const nextTexts = trimmed ? shiftTexts(texts, trimStart, newDuration) : texts;
      const nextEffectiveStart = clipStart + trimStart;
      const nextEnd = clipStart + trimEnd;
      // Si el recorte deja el fotograma de portada elegido fuera del nuevo rango, se ajusta al
      // extremo más cercano en vez de perder la elección o que la API la rechace por estar fuera.
      const nextCoverFrameSec =
        coverFrameSec == null ? null : Math.min(Math.max(coverFrameSec, nextEffectiveStart), nextEnd);

      const putRes = await fetchWithRetry(`/api/clips/${clipId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captionCues: nextCues,
          customTexts: nextTexts,
          // Solo se manda el recorte en los modos donde de verdad significa algo (ver
          // trimEditable) — en RANKING/SONG, startSec/endSec son solo una referencia aproximada
          // del montaje final (varios tramos ya concatenados), mandarlos de vuelta sin cambios no
          // aporta nada y podía disparar una validación de "recorte demasiado corto" sin sentido.
          ...(trimEditable && { effectiveStartSec: nextEffectiveStart, endSec: nextEnd }),
          coverFrameSec: nextCoverFrameSec,
          coverTitle,
          captionsEnabled,
          // Textos en pantalla propios de cada modo — solo se mandan cuando aplican, para no
          // pisar campos de otros modos sin querer.
          ...(clip.jobMode === "RANKING" && {
            category,
            introTemplate,
            rankingItems: rankingItemLabels.map((i) => ({ id: i.id, label: i.label })),
          }),
          ...((clip.jobMode === "SPLIT" || clip.jobMode === "DOUBLE") && { customTitle }),
        }),
      });
      const putData = await putRes.json().catch(() => null);
      if (!putRes.ok) throw new Error(putData?.error ?? "No se pudieron guardar los cambios");

      // El regenerado real (ffmpeg completo) puede tardar más de lo que aguanta abierta una sola
      // petición el túnel gratuito — igual que se arregló para publicar en TikTok/YouTube, esta
      // ruta solo confirma que ha EMPEZADO, y aquí se pregunta el resultado con GET hasta que
      // renderPending se ponga a false, en vez de depender de mantener la conexión abierta.
      const startRes = await fetchWithRetry(`/api/clips/${clipId}/regenerate`, { method: "POST" }, 1);
      if (!startRes.ok) {
        const startData = await startRes.json().catch(() => null);
        throw new Error(startData?.error ?? "No se pudo iniciar el regenerado");
      }

      let regenData: { videoUrl: string | null; thumbnailUrl: string | null } | null = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const pollRes = await fetch(`/api/clips/${clipId}`);
        if (!pollRes.ok) continue;
        const pollData: { clip?: ClipData } = await pollRes.json().catch(() => ({}) as { clip?: ClipData });
        if (!pollData.clip || pollData.clip.renderPending) continue;
        if (pollData.clip.error) throw new Error(pollData.clip.error);
        regenData = { videoUrl: pollData.clip.videoUrl, thumbnailUrl: pollData.clip.thumbnailUrl };
        break;
      }
      if (!regenData) {
        throw new Error("Sigue regenerándose en el servidor (está tardando más de lo normal). Recarga la página en un rato.");
      }

      setCues(nextCues);
      setTexts(nextTexts);
      setTrimStart(0);
      setTrimEnd(newDuration);
      setCoverFrameSec(nextCoverFrameSec);
      setClip((prev) =>
        prev
          ? {
              ...prev,
              effectiveStartSec: nextEffectiveStart,
              endSec: nextEnd,
              coverFrameSec: nextCoverFrameSec,
              coverTitle,
              category: prev.jobMode === "RANKING" ? category : prev.category,
              introTemplate: prev.jobMode === "RANKING" ? introTemplate : prev.introTemplate,
              rankingItems: prev.jobMode === "RANKING" ? rankingItemLabels : prev.rankingItems,
              customTitle: prev.jobMode === "SPLIT" || prev.jobMode === "DOUBLE" ? customTitle : prev.customTitle,
              videoUrl: regenData.videoUrl,
              thumbnailUrl: regenData.thumbnailUrl,
            }
          : prev
      );
      setVideoVersion((v) => v + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar (fallo de conexión, inténtalo otra vez)";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (!clip) return <p className="text-sm text-red-400">{error ?? "Clip no encontrado"}</p>;

  const videoSrc = clip.videoUrl ? `${clip.videoUrl}?v=${videoVersion}` : null;
  // El recorte solo tiene efecto de verdad en estos modos: SINGLE/SPLIT cortan un único tramo de
  // un vídeo fuente, y DOUBLE recorta el vídeo de arriba de esa parte concreta (ver
  // doubleRegenerateClip.ts). RANKING (varios puestos ya montados) y SONG (tramos sincronizados al
  // ritmo de la canción) ignoran effectiveStartSec/endSec al regenerar, así que mostrar el tirador
  // de recorte ahí solo confundiría (parecería funcionar pero no cambiaría nada).
  const trimEditable = clip.jobMode === "SINGLE" || clip.jobMode === "SPLIT" || clip.jobMode === "DOUBLE";

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
        {/* Vista previa en vivo (Remotion) con los textos arrastrables encima */}
        <div className="w-full shrink-0 md:w-80">
          <div
            ref={overlayRef}
            className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-black"
            onPointerMove={onPointerMoveOverlay}
            onPointerUp={onPointerUpOverlay}
          >
            {resolution && clip.sourceVideoUrl ? (
              <Player
                ref={playerRef}
                component={EditorComposition}
                inputProps={{
                  sourceVideoUrl: clip.sourceVideoUrl,
                  trimBeforeFrames: Math.round(clipStart * FPS),
                  trimAfterFrames: Math.round(clip.endSec * FPS),
                  fps: FPS,
                  texts,
                }}
                durationInFrames={Math.max(1, Math.round(duration * FPS))}
                compositionWidth={resolution.width}
                compositionHeight={resolution.height}
                fps={FPS}
                style={{ width: "100%", height: "100%" }}
                controls
                clickToPlay={false}
                acknowledgeRemotionLicense
                inFrame={Math.round(trimStart * FPS)}
                outFrame={Math.max(1, Math.round(trimEnd * FPS) - 1)}
              />
            ) : (
              videoSrc && (
                <video src={videoSrc} poster={clip.thumbnailUrl ?? undefined} controls className="h-full w-full object-cover" />
              )
            )}
            {texts.map((t) => (
              <div
                key={t.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${t.xPct}%`, top: `${t.yPct}%` }}
              >
                {/* Zona invisible para arrastrar/seleccionar: el texto REAL ya lo pinta Remotion
                    debajo, esto solo captura el puntero para que no haya doble texto dibujado. */}
                <div
                  onPointerDown={(e) => onPointerDownText(e, t.id)}
                  className={`h-10 w-24 cursor-move select-none ${
                    selectedTextId === t.id ? "rounded outline outline-2 outline-brand-500" : ""
                  }`}
                />
                {selectedTextId === t.id && (
                  <div
                    onPointerDown={(e) => onPointerDownResize(e, t)}
                    className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-brand-500"
                    title="Arrastra para agrandar/encoger"
                  />
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Arrastra un texto para moverlo, y el punto de su esquina para agrandarlo o encogerlo.
          </p>

          {/* Línea de tiempo: miniaturas + recorte (el recorte solo en los modos donde tiene efecto) */}
          <div className="mt-4">
            <p className="mb-1 text-xs text-slate-400">
              {trimEditable
                ? `Recorte: ${formatTime(trimStart)} – ${formatTime(trimEnd)} (de ${formatTime(duration)})`
                : `Duración: ${formatTime(duration)}`}
            </p>
            <div
              ref={stripRef}
              className="relative h-16 w-full cursor-pointer overflow-hidden rounded-lg bg-ink-900"
              onPointerDown={trimEditable ? onPointerDownStripBackground : undefined}
              onPointerMove={trimEditable ? onPointerMoveStrip : undefined}
              onPointerUp={trimEditable ? onPointerUpStrip : undefined}
            >
              <div className="flex h-full w-full">
                {thumbnails.length > 0 ? (
                  thumbnails.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt="" className="h-full flex-1 object-cover" draggable={false} />
                  ))
                ) : (
                  <p className="flex h-full w-full items-center justify-center text-xs text-slate-600">Generando miniaturas…</p>
                )}
              </div>
              {trimEditable && (
                <>
                  <div
                    className="pointer-events-none absolute top-0 h-full bg-black/60"
                    style={{ left: 0, width: `${duration > 0 ? (trimStart / duration) * 100 : 0}%` }}
                  />
                  <div
                    className="pointer-events-none absolute top-0 h-full bg-black/60"
                    style={{ right: 0, width: `${duration > 0 ? 100 - (trimEnd / duration) * 100 : 0}%` }}
                  />
                  <div
                    className="pointer-events-none absolute top-0 h-full w-0.5 bg-white"
                    style={{ left: `${duration > 0 ? (playheadSec / duration) * 100 : 0}%` }}
                  />
                  <div
                    onPointerDown={(e) => onPointerDownTrimHandle(e, "start")}
                    className="absolute top-0 h-full w-2.5 -translate-x-1/2 cursor-ew-resize rounded bg-brand-400"
                    style={{ left: `${duration > 0 ? (trimStart / duration) * 100 : 0}%` }}
                  />
                  <div
                    onPointerDown={(e) => onPointerDownTrimHandle(e, "end")}
                    className="absolute top-0 h-full w-2.5 -translate-x-1/2 cursor-ew-resize rounded bg-brand-400"
                    style={{ left: `${duration > 0 ? (trimEnd / duration) * 100 : 0}%` }}
                  />
                </>
              )}
            </div>

            {/* Pista de textos: arrastra un bloque para moverlo en el tiempo, sus bordes para acortarlo/alargarlo */}
            {texts.length > 0 && (
              <div
                ref={trackRef}
                className="relative mt-1 h-6 w-full rounded-lg bg-ink-900"
                onPointerMove={onPointerMoveTrack}
                onPointerUp={onPointerUpTrack}
              >
                {texts.map((t) => (
                  <div
                    key={t.id}
                    onPointerDown={(e) => onPointerDownTextBlock(e, t, "move")}
                    onClick={() => setSelectedTextId(t.id)}
                    className={`absolute top-0.5 h-5 cursor-grab rounded px-1 text-[10px] leading-5 text-black ${
                      selectedTextId === t.id ? "bg-brand-400" : "bg-brand-600/60"
                    }`}
                    style={{
                      left: `${duration > 0 ? (t.start / duration) * 100 : 0}%`,
                      width: `${duration > 0 ? ((t.end - t.start) / duration) * 100 : 0}%`,
                    }}
                    title={t.text}
                  >
                    <span className="truncate">{t.text}</span>
                    <div
                      onPointerDown={(e) => onPointerDownTextBlock(e, t, "resize-start")}
                      className="absolute -left-1 top-0 h-full w-2 cursor-ew-resize"
                    />
                    <div
                      onPointerDown={(e) => onPointerDownTextBlock(e, t, "resize-end")}
                      className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-6">
          {/* Portada: SINGLE/SPLIT tienen fotograma+título editables; RANKING solo puede subir su
              propia foto (el título de portada es el título del vídeo, no editable aquí, y el
              fotograma automático es el punto medio del mejor clip). PRODUCT/SONG/DOUBLE nunca
              han tenido portada. */}
          {(clip.jobMode === "SINGLE" || clip.jobMode === "SPLIT" || clip.jobMode === "RANKING") && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-300">Portada</h2>
              {(clip.jobMode === "SINGLE" || clip.jobMode === "SPLIT") && (
                <>
                  <div className="flex gap-4">
                    {clip.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={clip.thumbnailUrl}
                        alt="Portada actual"
                        className="h-24 w-14 shrink-0 rounded-lg border border-ink-600 object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-slate-400">Título de la portada</label>
                      <input
                        type="text"
                        value={coverTitle}
                        onChange={(e) => setCoverTitle(e.target.value)}
                        className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                      />
                    </div>
                  </div>
                  <p className="mb-1 mt-3 text-xs text-slate-400">Elige el fotograma de portada:</p>
                  <div className="flex gap-1 overflow-x-auto rounded-lg bg-ink-900 p-1">
                    {thumbnails.length > 0 ? (
                      thumbnails.map((src, i) => {
                        const t = clipStart + (duration * i) / (THUMBNAIL_COUNT - 1);
                        const isSelected = coverFrameSec != null && Math.abs(coverFrameSec - t) < 0.01;
                        return (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={src}
                            alt=""
                            onClick={() => setCoverFrameSec(t)}
                            draggable={false}
                            className={`h-14 w-9 shrink-0 cursor-pointer rounded object-cover ${
                              isSelected ? "outline outline-2 outline-brand-500" : "opacity-70 hover:opacity-100"
                            }`}
                          />
                        );
                      })
                    ) : (
                      <p className="p-2 text-xs text-slate-600">Generando miniaturas…</p>
                    )}
                  </div>
                  {coverFrameSec != null && (
                    <button
                      onClick={() => setCoverFrameSec(null)}
                      className="mt-1 text-xs text-slate-400 underline hover:text-slate-300"
                    >
                      Usar el fotograma automático
                    </button>
                  )}
                </>
              )}

              <p className="mb-1 mt-4 text-xs text-slate-400">
                {clip.jobMode === "RANKING" ? "Sube tu propia foto para la portada:" : "O sube tu propia foto para la portada:"}
              </p>
              <div className="flex items-center gap-3">
                {coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coverImageUrl}
                    alt="Imagen de portada subida"
                    className="h-24 w-14 shrink-0 rounded-lg border border-brand-500 object-cover"
                  />
                )}
                <div className="flex flex-col gap-1">
                  <input
                    ref={coverImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadCoverImage(file);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => coverImageInputRef.current?.click()}
                    disabled={uploadingCover}
                    className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-200 hover:border-brand-500 disabled:opacity-40"
                  >
                    {uploadingCover ? "Subiendo…" : coverImageUrl ? "Cambiar foto" : "Subir foto de la fototeca"}
                  </button>
                  {coverImageUrl && (
                    <button
                      onClick={removeCoverImage}
                      disabled={uploadingCover}
                      className="text-xs text-slate-400 underline hover:text-slate-300"
                    >
                      Quitar y usar fotograma del vídeo
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Si subes una foto, se usa esa en la portada en vez de un fotograma del vídeo (el sonido de marca
                sigue igual). Dale a "Guardar y regenerar" abajo para aplicarla.
              </p>
            </div>
          )}

          {/* Título quemado en pantalla: en RANKING es la categoría/plantilla fija que se ve todo
              el vídeo ("Ranking Funniest {Category} Moments" / "Best 5 {Category} Clips") más la
              etiqueta de cada puesto del listado numerado; en SPLIT/DOUBLE es el título propio
              escrito al crear el trabajo (barra negra arriba del short/del clip de abajo). */}
          {clip.jobMode === "RANKING" && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-300">Título del ranking (en pantalla)</h2>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  maxLength={60}
                  placeholder="p.ej. Ishowspeed"
                  className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-brand-500"
                />
                <select
                  value={introTemplate}
                  onChange={(e) => setIntroTemplate(e.target.value as "TOPIC" | "YOUTUBER")}
                  className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-300 outline-none focus:border-brand-500"
                >
                  <option value="TOPIC">Temática ("Ranking Funniest ... Moments")</option>
                  <option value="YOUTUBER">YouTuber ("Best 5 ... Clips")</option>
                </select>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Se verá así en pantalla: <span className="font-semibold text-slate-300">{previewRankingTitle(category, introTemplate)}</span>
              </p>

              {rankingItemLabels.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs text-slate-400">Etiqueta de cada puesto en el listado numerado:</p>
                  {[...rankingItemLabels]
                    .sort((a, b) => a.position - b.position)
                    .map((item) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="w-6 shrink-0 text-right text-xs font-semibold text-brand-400">
                          {item.position}.
                        </span>
                        <input
                          type="text"
                          value={item.label}
                          onChange={(e) => updateRankingItemLabel(item.id, e.target.value)}
                          maxLength={80}
                          className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                        />
                      </div>
                    ))}
                </div>
              )}
              <p className="mt-2 text-xs text-slate-600">Dale a "Guardar y regenerar" abajo para aplicar los cambios.</p>
            </div>
          )}

          {(clip.jobMode === "SPLIT" || clip.jobMode === "DOUBLE") && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-300">Título propio (en pantalla)</h2>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                maxLength={120}
                placeholder='BROMA TELEFÓNICA A AURONPLAY "EL FIFAS"'
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-brand-500"
              />
              <p className="mt-1 text-xs text-slate-600">
                Barra negra fija arriba {clip.jobMode === "DOUBLE" ? "del clip de abajo" : "del short, sin taparlo"}.
                Déjalo en blanco para quitarlo. Dale a "Guardar y regenerar" abajo para aplicarlo.
              </p>
            </div>
          )}

          {/* Subtítulos automáticos: solo en los modos que los generan/regeneran de verdad */}
          {(clip.jobMode === "SINGLE" || clip.jobMode === "SPLIT" || clip.jobMode === "RANKING" || clip.jobMode === "DOUBLE") && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">Subtítulos generados automáticamente</h2>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={captionsEnabled}
                  onChange={(e) => setCaptionsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-ink-600 bg-ink-900"
                />
                Mostrar subtítulos
              </label>
            </div>
            <div className={`space-y-2 ${captionsEnabled ? "" : "opacity-40"}`}>
              {cues.length === 0 && <p className="text-xs text-slate-500">Este clip no tiene subtítulos guardados.</p>}
              {cues.map((cue) => {
                const styleOpen = expandedCueStyleId === cue.id;
                const effFont = cue.style?.fontName || DEFAULT_CUE_FONT;
                const effSize = cue.style?.fontSize || defaultCueFontSize(resolution);
                const effColor = cue.style?.colorHex || DEFAULT_CUE_COLOR;
                const effX = cue.style?.xPct ?? 50;
                const effY = cue.style?.yPct ?? 62;
                return (
                  <div
                    key={cue.id}
                    className={`rounded-xl border border-ink-600 bg-ink-900/50 p-2 ${cue.deleted ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={cueText(cue)}
                        disabled={cue.deleted}
                        onChange={(e) => updateCueText(cue.id, e.target.value)}
                        className="flex-1 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-brand-500 disabled:opacity-50"
                      />
                      <button
                        onClick={() => setExpandedCueStyleId(styleOpen ? null : cue.id)}
                        disabled={cue.deleted}
                        className={`rounded-lg border px-2 py-1 text-xs disabled:opacity-50 ${
                          cue.style ? "border-brand-500 text-brand-400" : "border-ink-600 text-slate-300"
                        }`}
                      >
                        🎨 Estilo
                      </button>
                      <button
                        onClick={() => toggleCueDeleted(cue.id)}
                        className="rounded-lg border border-ink-600 px-2 py-1 text-xs text-slate-300 hover:border-red-500 hover:text-red-400"
                      >
                        {cue.deleted ? "Restaurar" : "🗑 Borrar"}
                      </button>
                    </div>
                    {styleOpen && !cue.deleted && (
                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-ink-700 bg-ink-900 p-2 sm:grid-cols-4">
                        <label className="text-xs text-slate-400">
                          Fuente
                          <select
                            value={effFont}
                            onChange={(e) => updateCueStyle(cue.id, { fontName: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-slate-200"
                          >
                            {FONT_OPTIONS.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-slate-400">
                          Tamaño
                          <input
                            type="number"
                            min={10}
                            max={300}
                            value={effSize}
                            onChange={(e) => updateCueStyle(cue.id, { fontSize: Number(e.target.value) })}
                            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-slate-200"
                          />
                        </label>
                        <label className="text-xs text-slate-400">
                          Color
                          <input
                            type="color"
                            value={`#${effColor}`}
                            onChange={(e) => updateCueStyle(cue.id, { colorHex: e.target.value.replace("#", "") })}
                            className="mt-1 h-7 w-full rounded-lg border border-ink-600 bg-ink-900"
                          />
                        </label>
                        <div className="flex items-end gap-1">
                          <button
                            type="button"
                            onClick={() => resetCueStyle(cue.id)}
                            className="w-full rounded-lg border border-ink-600 px-2 py-1 text-xs text-slate-400 hover:border-red-500 hover:text-red-400"
                          >
                            Quitar estilo
                          </button>
                        </div>
                        <label className="col-span-2 text-xs text-slate-400">
                          Posición horizontal ({Math.round(effX)}%)
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={effX}
                            onChange={(e) => updateCueStyle(cue.id, { xPct: Number(e.target.value) })}
                            className="mt-1 w-full"
                          />
                        </label>
                        <label className="col-span-2 text-xs text-slate-400">
                          Posición vertical ({Math.round(effY)}%)
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={effY}
                            onChange={(e) => updateCueStyle(cue.id, { yPct: Number(e.target.value) })}
                            className="mt-1 w-full"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          )}

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
                        value={Number(t.start.toFixed(1))}
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
                        value={Number(t.end.toFixed(1))}
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
