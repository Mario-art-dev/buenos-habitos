export interface Scene {
  type: string;
  narration?: string;
  text?: string;
  emoji?: string;
  emojis?: string[];
  bullets?: string[];
  items?: { emoji?: string; text: string }[];
  left?: { emoji?: string; label?: string; points?: string[] };
  right?: { emoji?: string; label?: string; points?: string[] };
  value?: string;
  label?: string;
  acronym?: string;
  words?: string[];
  question?: string;
  options?: string[];
  answer?: number;
  explanation?: string;
}

export interface Script {
  title?: string;
  caption?: string;
  palette?: string;
  scenes: Scene[];
  hashtags?: string[];
  takeaway?: string;
  keyFacts?: string[];
}

export interface StudyVideo {
  id: string;
  subject: string;
  topic: string;
  title: string;
  order: number;
  seen: boolean;
  liked: boolean;
  createdAt: string;
  script: Script;
}

export const PALETTES: Record<string, { bg: string; glow: string }> = {
  fire: { bg: "linear-gradient(160deg,#ff512f 0%,#dd2476 55%,#2b0a3d 100%)", glow: "#ffd166" },
  ocean: { bg: "linear-gradient(160deg,#00c6ff 0%,#0072ff 50%,#081a4b 100%)", glow: "#7cf8ff" },
  toxic: { bg: "linear-gradient(160deg,#16a34a 0%,#0f766e 50%,#04211c 100%)", glow: "#bef264" },
  candy: { bg: "linear-gradient(160deg,#f953c6 0%,#b91d73 55%,#2d0620 100%)", glow: "#fde68a" },
  galaxy: { bg: "linear-gradient(160deg,#3a1c71 0%,#7b2d8b 45%,#0b0322 100%)", glow: "#ffaf7b" },
  sunset: { bg: "linear-gradient(160deg,#f7971e 0%,#e1306c 55%,#2a0b2e 100%)", glow: "#fff3a3" },
};

export function sceneSeconds(scene: Scene): number {
  const words = (scene.narration ?? "").split(/\s+/).filter(Boolean).length;
  return Math.max(3, words / 2.6 + (scene.type === "quiz" ? 2.5 : 0.6));
}

export function videoSeconds(script: Script): number {
  return Math.round(script.scenes.reduce((s, sc) => s + sceneSeconds(sc), 0));
}
