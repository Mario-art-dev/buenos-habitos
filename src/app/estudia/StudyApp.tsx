"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import VideoPlayer from "./VideoPlayer";
import { chunkText, extractFiles, type StudyImage } from "./extract";
import { videoSeconds, type StudyVideo } from "./types";

type Tab = "foryou" | "sections" | "create" | "search";
type FeedItem = { key: string; video: StudyVideo };
type RawVideo = Omit<StudyVideo, "script"> & { script: string };

function parse(v: RawVideo): StudyVideo | null {
  try {
    return { ...v, script: JSON.parse(v.script) };
  } catch {
    return null;
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Mezcla intentando no poner dos vídeos seguidos de la misma asignatura. */
function mixRound(videos: StudyVideo[], avoidFirstId?: string): StudyVideo[] {
  const pool = shuffle(videos);
  const out: StudyVideo[] = [];
  while (pool.length) {
    const prev = out[out.length - 1];
    let i = pool.findIndex((v) => (!prev || v.subject !== prev.subject) && !(out.length === 0 && v.id === avoidFirstId));
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

function haystack(v: StudyVideo): string {
  const s = v.script;
  return [v.subject, v.topic, v.title, s.caption, s.takeaway, ...(s.hashtags ?? []), ...(s.keyFacts ?? []), ...s.scenes.map((sc) => `${sc.text ?? ""} ${sc.narration ?? ""} ${sc.question ?? ""}`)]
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function subjectEmoji(videos: StudyVideo[]): string {
  for (const v of videos) for (const sc of v.script.scenes) if (sc.emoji) return sc.emoji;
  return "📚";
}

// ---------------------------------------------------------------------------------------------

function Feed({
  items,
  startIndex = 0,
  soundOn,
  onToggleSound,
  onSeen,
  onLike,
  onNearEnd,
}: {
  items: FeedItem[];
  startIndex?: number;
  soundOn: boolean;
  onToggleSound: () => void;
  onSeen: (id: string) => void;
  onLike: (id: string, liked: boolean) => void;
  onNearEnd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(startIndex);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = startIndex * el.clientHeight;
    setActive(startIndex);
  }, [startIndex]);

  useEffect(() => {
    if (onNearEnd && active >= items.length - 2) onNearEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== active) setActive(i);
  };

  return (
    <div ref={ref} onScroll={onScroll} className="study-feed h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-contain">
      {items.map((it, i) => (
        <section key={it.key} className="h-full w-full snap-start snap-always">
          {Math.abs(i - active) <= 1 ? (
            <VideoPlayer video={it.video} active={i === active} soundOn={soundOn} onToggleSound={onToggleSound} onSeen={onSeen} onLike={onLike} />
          ) : (
            <div className="h-full w-full bg-black" />
          )}
        </section>
      ))}
    </div>
  );
}

function VideoCard({ v, onOpen, onDelete }: { v: StudyVideo; onOpen: () => void; onDelete?: () => void }) {
  const hook = v.script.scenes[0];
  return (
    <div className="relative">
      <button onClick={onOpen} className="flex aspect-[9/14] w-full flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-600 via-violet-700 to-indigo-900 p-3 text-left text-white ring-1 ring-white/10 active:scale-[.98]">
        <span className="text-5xl">{hook?.emoji ?? hook?.emojis?.[0] ?? "🎬"}</span>
        <div>
          <p className="line-clamp-4 text-[13px] font-black leading-tight [overflow-wrap:anywhere]">{v.title}</p>
          <p className="mt-1 text-[11px] font-bold opacity-75">
            {v.seen ? "✓ visto" : "● nuevo"} · {Math.floor(videoSeconds(v.script) / 60)}:{String(videoSeconds(v.script) % 60).padStart(2, "0")}
            {v.liked ? " · ❤️" : ""}
          </p>
        </div>
      </button>
      {onDelete ? (
        <button onClick={onDelete} aria-label="Borrar vídeo" className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-1 text-sm">
          🗑
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

type Job = { title: string; status: "wait" | "work" | "ok" | "fail"; error?: string };

function CreateView({ subjects, onCreated, onDone }: { subjects: string[]; onCreated: (v: StudyVideo) => void; onDone: (subject: string) => void }) {
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [phase, setPhase] = useState<"form" | "reading" | "planning" | "making" | "done">("form");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data as T;
  }

  async function start() {
    const subj = subject.trim();
    if (!subj) return setError("Escribe la asignatura.");
    if (!files.length && !pasted.trim()) return setError("Sube un archivo o pega tus apuntes.");
    setError("");
    try {
      setPhase("reading");
      const extracted = await extractFiles(files);
      const text = [extracted.text, pasted.trim()].filter(Boolean).join("\n\n");
      const chunks = chunkText(text);
      const imageBatches: StudyImage[][] = [];
      for (let i = 0; i < extracted.images.length; i += 6) imageBatches.push(extracted.images.slice(i, i + 6));
      const calls = Math.max(chunks.length, imageBatches.length);

      setPhase("planning");
      type Plan = { topic: string; lessons: { title: string; keyFacts: string[] }[] };
      const plans: Plan[] = [];
      for (let i = 0; i < calls; i++) {
        plans.push(
          await post<Plan>("/api/study/plan", {
            subject: subj,
            topic: topic.trim(),
            text: chunks[i] ?? "",
            images: imageBatches[i] ?? [],
            chunkInfo: calls > 1 ? `This is part ${i + 1} of ${calls} of the material.` : undefined,
          })
        );
      }
      const topicName = topic.trim() || plans[0].topic;
      const lessons = plans.flatMap((p) => p.lessons);
      setJobs(lessons.map((l) => ({ title: l.title, status: "wait" })));
      setPhase("making");

      // 2 a la vez para no agotar el cupo de la IA.
      let next = 0;
      const worker = async () => {
        while (next < lessons.length) {
          const i = next++;
          setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: "work" } : j)));
          let ok = false;
          for (let attempt = 0; attempt < 2 && !ok; attempt++) {
            try {
              const raw = await post<RawVideo>("/api/study/video", { subject: subj, topic: topicName, lesson: lessons[i], index: i, total: lessons.length, order: i });
              const v = parse(raw);
              if (v) onCreated(v);
              ok = true;
              setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: "ok" } : j)));
            } catch (e) {
              if (attempt === 1) setJobs((js) => js.map((j, k) => (k === i ? { ...j, status: "fail", error: (e as Error).message } : j)));
            }
          }
        }
      };
      await Promise.all([worker(), worker()]);
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
      setPhase("form");
    }
  }

  const input = "w-full rounded-xl bg-white/10 px-4 py-3 text-[16px] text-white placeholder-white/40 outline-none ring-1 ring-white/15 focus:ring-pink-400";

  if (phase !== "form") {
    const done = jobs.filter((j) => j.status === "ok").length;
    return (
      <div className="mx-auto flex h-full max-w-md flex-col gap-4 overflow-y-auto px-4 pb-6 pt-6 text-white">
        <h1 className="text-2xl font-black">
          {phase === "reading" && "📖 Leyendo tus archivos…"}
          {phase === "planning" && "🧠 Dividiendo el temario…"}
          {phase === "making" && `🎬 Creando vídeos ${done}/${jobs.length}`}
          {phase === "done" && `✅ ¡${done} vídeos listos!`}
        </h1>
        {phase !== "done" ? <p className="text-sm text-white/60">No cierres esta pantalla. Cada vídeo tarda unos segundos.</p> : null}
        <ul className="space-y-2">
          {jobs.map((j, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl bg-white/5 px-3 py-2 text-[15px]">
              <span>{j.status === "ok" ? "✅" : j.status === "fail" ? "❌" : j.status === "work" ? "⏳" : "⏸️"}</span>
              <span className="flex-1">
                {j.title}
                {j.error ? <span className="block text-xs text-red-300">{j.error}</span> : null}
              </span>
            </li>
          ))}
        </ul>
        {phase === "done" ? (
          <div className="flex gap-2">
            <button onClick={() => onDone(subject.trim())} className="flex-1 rounded-xl bg-pink-500 py-3 font-black">▶ Ver los vídeos</button>
            <button onClick={() => { setPhase("form"); setFiles([]); setPasted(""); setTopic(""); setJobs([]); }} className="rounded-xl bg-white/10 px-4 py-3 font-bold">Otro tema</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 overflow-y-auto px-4 pb-8 pt-6 text-white">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">➕ Crear vídeos</h1>
        <Link href="/" className="text-sm text-white/50">Salir</Link>
      </div>
      <p className="text-sm text-white/60">Sube tu temario y la IA lo convierte en TikToks animados en inglés (máx. 2 min) que te lo enseñan todo.</p>

      <label className="space-y-1">
        <span className="text-sm font-bold">1. Asignatura</span>
        <input list="study-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ej: Biology" className={input} />
        <datalist id="study-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
        {subjects.length ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {subjects.map((s) => (
              <button key={s} onClick={() => setSubject(s)} className={`rounded-full px-3 py-1 text-sm font-bold ${subject === s ? "bg-pink-500" : "bg-white/10"}`}>{s}</button>
            ))}
          </div>
        ) : null}
      </label>

      <label className="space-y-1">
        <span className="text-sm font-bold">2. Tema (opcional)</span>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ej: The cell" className={input} />
      </label>

      <div className="space-y-1">
        <span className="text-sm font-bold">3. Tus apuntes</span>
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-white/25 px-4 py-6 text-center active:bg-white/5">
          <span className="text-4xl">📎</span>
          <span className="font-bold">Toca para subir archivos</span>
          <span className="text-xs text-white/50">PDF, Word, texto o fotos de tus apuntes</span>
          <input type="file" multiple accept=".pdf,.txt,.md,.docx,image/*" className="hidden" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
        </label>
        {files.length ? (
          <ul className="space-y-1 pt-1">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
                <span className="truncate">{f.name}</span>
                <button onClick={() => setFiles(files.filter((_, k) => k !== i))} className="pl-3 text-white/50">✕</button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} placeholder="…o pega aquí el texto" className={`${input} mt-2`} />
      </div>

      {error ? <p className="rounded-xl bg-red-500/20 px-3 py-2 text-sm text-red-200">{error}</p> : null}
      <button onClick={start} className="rounded-2xl bg-gradient-to-r from-pink-500 to-orange-400 py-4 text-lg font-black shadow-lg active:scale-[.98]">
        ✨ Crear mis TikToks
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export default function StudyApp() {
  const [videos, setVideos] = useState<StudyVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("foryou");
  const [soundOn, setSoundOn] = useState(false);
  const [askedSound, setAskedSound] = useState(false);
  const [forYou, setForYou] = useState<FeedItem[]>([]);
  const [section, setSection] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<{ items: FeedItem[]; start: number } | null>(null);
  const [query, setQuery] = useState("");
  const round = useRef(0);
  const videosRef = useRef<StudyVideo[]>([]);
  videosRef.current = videos;

  const byId = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const fresh = useCallback((items: FeedItem[]) => items.map((it) => ({ ...it, video: byId.get(it.video.id) ?? it.video })), [byId]);

  const buildForYou = useCallback((list: StudyVideo[]) => {
    round.current = 0;
    const unseen = list.filter((v) => !v.seen);
    const seen = list.filter((v) => v.seen);
    const order = [...mixRound(unseen), ...mixRound(seen)];
    setForYou(order.map((v) => ({ key: `${v.id}-0`, video: v })));
  }, []);

  useEffect(() => {
    fetch("/api/study/videos")
      .then((r) => r.json())
      .then((rows: RawVideo[]) => {
        const list = rows.map(parse).filter(Boolean) as StudyVideo[];
        setVideos(list);
        buildForYou(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [buildForYou]);

  // Cuando se acaba la vuelta de «Para ti», empieza otra mezclada (y se resetean los "vistos").
  const onNearEnd = useCallback(() => {
    setForYou((items) => {
      const all = videosRef.current;
      if (!all.length || items.length > all.length * (round.current + 1) + 1) return items;
      const allSeen = all.every((v) => v.seen);
      if (allSeen) {
        fetch("/api/study/reset", { method: "POST" }).catch(() => {});
        setVideos((vs) => vs.map((v) => ({ ...v, seen: false })));
      }
      round.current += 1;
      const r = round.current;
      const last = items[items.length - 1]?.video.id;
      return [...items, ...mixRound(all, last).map((v) => ({ key: `${v.id}-${r}`, video: v }))];
    });
  }, []);

  const onSeen = useCallback((id: string) => {
    setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, seen: true } : v)));
    fetch(`/api/study/videos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seen: true }) }).catch(() => {});
  }, []);

  const onLike = useCallback((id: string, liked: boolean) => {
    setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, liked } : v)));
    fetch(`/api/study/videos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liked }) }).catch(() => {});
  }, []);

  const onDelete = useCallback((id: string) => {
    if (!window.confirm("¿Borrar este vídeo?")) return;
    setVideos((vs) => vs.filter((v) => v.id !== id));
    setForYou((items) => items.filter((it) => it.video.id !== id));
    fetch(`/api/study/videos/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const enableSound = () => {
    // iPhone: la voz solo se desbloquea dentro de un toque del usuario.
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.getVoices();
    } catch {}
    setSoundOn(true);
    setAskedSound(true);
  };
  const toggleSound = () => (soundOn ? setSoundOn(false) : enableSound());

  const subjects = useMemo(() => {
    const map = new Map<string, StudyVideo[]>();
    for (const v of videos) map.set(v.subject, [...(map.get(v.subject) ?? []), v]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [videos]);

  const sectionVideos = useMemo(
    () => videos.filter((v) => v.subject === section).sort((a, b) => a.topic.localeCompare(b.topic) || a.createdAt.localeCompare(b.createdAt) || a.order - b.order),
    [videos, section]
  );

  const results = useMemo(() => {
    const q = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    if (!q) return videos;
    const terms = q.split(/\s+/);
    return videos.filter((v) => {
      const h = haystack(v);
      return terms.every((t) => h.includes(t));
    });
  }, [videos, query]);

  const openList = (list: StudyVideo[], start: number) => setOverlay({ items: list.map((v) => ({ key: `o-${v.id}`, video: v })), start });

  const feedProps = { soundOn, onToggleSound: toggleSound, onSeen, onLike };

  const nav: { id: Tab; icon: string; label: string }[] = [
    { id: "foryou", icon: "🏠", label: "Para ti" },
    { id: "sections", icon: "📚", label: "Secciones" },
    { id: "create", icon: "➕", label: "Crear" },
    { id: "search", icon: "🔍", label: "Buscar" },
  ];

  const empty = (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center text-white">
      <span className="text-7xl">🎬</span>
      <h2 className="text-2xl font-black">Aún no hay vídeos</h2>
      <p className="text-white/60">Sube tus apuntes y la IA te crea TikToks para aprenderlo todo.</p>
      <button onClick={() => setTab("create")} className="rounded-2xl bg-pink-500 px-6 py-3 font-black">➕ Crear vídeos</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black" style={{ height: "100dvh" }}>
      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-4xl">⏳</div>
        ) : overlay ? (
          <>
            <Feed items={fresh(overlay.items)} startIndex={overlay.start} {...feedProps} />
            <button onClick={() => setOverlay(null)} className="absolute left-3 top-3 z-30 rounded-full bg-black/40 px-3 py-1.5 text-sm font-bold text-white">← Volver</button>
          </>
        ) : tab === "foryou" ? (
          forYou.length ? (
            <>
              <Feed items={fresh(forYou)} {...feedProps} onNearEnd={onNearEnd} />
              <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center gap-5 text-[17px] font-black text-white drop-shadow">
                <button className="pointer-events-auto opacity-60" onClick={() => setTab("sections")}>Secciones</button>
                <span className="border-b-2 border-white pb-0.5">Para ti</span>
              </div>
            </>
          ) : (
            empty
          )
        ) : tab === "sections" ? (
          <div className="mx-auto h-full max-w-md overflow-y-auto px-4 pb-6 pt-6 text-white">
            {section ? (
              <>
                <button onClick={() => setSection(null)} className="mb-3 text-sm font-bold text-white/60">← Asignaturas</button>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h1 className="text-2xl font-black">{section}</h1>
                  {sectionVideos.length ? <button onClick={() => openList(sectionVideos, 0)} className="rounded-full bg-pink-500 px-4 py-2 text-sm font-black">▶ Ver todo</button> : null}
                </div>
                {[...new Set(sectionVideos.map((v) => v.topic))].map((t) => (
                  <div key={t} className="mb-5">
                    <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-white/50">{t}</h2>
                    <div className="grid grid-cols-3 gap-2">
                      {sectionVideos.filter((v) => v.topic === t).map((v) => (
                        <VideoCard key={v.id} v={v} onOpen={() => openList(sectionVideos, sectionVideos.indexOf(v))} onDelete={() => onDelete(v.id)} />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <>
                <h1 className="mb-4 text-2xl font-black">📚 Secciones</h1>
                {subjects.length ? (
                  <div className="grid grid-cols-2 gap-3">
                    {subjects.map(([name, list]) => {
                      const seen = list.filter((v) => v.seen).length;
                      return (
                        <button key={name} onClick={() => setSection(name)} className="flex flex-col gap-2 rounded-2xl bg-white/5 p-4 text-left ring-1 ring-white/10 active:scale-[.98]">
                          <span className="text-4xl">{subjectEmoji(list)}</span>
                          <span className="text-lg font-black leading-tight">{name}</span>
                          <span className="text-xs text-white/50">{list.length} vídeos · {seen}/{list.length} vistos</span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
                            <span className="block h-full rounded-full bg-pink-500" style={{ width: `${(seen / list.length) * 100}%` }} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  empty
                )}
              </>
            )}
          </div>
        ) : tab === "create" ? (
          <CreateView
            subjects={subjects.map(([s]) => s)}
            onCreated={(v) => {
              setVideos((vs) => [...vs, v]);
              setForYou((items) => [...items, { key: `${v.id}-new`, video: v }]);
            }}
            onDone={(s) => {
              setSection(s);
              setTab("sections");
            }}
          />
        ) : (
          <div className="mx-auto flex h-full max-w-md flex-col px-4 pt-5 text-white">
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Busca un vídeo, tema o palabra…" className="w-full rounded-full bg-white/10 px-5 py-3 text-[16px] outline-none ring-1 ring-white/15 focus:ring-pink-400" />
            <p className="px-2 pb-2 pt-3 text-xs text-white/50">{results.length} resultados</p>
            <div className="grid flex-1 grid-cols-3 content-start gap-2 overflow-y-auto pb-6">
              {results.map((v, i) => (
                <VideoCard key={v.id} v={v} onOpen={() => openList(results, i)} />
              ))}
            </div>
          </div>
        )}

        {!askedSound && !loading && (overlay || (tab === "foryou" && forYou.length)) ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 px-8">
            <div className="flex flex-col items-center gap-3 rounded-3xl bg-black/70 p-6 text-center text-white ring-1 ring-white/15">
              <span className="text-5xl">🎧</span>
              <p className="font-bold">Los vídeos hablan en inglés</p>
              <button onClick={enableSound} className="rounded-2xl bg-pink-500 px-6 py-3 font-black">🔊 Activar voz</button>
              <button onClick={() => setAskedSound(true)} className="text-sm text-white/60">Ver sin sonido</button>
            </div>
          </div>
        ) : null}
      </div>

      <nav className="flex h-14 shrink-0 items-stretch border-t border-white/10 bg-black pb-[env(safe-area-inset-bottom)] text-white" style={{ boxSizing: "content-box" }}>
        {nav.map((n) => (
          <button
            key={n.id}
            onClick={() => {
              setOverlay(null);
              setTab(n.id);
            }}
            className={`flex flex-1 flex-col items-center justify-center text-[11px] font-bold ${tab === n.id && !overlay ? "text-white" : "text-white/50"}`}
          >
            <span className={n.id === "create" ? "rounded-lg bg-gradient-to-r from-cyan-400 via-white to-pink-500 px-3 text-lg text-black" : "text-xl"}>{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
