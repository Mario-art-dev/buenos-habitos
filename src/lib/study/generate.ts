import { getAIProvider, type AIImage } from "@/lib/ai/provider";

// Modo Estudia: cada temario se divide en 5 partes iguales y cada parte da UN vídeo de unos
// 2 minutos, en inglés, estilo "Draw My Life": explicación con voz, ejemplos concretos y
// dibujos animados con colores. Un solo paso por vídeo (sin planificar antes) para ir rápido.

export { VIDEOS_PER_DOCUMENT } from "./constants";

const SCENE_TYPES = `The video is a "Draw My Life" style whiteboard animation: a real hand draws everything live
with coloured markers on a glossy white board (red, blue, green, orange, purple accents), and a STICK FIGURE
narrator reacts in every scene. Every scene may add:
  "mood": stick figure face/pose — one of happy|shocked|thinking|laughing|pointing|sad|cool|angry
  "say": a SHORT line the stick figure says in a comic speech bubble (<=7 words), optional
In on-screen texts wrap the 1-2 most important words in *asterisks* (they get a highlighter).

Scene types (7-10 scenes in total, vary them, choose the ones that fit THIS content):
- {"type":"hook","text":"<=8 words, a surprising question or fact","emoji":"🤯","mood":"shocked","say":"...","narration":"..."}   (always first)
- {"type":"explain","text":"short headline","bullets":["<=7 words"],"emoji":"🧠","mood":"pointing","narration":"..."}
- {"type":"example","text":"For example…","emoji":"🍎","label":"concrete everyday example in <=8 words","mood":"happy","narration":"a real, concrete example that makes the idea obvious"}
- {"type":"analogy","text":"X is like Y","left":{"emoji":"🫀","label":"Heart"},"right":{"emoji":"🚒","label":"Fire pump"},"say":"...","narration":"..."}
- {"type":"list","text":"headline","items":[{"emoji":"1️⃣","text":"<=6 words"}],"narration":"..."}   (2-5 items)
- {"type":"compare","text":"A vs B","left":{"label":"A","emoji":"🐢","points":["<=5 words"]},"right":{"label":"B","emoji":"🐇","points":["..."]},"narration":"..."}
- {"type":"number","value":"1492","label":"what it means","emoji":"⛵","mood":"shocked","narration":"..."}   (dates, stats, formulas like "E=mc²")
- {"type":"chart","text":"headline","value":"up or down","label":"WHAT IS MEASURED","mood":"happy","narration":"..."}
- {"type":"timeline","text":"headline","items":[{"emoji":"🏛️","text":"753 BC — Rome founded"}],"narration":"..."}
- {"type":"mnemonic","acronym":"HOMES","words":["Huron","Ontario","Michigan","Erie","Superior"],"text":"memory trick","mood":"cool","narration":"..."}
- {"type":"story","text":"absurd, vivid mental image <=14 words","emojis":["🦖","🍕","🚀"],"mood":"laughing","say":"...","narration":"..."}
- INTERACTIVE (the video waits for the viewer to tap):
  {"type":"quiz","question":"...","options":["A","B","C"],"answer":0,"explanation":"<=12 words","narration":"reads the question"}
  {"type":"choice","question":"a 'what would you do?' or 'which one is right?' question","choices":[{"emoji":"🅰️","text":"<=6 words","reaction":"reaction that teaches the fact, <=18 words"}],"narration":"..."}   (2-3 choices)
  {"type":"reveal","text":"Guess what…","hidden":"the surprising fact <=10 words","emoji":"💥","mood":"thinking","narration":"builds suspense, asks the viewer to tap"}
- {"type":"punchline","text":"<=10 word key takeaway","emoji":"🔥","mood":"cool","say":"...","narration":"..."}   (always last)

Every video MUST contain at least one "example" scene, at least 2 interactive scenes (one "quiz" near the end
and one "choice" or "reveal").`;

export async function writeVideo(params: {
  subject: string;
  topic: string;
  partIndex: number;
  total: number;
  text: string;
  images?: AIImage[];
}): Promise<Record<string, unknown>> {
  const provider = await getAIProvider();
  const isWhole = params.total === 1;
  const raw = await provider.chatJson({
    system:
      "You are a brilliant, patient teacher who makes 'Draw My Life' whiteboard videos for students. " +
      "The narrator EXPLAINS clearly, step by step, in a warm and energetic voice, with concrete " +
      "examples, comparisons and memorable images, and a little humour. You write in ENGLISH (simple " +
      "B1-B2 words). Every fact must be accurate and must come from the study material given. " +
      "Reply with JSON only.",
    prompt: `Subject: ${params.subject}${params.topic && params.topic !== params.subject ? ` — Topic: ${params.topic}` : ""}
${isWhole ? "This is the whole study material." : `This is PART ${params.partIndex + 1} OF ${params.total} of the study material. It may start or end mid-sentence; cover exactly this part.`}
${params.images?.length ? "Photos of the notes are attached; read them too." : ""}

STUDY MATERIAL:
"""
${params.text || "(see the attached photos)"}
"""

Make ONE vertical video of about 2 minutes (never longer than 2 minutes):
- "narration" lines together total 220-280 words. Each narration line is 10-25 words.
- Explain the MAIN ideas of this part clearly and in order, with at least one concrete example.
- Use the narrator's voice: "Let's break this down…", "Here's the trick…", "Think about it like this…".
- Use the markers' colours by letting the scenes vary (titles, bullets, numbers, boxes).
- Teach ALL key facts of this part (names, dates, formulas, causes, steps). Do not invent facts.

${SCENE_TYPES}

Return ONLY this JSON:
{"title":"catchy English title <=60 chars","caption":"short TikTok-style caption with 1 emoji","palette":"marker colour, one of red|blue|green|orange|purple","scenes":[...],"hashtags":["#tag1","#tag2","#tag3"],"takeaway":"one-sentence summary","keyFacts":["fact","..."]}`,
    images: params.images,
    maxTokens: 8_000,
  });
  const script = parseJson<Record<string, unknown>>(raw);
  const scenes = Array.isArray(script.scenes)
    ? (script.scenes as Record<string, unknown>[]).filter((s) => s && typeof s.type === "string")
    : [];
  if (scenes.length < 3) throw new Error("La IA devolvió un guion demasiado corto. Vuelve a intentarlo.");
  script.scenes = scenes.slice(0, 12);
  return script;
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as T;
}
