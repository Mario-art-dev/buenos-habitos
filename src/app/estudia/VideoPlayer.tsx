"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { PALETTES, sceneSeconds, type Scene, type StudyVideo } from "./types";

// Reproductor de un "TikTok" de estudio: escenas animadas con GSAP + voz en inglés del propio
// navegador (speechSynthesis, gratis) + subtítulos con la palabra que suena resaltada.

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let cachedVoice: SpeechSynthesisVoice | null | undefined;
function englishVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const preferred = ["Samantha", "Google US English", "Ava", "Allison", "Daniel", "Karen", "Microsoft Aria"];
  cachedVoice =
    preferred.map((n) => en.find((v) => v.name.includes(n))).find(Boolean) ??
    en.find((v) => v.lang === "en-US") ??
    en[0] ??
    null;
  return cachedVoice;
}

function Words({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i) => (
        <span key={i} className="anim-word inline-block whitespace-pre">
          {w}{" "}
        </span>
      ))}
    </span>
  );
}

function Big({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`anim-pop select-none leading-none drop-shadow-[0_10px_30px_rgba(0,0,0,.45)] ${className}`}>
      {children}
    </div>
  );
}

const card = "rounded-2xl bg-black/30 px-4 py-3 backdrop-blur-sm ring-1 ring-white/15";

function SceneView({ scene, glow, revealed, onReveal }: { scene: Scene; glow: string; revealed: boolean; onReveal: () => void }) {
  const title = scene.text ? (
    <h2 className="anim-title text-balance text-center text-[clamp(26px,8vw,44px)] font-black leading-[1.05] tracking-tight">
      <Words text={scene.text} />
    </h2>
  ) : null;

  switch (scene.type) {
    case "hook":
      return (
        <div className="flex flex-col items-center gap-6">
          <Big className="anim-shake text-[clamp(90px,34vw,190px)]">{scene.emoji ?? "🤯"}</Big>
          <h2 className="text-balance text-center text-[clamp(32px,10vw,56px)] font-black uppercase leading-[0.95] tracking-tight" style={{ color: glow }}>
            <Words text={scene.text ?? ""} />
          </h2>
        </div>
      );
    case "analogy":
      return (
        <div className="flex w-full flex-col items-center gap-6">
          {title}
          <div className="flex w-full items-center justify-center gap-3">
            <div className="anim-left flex flex-1 flex-col items-center gap-2">
              <Big className="anim-float text-[clamp(70px,24vw,130px)]">{scene.left?.emoji}</Big>
              <span className="text-center text-lg font-bold">{scene.left?.label}</span>
            </div>
            <span className="anim-pop text-4xl font-black" style={{ color: glow }}>=</span>
            <div className="anim-right flex flex-1 flex-col items-center gap-2">
              <Big className="anim-float text-[clamp(70px,24vw,130px)]">{scene.right?.emoji}</Big>
              <span className="text-center text-lg font-bold">{scene.right?.label}</span>
            </div>
          </div>
        </div>
      );
    case "compare":
      return (
        <div className="flex w-full flex-col items-center gap-5">
          {title}
          <div className="grid w-full grid-cols-2 gap-3">
            {[scene.left, scene.right].map((side, i) => (
              <div key={i} className={`${i ? "anim-right" : "anim-left"} ${card} flex flex-col items-center gap-2`}>
                <Big className="text-6xl">{side?.emoji}</Big>
                <span className="text-center text-lg font-black" style={{ color: glow }}>{side?.label}</span>
                <ul className="space-y-1 text-[15px] font-semibold leading-snug">
                  {(side?.points ?? []).map((p, j) => (
                    <li key={j} className="anim-item">• {p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );
    case "list":
    case "timeline":
      return (
        <div className="flex w-full flex-col items-center gap-5">
          {title}
          <ul className={`w-full space-y-3 ${scene.type === "timeline" ? "border-l-4 pl-4" : ""}`} style={{ borderColor: glow }}>
            {(scene.items ?? []).map((it, i) => (
              <li key={i} className={`anim-item ${card} flex items-center gap-3 text-[17px] font-bold leading-snug`}>
                <span className="text-3xl">{it.emoji ?? "👉"}</span>
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "number":
      return (
        <div className="flex flex-col items-center gap-4">
          <Big className="anim-float text-[clamp(70px,24vw,120px)]">{scene.emoji ?? "📌"}</Big>
          <div className="anim-pop text-center text-[clamp(48px,17vw,96px)] font-black leading-none tracking-tight" style={{ color: glow }}>
            {scene.value}
          </div>
          <p className="text-balance text-center text-xl font-bold"><Words text={scene.label ?? scene.text ?? ""} /></p>
        </div>
      );
    case "mnemonic":
      return (
        <div className="flex w-full flex-col items-center gap-5">
          <span className="anim-title rounded-full bg-white/15 px-4 py-1 text-sm font-black uppercase tracking-widest">🧠 {scene.text ?? "Memory trick"}</span>
          <div className="flex flex-wrap justify-center gap-1">
            {(scene.acronym ?? "").split("").map((ch, i) => (
              <span key={i} className="anim-pop text-[clamp(44px,15vw,84px)] font-black leading-none" style={{ color: glow }}>{ch}</span>
            ))}
          </div>
          <ul className="space-y-1 text-center text-lg font-bold">
            {(scene.words ?? []).map((w, i) => (
              <li key={i} className="anim-item">
                <span style={{ color: glow }}>{w.charAt(0)}</span>
                {w.slice(1)}
              </li>
            ))}
          </ul>
        </div>
      );
    case "story":
      return (
        <div className="flex w-full flex-col items-center gap-6">
          <div className="flex items-end justify-center gap-2">
            {(scene.emojis ?? [scene.emoji ?? "🤪"]).slice(0, 4).map((e, i) => (
              <Big key={i} className="anim-float text-[clamp(56px,20vw,110px)]">{e}</Big>
            ))}
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-widest">🎬 Picture this</span>
          {title}
        </div>
      );
    case "quiz":
      return (
        <div className="flex w-full flex-col items-center gap-4">
          <span className="anim-pop rounded-full bg-yellow-300 px-4 py-1 text-sm font-black uppercase tracking-widest text-black">⚡ Quick quiz</span>
          <h2 className="anim-title text-balance text-center text-[clamp(22px,7vw,34px)] font-black leading-tight">
            <Words text={scene.question ?? ""} />
          </h2>
          <div className="w-full space-y-2">
            {(scene.options ?? []).map((o, i) => {
              const right = i === (scene.answer ?? 0);
              return (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReveal();
                  }}
                  className={`anim-item w-full rounded-2xl px-4 py-3 text-left text-[17px] font-bold ring-2 transition-colors duration-300 ${
                    revealed ? (right ? "bg-green-500 ring-green-200" : "bg-black/30 opacity-50 ring-white/10") : "bg-black/30 ring-white/20 active:scale-[.98]"
                  }`}
                >
                  {String.fromCharCode(65 + i)}. {o} {revealed && right ? "✅" : ""}
                </button>
              );
            })}
          </div>
          {revealed && scene.explanation ? <p className="anim-reveal text-center text-lg font-bold" style={{ color: glow }}>{scene.explanation}</p> : null}
        </div>
      );
    case "punchline":
      return (
        <div className="flex flex-col items-center gap-6">
          <Big className="anim-shake text-[clamp(90px,30vw,170px)]">{scene.emoji ?? "🔥"}</Big>
          <h2 className="text-balance text-center text-[clamp(28px,9vw,48px)] font-black leading-tight" style={{ color: glow }}>
            <Words text={scene.text ?? ""} />
          </h2>
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-widest">Remember this 👆</span>
        </div>
      );
    default: // explain y cualquier tipo desconocido
      return (
        <div className="flex w-full flex-col items-center gap-5">
          {scene.emoji ? <Big className="anim-float text-[clamp(80px,28vw,150px)]">{scene.emoji}</Big> : null}
          {title}
          {scene.bullets?.length ? (
            <ul className="w-full space-y-2">
              {scene.bullets.map((b, i) => (
                <li key={i} className={`anim-item ${card} text-[17px] font-bold`}>✦ {b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
  }
}

export default function VideoPlayer({
  video,
  active,
  soundOn,
  onToggleSound,
  onSeen,
  onLike,
}: {
  video: StudyVideo;
  active: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onSeen: (id: string) => void;
  onLike: (id: string, liked: boolean) => void;
}) {
  const scenes = video.script.scenes;
  const palette = PALETTES[video.script.palette ?? ""] ?? PALETTES.galaxy;
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [wordIdx, setWordIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [heartBurst, setHeartBurst] = useState(0);
  const sceneRef = useRef<HTMLDivElement>(null);
  const seenSent = useRef(false);
  const scene = scenes[idx] ?? scenes[0];
  const words = useMemo(() => (scene.narration ?? "").split(/\s+/).filter(Boolean), [scene]);

  // Al salir de pantalla se para y vuelve al principio.
  useEffect(() => {
    if (!active) {
      setIdx(0);
      setPaused(false);
    }
  }, [active]);

  // Reproducción de la escena actual: voz (si hay sonido) o temporizador.
  useEffect(() => {
    setWordIdx(0);
    setRevealed(false);
    if (!active || paused) return;
    const seconds = sceneSeconds(scene);
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const next = () => {
      if (done) return;
      done = true;
      setIdx((i) => (i + 1) % scenes.length);
    };
    const start = performance.now();
    const ticker = setInterval(() => {
      const t = (performance.now() - start) / 1000;
      if (!soundOn || !window.speechSynthesis) setWordIdx(Math.min(words.length - 1, Math.floor((t / seconds) * words.length)));
      if (scene.type === "quiz" && t > seconds * 0.7) setRevealed(true);
    }, 120);

    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (soundOn && synth && scene.narration) {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(scene.narration);
      const v = englishVoice();
      if (v) u.voice = v;
      u.lang = v?.lang ?? "en-US";
      u.rate = 1.04;
      u.pitch = 1.05;
      u.onboundary = (e) => {
        if (e.name && e.name !== "word") return;
        setWordIdx(scene.narration!.slice(0, e.charIndex).split(/\s+/).filter(Boolean).length);
      };
      u.onend = () => {
        if (scene.type === "quiz") {
          setRevealed(true);
          timers.push(setTimeout(next, 2200));
        } else timers.push(setTimeout(next, 350));
      };
      synth.speak(u);
      timers.push(setTimeout(next, (seconds * 1.8 + 3) * 1000)); // por si la voz se cuelga
    } else {
      timers.push(setTimeout(next, seconds * 1000));
    }
    if (!seenSent.current) {
      timers.push(
        setTimeout(() => {
          seenSent.current = true;
          onSeen(video.id);
        }, 4000)
      );
    }
    return () => {
      done = true;
      clearInterval(ticker);
      timers.forEach(clearTimeout);
      synth?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, idx, soundOn, video.id]);

  // Animaciones de entrada de cada escena.
  useLayoutEffect(() => {
    if (!sceneRef.current) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) {
        gsap.from(sceneRef.current, { opacity: 0, duration: 0.3 });
        return;
      }
      const tl = gsap.timeline();
      tl.from(".anim-pop", { scale: 0, rotation: -25, opacity: 0, duration: 0.7, ease: "elastic.out(1,0.5)", stagger: 0.08 })
        .from(".anim-word", { y: 40, opacity: 0, rotationX: -80, duration: 0.45, ease: "back.out(2)", stagger: 0.05 }, 0.1)
        .from(".anim-left", { x: -120, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.1)
        .from(".anim-right", { x: 120, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.25)
        .from(".anim-item", { y: 30, opacity: 0, scale: 0.9, duration: 0.45, ease: "back.out(1.8)", stagger: 0.18 }, 0.35);
      gsap.to(".anim-shake", { rotation: 7, duration: 0.1, yoyo: true, repeat: 7, ease: "sine.inOut", delay: 0.6 });
      gsap.to(".anim-float", { y: -14, duration: 1.4, yoyo: true, repeat: -1, ease: "sine.inOut", stagger: 0.25 });
    }, sceneRef);
    return () => ctx.revert();
  }, [idx, video.id]);

  useLayoutEffect(() => {
    if (!revealed || reducedMotion() || !sceneRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".anim-reveal", { scale: 0.5, opacity: 0, duration: 0.5, ease: "back.out(2)" });
    }, sceneRef);
    return () => ctx.revert();
  }, [revealed]);

  const like = useCallback(() => {
    onLike(video.id, !video.liked);
    if (!video.liked) setHeartBurst((n) => n + 1);
  }, [onLike, video.id, video.liked]);

  // Subtítulo: trozo de ~6 palabras que contiene la palabra que suena.
  const chunkStart = Math.floor(wordIdx / 6) * 6;
  const chunk = words.slice(chunkStart, chunkStart + 6);

  return (
    <div
      className="relative h-full w-full overflow-hidden text-white"
      style={{ background: palette.bg }}
      onClick={() => setPaused((p) => !p)}
      onDoubleClick={like}
    >
      {/* fondo vivo */}
      <div className="study-blob pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-40 blur-3xl" style={{ background: palette.glow }} />
      <div className="study-blob study-blob-2 pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-white opacity-20 blur-3xl" />

      {/* barras de progreso por escena */}
      <div className="absolute inset-x-3 top-14 z-10 flex gap-1">
        {scenes.map((s, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className={`h-full rounded-full bg-white ${i === idx && active && !paused ? "study-progress" : ""}`}
              style={{
                width: i < idx ? "100%" : i === idx && active && !paused ? undefined : "0%",
                animationDuration: `${sceneSeconds(s) * (soundOn ? 1.15 : 1)}s`,
              }}
            />
          </div>
        ))}
      </div>

      {/* escena */}
      <div ref={sceneRef} key={`${video.id}-${idx}`} className="absolute inset-x-0 top-20 bottom-48 flex items-center justify-center px-6 [perspective:600px]">
        <SceneView scene={scene} glow={palette.glow} revealed={revealed} onReveal={() => setRevealed(true)} />
      </div>

      {/* subtítulos */}
      {chunk.length ? (
        <div className="pointer-events-none absolute bottom-32 left-4 right-20 z-10 flex justify-center">
          <p className="rounded-xl bg-black/55 px-3 py-1.5 text-center text-[19px] font-extrabold leading-snug">
            {chunk.map((w, i) => (
              <span key={i} className={chunkStart + i === wordIdx ? "text-yellow-300" : ""}>
                {w}{" "}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {/* info abajo */}
      <div className="absolute inset-x-4 bottom-4 right-20 z-10">
        <p className="text-[15px] font-black">@{video.subject.toLowerCase().replace(/\s+/g, "")} · <span className="font-semibold opacity-80">{video.topic}</span></p>
        <p className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug">{video.script.caption ?? video.title}</p>
        <p className="mt-1 truncate text-[13px] font-bold opacity-80">{(video.script.hashtags ?? []).join(" ")}</p>
      </div>

      {/* barra lateral */}
      <div className="absolute bottom-6 right-3 z-20 flex flex-col items-center gap-5" onClick={(e) => e.stopPropagation()}>
        <button onClick={like} aria-label="Me gusta" className="flex flex-col items-center text-xs font-bold">
          <span className={`text-[34px] transition-transform active:scale-75 ${video.liked ? "" : "grayscale opacity-90"}`}>{video.liked ? "❤️" : "🤍"}</span>
          {video.liked ? "Lo sé" : "Like"}
        </button>
        <button onClick={onToggleSound} aria-label="Sonido" className="flex flex-col items-center text-xs font-bold">
          <span className="text-[30px]">{soundOn ? "🔊" : "🔇"}</span>
          {soundOn ? "Voz" : "Sin voz"}
        </button>
        <button onClick={() => { setIdx(0); setPaused(false); }} aria-label="Repetir" className="flex flex-col items-center text-xs font-bold">
          <span className="text-[30px]">🔁</span>
          Otra vez
        </button>
      </div>

      {paused ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="rounded-full bg-black/40 p-6 text-5xl">▶️</span>
        </div>
      ) : null}
      {heartBurst ? <span key={heartBurst} className="study-heart pointer-events-none absolute left-1/2 top-1/2 z-30 text-[120px]">❤️</span> : null}
    </div>
  );
}
