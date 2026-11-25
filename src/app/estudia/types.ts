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
  mood?: string;
  say?: string;
  choices?: { text: string; emoji?: string; reaction?: string }[];
  hidden?: string;
  svg?: string;
  headers?: string[];
  rows?: string[][];
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

// Color del rotulador principal de cada vídeo (estilo Draw My Life: folio blanco + rotuladores).
export const MARKERS: Record<string, string> = {
  red: "#e63946",
  blue: "#1d6fe0",
  green: "#22995a",
  orange: "#f08a24",
  purple: "#8e44ad",
  pink: "#e84393",
  // nombres antiguos de paleta (vídeos ya creados)
  fire: "#e63946",
  ocean: "#1d6fe0",
  toxic: "#22995a",
  candy: "#e84393",
  galaxy: "#8e44ad",
  sunset: "#f08a24",
};

export function sceneSeconds(scene: Scene): number {
  const words = (scene.narration ?? "").split(/\s+/).filter(Boolean).length;
  return Math.max(4, words / 2.1 + 1.4);
}

export function videoSeconds(script: Script): number {
  return Math.round(script.scenes.reduce((s, sc) => s + sceneSeconds(sc), 0));
}
