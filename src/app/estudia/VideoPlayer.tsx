"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { MARKERS, sceneSeconds, type Scene, type StudyVideo } from "./types";

// Reproductor estilo «Draw My Life»: folio blanco, una mano con rotulador que va dibujando y
// escribiendo cada cosa en directo, un muñeco de palitos que reacciona, voz en inglés del
// navegador y momentos interactivos (test, elegir opción, tocar para descubrir).

const INK = "#1c1c1c";
const HIGHLIGHT = "#ffe45c";
const INTERACTIVE = new Set(["quiz", "choice", "reveal"]);

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- voz y efectos de sonido

let cachedVoice: SpeechSynthesisVoice | null | undefined;
function englishVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const en = (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith("en"));
  const preferred = ["Samantha", "Google US English", "Ava", "Allison", "Daniel", "Karen", "Microsoft Aria"];
  cachedVoice = preferred.map((n) => en.find((v) => v.name.includes(n))).find(Boolean) ?? en.find((v) => v.lang === "en-US") ?? en[0] ?? null;
  return cachedVoice;
}

function speak(text: string, onEnd?: () => void, onWord?: (i: number) => void) {
  const synth = window.speechSynthesis;
  if (!synth) return onEnd?.();
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = englishVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? "en-US";
  u.rate = 1.05;
  u.pitch = 1.08;
  u.onboundary = (e) => {
    if (e.name && e.name !== "word") return;
    onWord?.(text.slice(0, e.charIndex).split(/\s+/).filter(Boolean).length);
  };
  u.onend = () => onEnd?.();
  synth.speak(u);
}

let audioCtx: AudioContext | null = null;
function sfx(kind: "right" | "wrong" | "pop") {
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const notes = kind === "right" ? [660, 880, 1320] : kind === "wrong" ? [220, 160] : [520];
    notes.forEach((f, i) => {
      const o = audioCtx!.createOscillator();
      const g = audioCtx!.createGain();
      o.type = kind === "wrong" ? "sawtooth" : "triangle";
      o.frequency.value = f;
      const t = audioCtx!.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(audioCtx!.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch {}
}

// ---------------------------------------------------------------- piezas dibujadas

/** Texto escrito a mano palabra a palabra. *palabra* = subrayada con fosforito. */
function Hand({ text = "", className = "", style }: { text?: string; className?: string; style?: React.CSSProperties }) {
  let hl = false;
  return (
    <span className={className} style={style}>
      {text.split(/\s+/).filter(Boolean).map((raw, i) => {
        const starts = raw.startsWith("*");
        const ends = raw.replace(/[.,!?:;]+$/, "").endsWith("*");
        if (starts) hl = true;
        const on = hl;
        if (ends) hl = false;
        const w = raw.replace(/\*/g, "");
        return (
          <span key={i} className="draw inline-block whitespace-pre" style={on ? { background: `linear-gradient(transparent 55%, ${HIGHLIGHT} 55%, ${HIGHLIGHT} 92%, transparent 92%)` } : undefined}>
            {w}{" "}
          </span>
        );
      })}
    </span>
  );
}

function Emoji({ e, size, className = "" }: { e?: string; size: string; className?: string }) {
  if (!e) return null;
  return (
    <span className={`draw float inline-block select-none leading-none ${className}`} style={{ fontSize: size }}>
      {e}
    </span>
  );
}

function Underline({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 200 12" preserveAspectRatio="none" className="mx-auto mt-0.5 block h-3 w-4/5">
      <path className="stroke" d="M3 8 C 40 2, 70 12, 100 6 S 160 2, 197 7" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Garabato circular alrededor de algo (se dibuja con el rotulador). */
function Scribble({ color, className = "" }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 120 100" preserveAspectRatio="none" className={`pointer-events-none absolute -inset-3 h-[calc(100%+24px)] w-[calc(100%+24px)] ${className}`}>
      <path className="stroke" d="M60 6 C 100 4, 116 30, 112 52 C 108 82, 70 96, 46 92 C 16 88, 4 62, 8 40 C 12 16, 40 4, 70 8" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Arrow({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 60 30" className="h-8 w-14 shrink-0">
      <path className="stroke" d="M4 16 C 20 8, 36 22, 52 14" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
      <path className="stroke" d="M42 6 L 54 14 L 44 24" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Muñeco de palitos (el protagonista de cada Draw My Life) con distintas caras y poses. */
function Stick({ mood = "happy", color, size = 96, flip = false }: { mood?: string; color: string; size?: number; flip?: boolean }) {
  const p = { fill: "none", stroke: INK, strokeWidth: 3.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "stroke" };
  const arms: Record<string, string[]> = {
    shocked: ["M50 60 L 26 38", "M50 60 L 74 38"],
    happy: ["M50 60 L 28 44", "M50 60 L 72 44"],
    laughing: ["M50 60 L 30 78", "M50 60 L 70 78"],
    thinking: ["M50 60 L 30 82", "M50 60 L 64 70 L 58 44"],
    pointing: ["M50 60 L 30 82", "M50 60 L 88 52"],
    sad: ["M50 60 L 38 88", "M50 60 L 62 88"],
    cool: ["M50 60 L 30 82", "M50 60 L 66 72 L 76 58"],
    angry: ["M50 60 L 32 66 L 40 56", "M50 60 L 68 66 L 60 56"],
  };
  const m = arms[mood] ? mood : "happy";
  const mouth: Record<string, string> = {
    shocked: "M45 34 a5 6 0 1 0 10 0 a5 6 0 1 0 -10 0",
    happy: "M41 31 Q 50 40 59 31",
    laughing: "M40 30 Q 50 44 60 30 Z",
    thinking: "M43 34 L 56 32",
    pointing: "M42 31 Q 50 38 58 31",
    sad: "M42 37 Q 50 29 58 37",
    cool: "M42 32 Q 52 38 59 30",
    angry: "M42 36 Q 50 31 58 36",
  };
  return (
    <svg viewBox="0 0 100 140" width={size} height={size * 1.4} className="shrink-0 overflow-visible" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <circle cx="50" cy="26" r="19" {...p} />
      {m === "cool" ? (
        <path className="stroke" d="M34 22 L 66 22 M36 22 q 6 9 12 0 M52 22 q 6 9 12 0" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      ) : m === "angry" ? (
        <path className="stroke" d="M38 16 L 46 20 M62 16 L 54 20 M42 24 l0 1 M58 24 l0 1" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      ) : m === "laughing" ? (
        <path className="stroke" d="M38 22 q 4 -5 8 0 M54 22 q 4 -5 8 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      ) : (
        <path className="stroke" d={m === "shocked" ? "M42 20 l0 4 M58 20 l0 4" : "M43 22 l0 2 M57 22 l0 2"} fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
      )}
      <path {...p} d={mouth[m]} fill={m === "laughing" ? color : "none"} />
      <path {...p} d="M50 45 L 50 96" />
      <path {...p} d={arms[m][0]} />
      <path {...p} d={arms[m][1]} />
      <path {...p} d="M50 96 L 34 132 M50 96 L 66 132" />
      {m === "shocked" ? <path className="stroke" d="M76 10 q 6 8 0 12 q -6 -4 0 -12" fill="#8ecbff" stroke="#3b82f6" strokeWidth="2" /> : null}
      {m === "thinking" ? <text className="draw" x="74" y="12" fontSize="22" fill={color} fontFamily="inherit">?</text> : null}
      {m === "sad" ? <path className="stroke" d="M41 28 l -2 8" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" /> : null}
    </svg>
  );
}

/** Bocadillo de cómic con lo que dice el muñeco. */
function Bubble({ text, color, side = "right" }: { text: string; color: string; side?: "left" | "right" }) {
  return (
    <div className="relative max-w-[62%] px-5 pb-5 pt-3">
      <svg viewBox="0 0 200 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <path
          className="stroke"
          d={side === "right" ? "M30 4 C 120 0, 196 6, 196 46 C 196 84, 120 92, 50 88 L 6 104 L 22 80 C 4 66, 2 30, 30 4" : "M170 4 C 80 0, 4 6, 4 46 C 4 84, 80 92, 150 88 L 194 104 L 178 80 C 196 66, 198 30, 170 4"}
          fill="#fff"
          stroke={INK}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <Hand text={text} className="relative block text-[17px] leading-tight" style={{ color }} />
    </div>
  );
}

function Title({ text, color, big = false }: { text?: string; color: string; big?: boolean }) {
  if (!text) return null;
  return (
    <div className="w-full text-center">
      <h2 className={`font-marker text-balance leading-[1.08] ${big ? "text-[clamp(30px,9.5vw,50px)]" : "text-[clamp(24px,7.4vw,38px)]"}`} style={{ color: big ? color : INK }}>
        <Hand text={text} />
      </h2>
      <Underline color={color} />
    </div>
  );
}

function Character({ scene, color, defaultMood }: { scene: Scene; color: string; defaultMood: string }) {
  return (
    <div className="flex items-end justify-center gap-1">
      <Stick mood={scene.mood ?? defaultMood} color={color} />
      {scene.say ? <Bubble text={scene.say} color={color} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- escenas

function SceneView({
  scene,
  color,
  picked,
  waiting,
  onPick,
}: {
  scene: Scene;
  color: string;
  picked: number | null;
  waiting: boolean;
  onPick: (i: number) => void;
}) {
  const box = "rounded-[18px_14px_20px_12px] border-[3px] px-3 py-2";
  switch (scene.type) {
    case "hook":
      return (
        <div className="flex w-full flex-col items-center gap-4">
          <Title text={scene.text} color={color} big />
          <div className="flex items-end gap-2">
            <Stick mood={scene.mood ?? "shocked"} color={color} size={88} />
            <span className="relative">
              <Emoji e={scene.emoji ?? "🤯"} size="clamp(70px,24vw,120px)" />
              <Scribble color={color} />
            </span>
          </div>
          {scene.say ? <Bubble text={scene.say} color={color} /> : null}
        </div>
      );
    case "analogy":
      return (
        <div className="flex w-full flex-col items-center gap-4">
          <Title text={scene.text} color={color} />
          <div className="flex w-full items-center justify-center gap-1">
            {[scene.left, scene.right].map((s, i) => (
              <div key={i} className="contents">
                {i === 1 ? <span className="draw font-marker text-4xl" style={{ color }}>=</span> : null}
                <div className="flex flex-1 flex-col items-center gap-1">
                  <Emoji e={s?.emoji} size="clamp(60px,20vw,104px)" />
                  <Hand text={s?.label} className="text-center text-[20px] font-bold" />
                </div>
              </div>
            ))}
          </div>
          <Character scene={scene} color={color} defaultMood="pointing" />
        </div>
      );
    case "compare":
      return (
        <div className="flex w-full flex-col items-center gap-3">
          <Title text={scene.text} color={color} />
          <div className="grid w-full grid-cols-2 gap-3">
            {[scene.left, scene.right].map((side, i) => (
              <div key={i} className={`${box} draw flex flex-col items-center gap-1`} style={{ borderColor: i ? color : INK }}>
                <Emoji e={side?.emoji} size="52px" />
                <Hand text={side?.label} className="font-marker text-center text-[20px]" style={{ color: i ? color : INK }} />
                <ul className="space-y-0.5 text-[16px] leading-snug">
                  {(side?.points ?? []).map((p, j) => (
                    <li key={j}>
                      <Hand text={`• ${p}`} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <Character scene={scene} color={color} defaultMood="thinking" />
        </div>
      );
    case "list":
    case "timeline":
      return (
        <div className="flex w-full flex-col items-center gap-3">
          <Title text={scene.text} color={color} />
          <ul className={`w-full space-y-2.5 ${scene.type === "timeline" ? "border-l-[3px] border-dashed pl-4" : ""}`} style={{ borderColor: color }}>
            {(scene.items ?? []).map((it, i) => (
              <li key={i} className="flex items-center gap-3 text-[19px] leading-snug">
                <Emoji e={it.emoji ?? "👉"} size="34px" />
                <Hand text={it.text} />
              </li>
            ))}
          </ul>
          <Character scene={scene} color={color} defaultMood="pointing" />
        </div>
      );
    case "number":
      return (
        <div className="flex w-full flex-col items-center gap-3">
          <span className="relative mt-2 px-4">
            <span className="draw font-marker block text-center text-[clamp(46px,16vw,88px)] leading-none" style={{ color }}>
              {scene.value}
            </span>
            <Scribble color={INK} />
          </span>
          <Hand text={scene.label ?? scene.text} className="mt-2 text-balance text-center text-[22px]" />
          <div className="flex items-end gap-2">
            <Stick mood={scene.mood ?? "shocked"} color={color} size={80} />
            <Emoji e={scene.emoji} size="64px" />
          </div>
          {scene.say ? <Bubble text={scene.say} color={color} /> : null}
        </div>
      );
    case "mnemonic":
      return (
        <div className="flex w-full flex-col items-center gap-3">
          <Hand text={`🧠 ${scene.text ?? "Memory trick"}`} className="font-marker text-[22px]" style={{ color }} />
          <div className="flex flex-wrap justify-center gap-1.5">
            {(scene.acronym ?? "").split("").map((ch, i) => (
              <span key={i} className={`${box} draw font-marker text-[clamp(34px,11vw,60px)] leading-none`} style={{ borderColor: INK, color }}>
                {ch}
              </span>
            ))}
          </div>
          <ul className="space-y-0.5 text-center text-[20px]">
            {(scene.words ?? []).map((w, i) => (
              <li key={i} className="draw">
                <span className="font-marker" style={{ color }}>{w.charAt(0)}</span>
                {w.slice(1)}
              </li>
            ))}
          </ul>
          <Character scene={scene} color={color} defaultMood="cool" />
        </div>
      );
    case "story":
      return (
        <div className="flex w-full flex-col items-center gap-3">
          <Hand text="🎬 Picture this…" className="text-[16px] uppercase tracking-widest" style={{ color }} />
          <div className="flex items-end justify-center gap-1">
            <Stick mood={scene.mood ?? "laughing"} color={color} size={80} />
            {(scene.emojis ?? [scene.emoji ?? "🤪"]).slice(0, 3).map((e, i) => (
              <Emoji key={i} e={e} size="clamp(48px,16vw,84px)" />
            ))}
          </div>
          <Hand text={scene.text} className="text-balance text-center text-[24px] leading-tight" />
          {scene.say ? <Bubble text={scene.say} color={color} /> : null}
        </div>
      );
    case "quiz":
    case "choice": {
      const isQuiz = scene.type === "quiz";
      const opts: { text: string; emoji?: string; reaction?: string }[] = isQuiz ? (scene.options ?? []).map((o) => ({ text: o })) : scene.choices ?? [];
      const answer = scene.answer ?? 0;
      return (
        <div className="flex w-full flex-col items-center gap-3">
          <Hand text={isQuiz ? "⚡ QUICK QUIZ" : "🤔 YOUR CHOICE"} className="font-marker text-[20px]" style={{ color }} />
          <h2 className="text-balance text-center text-[clamp(22px,6.8vw,30px)] leading-tight">
            <Hand text={scene.question} />
          </h2>
          <div className="w-full space-y-2">
            {opts.map((o, i) => {
              const done = picked !== null;
              const good = isQuiz ? i === answer : i === picked;
              const border = done ? (good ? "#22995a" : i === picked ? "#e63946" : "#bbb") : INK;
              return (
                <button
                  key={i}
                  disabled={done}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(i);
                  }}
                  className={`${box} draw flex w-full items-center gap-2 bg-white text-left text-[19px] leading-snug transition-transform active:scale-[.97] ${done && !good && i !== picked ? "opacity-40" : ""}`}
                  style={{ borderColor: border }}
                >
                  <span className="font-marker" style={{ color }}>{o.emoji ?? String.fromCharCode(65 + i)}</span>
                  <span className="flex-1">{o.text}</span>
                  {done && isQuiz && i === answer ? "✅" : done && isQuiz && i === picked ? "❌" : ""}
                </button>
              );
            })}
          </div>
          {picked === null ? (
            waiting ? <span className="tap-hint text-[18px]" style={{ color }}>👆 Tap your answer!</span> : null
          ) : (
            <div className="reveal flex items-end gap-2">
              <Stick mood={isQuiz ? (picked === answer ? "laughing" : "sad") : "laughing"} color={color} size={64} />
              <Bubble
                text={isQuiz ? `${picked === answer ? "YES! 🎉" : "Nope! 😅"} ${scene.explanation ?? ""}` : opts[picked]?.reaction ?? "Nice!"}
                color={color}
              />
            </div>
          )}
        </div>
      );
    }
    case "reveal":
      return (
        <div className="flex w-full flex-col items-center gap-4">
          <Title text={scene.text} color={color} />
          <button
            disabled={picked !== null}
            onClick={(e) => {
              e.stopPropagation();
              onPick(0);
            }}
            className={`${box} draw relative flex min-h-[120px] w-full items-center justify-center text-center text-[24px]`}
            style={{ borderColor: color, background: picked === null ? `repeating-linear-gradient(45deg, ${color}22 0 10px, transparent 10px 20px)` : "#fff" }}
          >
            {picked === null ? (
              <span className="font-marker">{waiting ? "👆 Tap to reveal" : "???"}</span>
            ) : (
              <span className="reveal font-marker" style={{ color }}>
                {scene.emoji ? `${scene.emoji} ` : ""}
                {scene.hidden}
              </span>
            )}
          </button>
          <Character scene={scene} color={color} defaultMood={picked === null ? "thinking" : "shocked"} />
        </div>
      );
    case "punchline":
      return (
        <div className="flex w-full flex-col items-center gap-4">
          <Hand text="📝 REMEMBER" className="font-marker text-[18px] tracking-widest" style={{ color }} />
          <Title text={scene.text} color={color} big />
          <div className="flex items-end gap-2">
            <Stick mood={scene.mood ?? "cool"} color={color} size={88} />
            <Emoji e={scene.emoji ?? "🔥"} size="72px" />
          </div>
          {scene.say ? <Bubble text={scene.say} color={color} /> : null}
        </div>
      );
    default:
      return (
        <div className="flex w-full flex-col items-center gap-3">
          <Title text={scene.text} color={color} />
          {scene.emoji ? <Emoji e={scene.emoji} size="clamp(60px,20vw,100px)" /> : null}
          {scene.bullets?.length ? (
            <ul className="w-full space-y-1.5 text-[19px] leading-snug">
              {scene.bullets.map((b, i) => (
                <li key={i}>
                  <Hand text={`✦ ${b}`} />
                </li>
              ))}
            </ul>
          ) : null}
          <Character scene={scene} color={color} defaultMood="pointing" />
        </div>
      );
  }
}

// ---------------------------------------------------------------- reproductor

export default function VideoPlayer({
  video,
  active,
  soundOn,
  onToggleSound,
  onSeen,
  onLike,
  onCorrect,
}: {
  video: StudyVideo;
  active: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onSeen: (id: string) => void;
  onLike: (id: string, liked: boolean) => void;
  onCorrect?: () => void;
}) {
  const scenes = video.script.scenes;
  const color = MARKERS[video.script.palette ?? ""] ?? MARKERS.red;
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [wordIdx, setWordIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [heartBurst, setHeartBurst] = useState(0);
  const sceneRef = useRef<HTMLDivElement>(null);
  const penRef = useRef<HTMLSpanElement>(null);
  const seenSent = useRef(false);
  const scene = scenes[idx] ?? scenes[0];
  const interactive = INTERACTIVE.has(scene.type);
  const words = useMemo(() => (scene.narration ?? "").split(/\s+/).filter(Boolean), [scene]);

  const goNext = () => setIdx((i) => (i + 1) % scenes.length);

  useEffect(() => {
    if (!active) {
      setIdx(0);
      setPaused(false);
    }
  }, [active]);

  // Reproducción de la escena: voz (o temporizador). Las interactivas esperan a que toques.
  useEffect(() => {
    setWordIdx(0);
    setPicked(null);
    setWaiting(false);
    if (!active || paused) return;
    const seconds = sceneSeconds(scene);
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => {
      if (done) return;
      done = true;
      if (interactive) {
        setWaiting(true);
        // si no tocas en 12 s, se resuelve solo
        timers.push(setTimeout(() => setPicked((p) => (p === null ? (scene.type === "quiz" ? scene.answer ?? 0 : 0) : p)), 12_000));
      } else timers.push(setTimeout(goNext, 400));
    };
    const start = performance.now();
    const useVoice = soundOn && !!window.speechSynthesis && !!scene.narration;
    const ticker = setInterval(() => {
      if (!useVoice) setWordIdx(Math.min(words.length - 1, Math.floor(((performance.now() - start) / 1000 / seconds) * words.length)));
    }, 120);
    if (useVoice) {
      speak(scene.narration!, finish, setWordIdx);
      timers.push(setTimeout(finish, (seconds * 1.8 + 3) * 1000));
    } else timers.push(setTimeout(finish, seconds * 1000));
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
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, idx, soundOn, video.id]);

  // Tras responder: reacción (sonido + voz) y a la siguiente escena.
  useEffect(() => {
    if (picked === null || !active) return;
    const isQuiz = scene.type === "quiz";
    const right = isQuiz && picked === (scene.answer ?? 0);
    if (isQuiz && right) onCorrect?.();
    let line = "";
    if (isQuiz) line = `${right ? "Yes! Correct!" : "Nope!"} ${scene.explanation ?? ""}`;
    else if (scene.type === "choice") line = scene.choices?.[picked]?.reaction ?? "";
    else line = scene.hidden ?? "";
    if (soundOn) sfx(isQuiz ? (right ? "right" : "wrong") : "pop");
    let t: ReturnType<typeof setTimeout>;
    const after = () => (t = setTimeout(goNext, 1400));
    if (soundOn && line) {
      speak(line, after);
      t = setTimeout(goNext, 9000);
    } else t = setTimeout(goNext, 3200);
    if (!reducedMotion() && sceneRef.current) {
      const ctx = gsap.context(() => {
        gsap.from(".reveal", { scale: 0.4, opacity: 0, duration: 0.5, ease: "back.out(2.2)" });
        if (isQuiz && !right) gsap.fromTo(sceneRef.current, { x: -8 }, { x: 0, duration: 0.4, ease: "elastic.out(1,0.2)" });
      }, sceneRef);
      return () => {
        clearTimeout(t);
        ctx.revert();
      };
    }
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  // La mano dibuja: cada palabra, emoji y trazo aparece en orden con el rotulador encima.
  useLayoutEffect(() => {
    const root = sceneRef.current;
    const pen = penRef.current;
    if (!root || !pen) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) {
        gsap.set(pen, { opacity: 0 });
        return;
      }
      const base = root.getBoundingClientRect();
      const els = Array.from(root.querySelectorAll<HTMLElement | SVGGeometryElement>(".draw, .stroke"));
      const plan = els.map((el) => {
        const r = el.getBoundingClientRect();
        const isStroke = el.classList.contains("stroke") && "getTotalLength" in el;
        const len = isStroke ? (el as SVGGeometryElement).getTotalLength() : 0;
        const dur = isStroke ? Math.min(0.5, 0.12 + len / 900) : Math.min(0.6, 0.08 + ((el.textContent ?? "").length || 3) * 0.03);
        return { el, r, isStroke, len, dur };
      });
      const total = plan.reduce((s, p) => s + p.dur, 0);
      const budget = Math.max(1.5, sceneSeconds(scene) * 0.6);
      const k = total > budget ? budget / total : 1;
      const tl = gsap.timeline();
      gsap.set(pen, { opacity: 1, x: base.width * 0.8, y: base.height });
      let t = 0.1;
      for (const p of plan) {
        const d = p.dur * k;
        const x0 = p.r.left - base.left;
        const y0 = p.r.top - base.top + p.r.height * 0.75;
        if (p.isStroke) {
          const filled = (p.el.getAttribute("fill") ?? "none") !== "none";
          gsap.set(p.el, { strokeDasharray: p.len + 1, strokeDashoffset: p.len + 1, fillOpacity: filled ? 0 : 1 });
          tl.to(p.el, { strokeDashoffset: 0, duration: d, ease: "none" }, t);
          if (filled) tl.to(p.el, { fillOpacity: 1, duration: 0.25 }, t + d * 0.6);
          tl.fromTo(pen, { x: x0, y: p.r.top - base.top }, { x: x0 + p.r.width, y: y0, duration: d, ease: "sine.inOut" }, t);
        } else {
          tl.fromTo(p.el, { clipPath: "inset(-20% 100% -20% -5%)" }, { clipPath: "inset(-20% -5% -20% -5%)", duration: d, ease: "none" }, t);
          tl.fromTo(pen, { x: x0, y: y0 }, { x: x0 + p.r.width, y: y0 - 2, duration: d, ease: "none" }, t);
        }
        t += d + 0.03 * k;
      }
      tl.to(pen, { x: base.width + 40, y: base.height + 60, duration: 0.5, ease: "power2.in" }, t + 0.1);
      gsap.to(".float", { y: -6, rotation: 3, duration: 1.3, yoyo: true, repeat: -1, ease: "sine.inOut", delay: t, stagger: 0.2 });
    }, sceneRef);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, video.id]);

  const like = () => {
    onLike(video.id, !video.liked);
    if (!video.liked) setHeartBurst((n) => n + 1);
  };

  const chunkStart = Math.floor(wordIdx / 6) * 6;
  const chunk = words.slice(chunkStart, chunkStart + 6);
  const showCaption = chunk.length && !(interactive && picked !== null);

  return (
    <div
      className="font-hand relative h-full w-full overflow-hidden"
      style={{ color: INK, background: "#fbfaf4", backgroundImage: "radial-gradient(#00000010 1px, transparent 1px)", backgroundSize: "22px 22px" }}
      onClick={() => setPaused((p) => !p)}
      onDoubleClick={like}
    >
      {/* barras de progreso */}
      <div className="absolute inset-x-3 top-14 z-10 flex gap-1">
        {scenes.map((s, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-black/10">
            <div
              className={`h-full rounded-full ${i === idx && active && !paused && !waiting ? "study-progress" : ""}`}
              style={{
                background: color,
                width: i < idx || (i === idx && waiting) ? "100%" : i === idx && active && !paused ? undefined : "0%",
                animationDuration: `${sceneSeconds(s) * (soundOn ? 1.15 : 1)}s`,
              }}
            />
          </div>
        ))}
      </div>

      {/* folio con la escena */}
      <div ref={sceneRef} key={`${video.id}-${idx}`} className="absolute inset-x-0 bottom-44 top-20 flex items-center justify-center px-5">
        <SceneView scene={scene} color={color} picked={picked} waiting={waiting} onPick={(i) => setPicked(i)} />
        <span ref={penRef} className="pointer-events-none absolute left-0 top-0 z-20 -ml-1 -mt-11 select-none text-[52px] opacity-0 drop-shadow-[0_6px_6px_rgba(0,0,0,.25)]" aria-hidden>
          ✍️
        </span>
      </div>

      {/* subtítulos */}
      {showCaption ? (
        <div className="pointer-events-none absolute bottom-[6.5rem] left-4 right-20 z-10 flex justify-center">
          <p className="rounded-xl bg-black/80 px-3 py-1.5 text-center font-sans text-[18px] font-extrabold leading-snug text-white">
            {chunk.map((w, i) => (
              <span key={i} className={chunkStart + i === wordIdx ? "text-yellow-300" : ""}>
                {w}{" "}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {/* info abajo */}
      <div className="absolute bottom-4 left-4 right-20 z-10 font-sans">
        <p className="text-[15px] font-black">
          @{video.subject.toLowerCase().replace(/\s+/g, "")} · <span className="font-semibold opacity-60">{video.topic}</span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug">{video.script.caption ?? video.title}</p>
        <p className="mt-0.5 truncate text-[13px] font-bold" style={{ color }}>{(video.script.hashtags ?? []).join(" ")}</p>
      </div>

      {/* barra lateral */}
      <div className="absolute bottom-6 right-3 z-20 flex flex-col items-center gap-4 font-sans" onClick={(e) => e.stopPropagation()}>
        <button onClick={like} aria-label="Me gusta" className="flex flex-col items-center text-xs font-bold">
          <span className="text-[32px] transition-transform active:scale-75">{video.liked ? "❤️" : "🤍"}</span>
          {video.liked ? "Lo sé" : "Like"}
        </button>
        <button onClick={onToggleSound} aria-label="Sonido" className="flex flex-col items-center text-xs font-bold">
          <span className="text-[28px]">{soundOn ? "🔊" : "🔇"}</span>
          {soundOn ? "Voz" : "Sin voz"}
        </button>
        <button onClick={() => { setIdx(0); setPaused(false); }} aria-label="Repetir" className="flex flex-col items-center text-xs font-bold">
          <span className="text-[28px]">🔁</span>
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
