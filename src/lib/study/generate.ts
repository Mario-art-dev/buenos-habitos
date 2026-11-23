import { getAIProvider, type AIImage } from "@/lib/ai/provider";

// Modo Estudia: la IA convierte los apuntes del usuario en una serie de "TikToks" educativos en
// inglés. Dos pasos para que cada petición sea corta (el túnel corta a los ~100 s):
//  1) planLessons: lee el temario y lo reparte en lecciones (cuántas depende de lo largo que sea).
//  2) writeVideo: escribe el guion animado de UNA lección (escenas que el navegador reproduce).

export interface Lesson {
  title: string;
  keyFacts: string[];
}

export interface Plan {
  topic: string;
  lessons: Lesson[];
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as T;
}

export async function planLessons(params: {
  subject: string;
  topicHint?: string;
  text: string;
  images?: AIImage[];
  chunkInfo?: string;
}): Promise<Plan> {
  const words = params.text.split(/\s+/).filter(Boolean).length;
  const target = Math.max(2, Math.min(10, Math.round(words / 300) + (params.images?.length ?? 0)));
  const provider = await getAIProvider();
  const raw = await provider.chatJson({
    system:
      "You are a world-class teacher and viral TikTok educator. You split study material into " +
      "bite-sized lessons that, together, cover ABSOLUTELY EVERYTHING an exam could ask. " +
      "Never invent facts that are not supported by the material. Reply with JSON only.",
    prompt: `Subject: ${params.subject}
${params.topicHint ? `Topic name given by the student: ${params.topicHint}` : ""}
${params.chunkInfo ?? ""}
STUDY MATERIAL (may be in any language; photos of notes may be attached):
"""
${params.text || "(see attached images)"}
"""

Split this material into about ${target} lessons (fewer if the material is short, up to 12 if it is dense).
Each lesson = one TikTok video of 45-110 seconds. Together they must cover the WHOLE material: every
definition, date, formula, name, cause, consequence, step and example. Order them logically.

For each lesson list 3-8 "keyFacts": complete, precise facts copied/condensed from the material
(write them in English, keep exact numbers, names, formulas).

Return ONLY this JSON:
{"topic": "short English name of the whole topic", "lessons": [{"title": "catchy English lesson title", "keyFacts": ["..."]}]}`,
    images: params.images,
    maxTokens: 8_000,
  });
  const plan = parseJson<Plan>(raw);
  const lessons = (plan.lessons ?? [])
    .filter((l) => l && l.title && Array.isArray(l.keyFacts) && l.keyFacts.length)
    .slice(0, 12);
  if (!lessons.length) throw new Error("La IA no ha sacado lecciones de este material.");
  return { topic: plan.topic?.trim() || params.topicHint || params.subject, lessons };
}

const SCENE_TYPES = `Scene types (pick the ones that fit THIS content, vary them, 5-9 scenes total):
- {"type":"hook","text":"<=8 words shocking/funny opener","emoji":"🤯","narration":"..."}
- {"type":"explain","text":"short headline","bullets":["<=7 words","..."],"emoji":"🧠","narration":"..."}
- {"type":"analogy","text":"X is like Y","left":{"emoji":"🫀","label":"Heart"},"right":{"emoji":"🚒","label":"Fire pump"},"narration":"..."}
- {"type":"list","text":"headline","items":[{"emoji":"1️⃣","text":"<=6 words"}],"narration":"..."}   (2-5 items)
- {"type":"compare","text":"A vs B","left":{"label":"A","emoji":"🐢","points":["..."]},"right":{"label":"B","emoji":"🐇","points":["..."]},"narration":"..."}
- {"type":"number","value":"1492","label":"what the number means","emoji":"⛵","narration":"..."}   (dates, stats, formulas: value can be "E=mc²")
- {"type":"timeline","text":"headline","items":[{"emoji":"🏛️","text":"753 BC — Rome founded"}],"narration":"..."}
- {"type":"mnemonic","acronym":"HOMES","words":["Huron","Ontario","Michigan","Erie","Superior"],"text":"memory trick","narration":"..."}
- {"type":"story","text":"absurd mental image in <=12 words","emojis":["🦖","🍕","🚀"],"narration":"..."}   (a crazy, vivid, funny scene that encodes the fact)
- {"type":"quiz","question":"...","options":["A","B","C"],"answer":0,"explanation":"<=12 words","narration":"..."}   (put one near the end)
- {"type":"punchline","text":"<=10 word key takeaway","emoji":"🔥","narration":"..."}   (always last)`;

export async function writeVideo(params: {
  subject: string;
  topic: string;
  lesson: Lesson;
  index: number;
  total: number;
}): Promise<Record<string, unknown>> {
  const provider = await getAIProvider();
  const raw = await provider.chatJson({
    system:
      "You are the most addictive educational TikTok creator on Earth (think energetic science " +
      "communicator + stand-up comedian). You write scripts in ENGLISH that make facts impossible " +
      "to forget: shocking hooks, absurd vivid mental images, exaggerated analogies, jokes, " +
      "memory tricks, and a quick quiz. Simple words (B1-B2 English). Every fact must be accurate " +
      "and come from the key facts given. Reply with JSON only.",
    prompt: `Subject: ${params.subject} — Topic: ${params.topic}
Video ${params.index + 1} of ${params.total}: "${params.lesson.title}"
Key facts this video MUST teach (all of them):
${params.lesson.keyFacts.map((f) => `- ${f}`).join("\n")}

Write the script for one vertical animated video of 45-110 seconds (max 2 minutes).
"narration" is what the voice says in that scene: spoken, punchy, 12-40 words, total 130-260 words.
On-screen texts must be SHORT. Use emojis creatively as the visuals (they get animated big on screen).
Start with a hook in the first 2 seconds (shocking fact, crazy question or joke). Include at least one
absurd/funny mental image ("story") or analogy and a memory trick when useful. Choose the scene types
that best fit the content (dates → timeline/number, processes → list, contrasts → compare...).

${SCENE_TYPES}

Return ONLY this JSON:
{"title":"catchy title <=60 chars","caption":"TikTok-style caption with 1 emoji","palette":"one of fire|ocean|toxic|candy|galaxy|sunset","scenes":[...],"hashtags":["#tag1","#tag2","#tag3"],"takeaway":"one-sentence summary"}`,
    maxTokens: 8_000,
  });
  const script = parseJson<Record<string, unknown>>(raw);
  const scenes = Array.isArray(script.scenes)
    ? (script.scenes as Record<string, unknown>[]).filter((s) => s && typeof s.type === "string")
    : [];
  if (scenes.length < 2) throw new Error("La IA devolvió un guion vacío.");
  script.scenes = scenes.slice(0, 12);
  script.keyFacts = params.lesson.keyFacts;
  return script;
}
